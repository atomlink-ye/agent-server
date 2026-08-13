#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
} from './paseo-process.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const provider = process.argv[2]?.trim();
if (!provider) throw new Error('usage: provider-session-probe.mjs <provider>');

let clientModule;
try {
  clientModule = await import('@getpaseo/client');
} catch (error) {
  const toolchainVolume = process.env.PROVIDER_TOOLCHAIN_VOLUME;
  if (!toolchainVolume) throw error;
  const toolchainNodeModules = join(
    resolve(toolchainVolume),
    'current',
    'paseo-toolchain',
    'node_modules',
  );
  const candidates = [
    join(toolchainNodeModules, '@getpaseo', 'client', 'dist', 'index.js'),
    join(
      toolchainNodeModules,
      '.pnpm',
      'node_modules',
      '@getpaseo',
      'client',
      'dist',
      'index.js',
    ),
  ];
  let clientEntry = null;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      clientEntry = candidate;
      break;
    } catch {}
  }
  if (!clientEntry) throw error;
  clientModule = await import(pathToFileURL(clientEntry).href);
}
const { DaemonClient } = clientModule;
const marker = `PROVIDER_SESSION_READY_${randomUUID().replaceAll('-', '')}`;
const forwardedEnvironmentVariables = [
  'OPENCODE_GO_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'CODEX_API_KEY',
];

const runtimeBase = resolve(
  process.env.PROVIDER_SESSION_RUNTIME_ROOT ??
    join(repositoryRoot, '.local', 'provider-session-probe'),
);
const runRoot = join(
  runtimeBase,
  `${provider}-${process.pid}-${randomUUID()}`,
);
const projectRoot = join(runRoot, 'project');
let paseo;
let client;

try {
  await mkdir(projectRoot, { recursive: true });
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot: runRoot,
    port: await getAvailablePort(),
    environmentVariableNames: forwardedEnvironmentVariables,
  });
  client = new DaemonClient({
    url: paseo.wsUrl,
    clientId: `provider-session-probe-${process.pid}`,
    clientType: 'cli',
    appVersion: 'agent-server-provider-session-probe/1',
    connectTimeoutMs: 10_000,
    reconnect: { enabled: false },
  });
  await client.connect();
  const workspace = await client.openProject(projectRoot);
  if (!workspace.workspace?.id) throw new Error('provider_session_workspace_unavailable');
  const models = await client.listProviderModels(provider, { cwd: projectRoot });
  const model = models.models?.find((candidate) => candidate?.id)?.id;
  if (!model) throw new Error(`provider_session_model_unavailable: ${provider}`);
  const agent = await client.createAgent({
    provider,
    model,
    modeId:
      provider === 'claude'
        ? 'bypassPermissions'
        : provider === 'codex'
          ? 'full-access'
          : 'build',
    cwd: projectRoot,
    workspaceId: workspace.workspace.id,
    systemPrompt: 'Provider session readiness probe. Do not start a turn.',
    labels: { source: 'agent-server-provider-session-probe' },
  });
  if (!agent.id) throw new Error(`provider_session_create_failed: ${provider}`);
  await client.sendAgentMessage(
    agent.id,
    `Reply with exactly ${marker} and no other text. Do not use tools.`,
  );
  const finished = await client.waitForFinish(agent.id, 180_000);
  const timeline = await client.fetchAgentTimeline(agent.id, {
    direction: 'tail',
    limit: 100,
    projection: 'projected',
  });
  const reply = finished.lastMessage?.trim() ?? '';
  const timelineMarker = (timeline.entries ?? []).some(
    (entry) =>
      entry.item?.type === 'assistant_message' &&
      entry.item.text?.trim() === marker,
  );
  if (finished.status !== 'idle' || reply !== marker || !timelineMarker)
    throw new Error(`provider_session_turn_failed: ${provider}`);
  process.stdout.write(
    `${JSON.stringify({ outcome: 'PASS', provider, model, agentId: agent.id, workspaceId: workspace.workspace.id, status: finished.status, exactReply: true, timelineMarker: true })}\n`,
  );
} finally {
  if (client) await client.close().catch(() => undefined);
  await stopProcessTree(paseo?.child).catch(() => undefined);
}
