import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DaemonClient } from '@getpaseo/client';

import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
} from '../dev/paseo-process.mjs';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const provider = 'claude';
const gatewayProvider = 'opencode-go';
const model = 'deepseek-v4-flash';
const marker = 'CLAUDE_OPENCODE_GO_SMOKE_OK';
const authSentinel = 'Not logged in · Please run /login';
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const runtimeRoot = join(
  repositoryRoot,
  '.local',
  `claude-provider-smoke-${timestamp}-${randomUUID()}`,
);
const projectCwd = join(runtimeRoot, 'project');
const artifactPath = join(runtimeRoot, 'model-output.txt');
const prompt = `Reply with exactly this marker and no other text: ${marker}. Do not use tools.`;
const systemPrompt = 'You are a smoke-test agent. Do not use tools.';
const environmentVariableNames = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
];

let paseo;
let client;
let agentId = null;
let finished;
let timeline;
let stage = 'setup';

try {
  const apiKey = process.env.OPENCODE_GO_API_KEY?.trim();
  if (!apiKey) throw new Error('missing_api_key');

  process.env.ANTHROPIC_BASE_URL = 'https://opencode.ai/zen/go';
  process.env.ANTHROPIC_API_KEY = apiKey;
  process.env.ANTHROPIC_MODEL = model;

  stage = 'workspace';
  await mkdir(projectCwd, { recursive: true });

  stage = 'paseo';
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: await getAvailablePort(),
    environmentVariableNames,
  });

  stage = 'connect';
  client = new DaemonClient({
    url: paseo.wsUrl,
    clientId: `claude-provider-smoke-${process.pid}`,
    clientType: 'cli',
    appVersion: 'agent-server-claude-provider-smoke/1',
    connectTimeoutMs: 10_000,
    reconnect: { enabled: false },
  });
  await client.connect();

  stage = 'open_project';
  const workspace = await client.openProject(projectCwd);
  const workspaceId = workspace.workspace?.id;
  if (!workspaceId) throw new Error('workspace_unavailable');

  stage = 'create_agent';
  const agent = await client.createAgent({
    provider,
    model,
    modeId: 'bypassPermissions',
    cwd: projectCwd,
    workspaceId,
    systemPrompt,
    labels: { source: 'agent-server-claude-provider-smoke' },
  });
  agentId = agent.id;
  if (!agentId) throw new Error('agent_unavailable');

  stage = 'send_message';
  await client.sendAgentMessage(agentId, prompt);

  stage = 'wait_for_finish';
  finished = await client.waitForFinish(agentId, 150_000);

  stage = 'fetch_timeline';
  timeline = await client.fetchAgentTimeline(agentId, {
    direction: 'tail',
    limit: 100,
    projection: 'projected',
  });

  stage = 'verify';
  const timelineEntries = timeline.entries ?? [];
  const timelineMarker = timelineEntries.some(
    (entry) =>
      entry.item.type === 'assistant_message' &&
      entry.item.text?.trim() === marker,
  );
  if (
    finished.status !== 'idle' ||
    finished.lastMessage?.trim() !== marker ||
    finished.lastMessage?.trim() === authSentinel ||
    !timelineMarker
  ) {
    throw new Error('acceptance_failed');
  }

  stage = 'artifact';
  await writeFile(artifactPath, marker, { encoding: 'utf8', mode: 0o600 });
  const artifactStat = await stat(artifactPath);
  const output = await readFile(artifactPath, 'utf8');
  if (artifactStat.size <= 0 || output.length === 0 || output !== marker) {
    throw new Error('artifact_invalid');
  }
  const outputBytes = Buffer.byteLength(output, 'utf8');

  process.stdout.write(
    `${JSON.stringify({
      outcome: 'PASS',
      provider,
      gateway_provider: gatewayProvider,
      model,
      agent_id: agentId,
      status: finished.status,
      output_sha256: createHash('sha256').update(output).digest('hex'),
      output_bytes: outputBytes,
      artifact_path: artifactPath,
      artifact_bytes: artifactStat.size,
      timeline_entry_count: timelineEntries.length,
      daemon_log_path: paseo.logPath,
    })}\n`,
  );
} catch {
  process.stdout.write(
    `${JSON.stringify({
      outcome: 'FAIL',
      error_code: `claude_provider_smoke_${stage}`,
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  if (client) await client.close().catch(() => undefined);
  await stopProcessTree(paseo?.child).catch(() => undefined);
}
