import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { DaemonClient } from '@getpaseo/client';

import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
} from '../dev/paseo-process.mjs';

const repositoryRoot = resolve('.');
const runtimeRoot = join(
  repositoryRoot,
  '.local',
  `codex-usage-probe-${Date.now()}-${randomUUID()}`,
);
const projectCwd = join(runtimeRoot, 'project');
const nonce = randomUUID();
const apiKey = process.env.OPENCODE_GO_API_KEY?.trim();
if (!apiKey) throw new Error('missing_OPENCODE_GO_API_KEY');

let paseo;
let client;
try {
  const codexHome = join(runtimeRoot, 'home', '.codex');
  await Promise.all([
    mkdir(projectCwd, { recursive: true }),
    mkdir(codexHome, { recursive: true, mode: 0o700 }),
  ]);
  const configPath = join(codexHome, 'config.toml');
  await writeFile(
    configPath,
    [
      'model_provider = "opencode-go"',
      '',
      '[model_providers.opencode-go]',
      'name = "OpenCode Go"',
      'base_url = "https://opencode.ai/zen/go/v1"',
      'env_key = "OPENCODE_GO_API_KEY"',
      'wire_api = "responses"',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  await chmod(configPath, 0o600);
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: await getAvailablePort(),
    environmentVariableNames: ['OPENCODE_GO_API_KEY'],
  });
  client = new DaemonClient({
    url: paseo.wsUrl,
    clientId: `codex-usage-probe-${process.pid}`,
    clientType: 'cli',
    appVersion: 'agent-server-codex-usage-probe/1',
    connectTimeoutMs: 10_000,
    reconnect: { enabled: false },
  });
  await client.connect();
  const workspace = await client.openProject(projectCwd);
  const agent = await client.createAgent({
    provider: 'codex',
    model: 'deepseek-v4-flash',
    modeId: 'full-access',
    cwd: projectCwd,
    workspaceId: workspace.workspace?.id,
    systemPrompt: 'Return the exact requested nonce and nothing else.',
  });
  await client.sendAgentMessage(agent.id, nonce);
  const finished = await client.waitForFinish(agent.id, 150_000);
  const usage = finished.final?.lastUsage ?? null;
  process.stdout.write(
    `${JSON.stringify({
      provider: 'codex',
      model: 'deepseek-v4-flash',
      status: finished.status,
      usage,
      response_matches_nonce: finished.lastMessage?.trim() === nonce,
      response_sha256:
        typeof finished.lastMessage === 'string'
          ? createHash('sha256').update(finished.lastMessage.trim()).digest('hex')
          : null,
      nonce_sha256: createHash('sha256').update(nonce).digest('hex'),
    })}\n`,
  );
  if (
    !usage ||
    !(
      Number(usage.inputTokens ?? 0) > 0 ||
      Number(usage.outputTokens ?? 0) > 0
    )
  ) {
    process.exitCode = 2;
  }
} finally {
  if (client) await client.close().catch(() => undefined);
  await stopProcessTree(paseo?.child).catch(() => undefined);
}
