import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
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
const nonce = randomUUID();
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const runtimeRoot = join(
  repositoryRoot,
  '.local',
  `claude-provider-smoke-${timestamp}-${randomUUID()}`,
);
const projectCwd = join(runtimeRoot, 'project');
const artifactPath = join(projectCwd, 'model-artifact.txt');
const sidecarPath = join(projectCwd, 'model-artifact.sha256');
const prompt = [
  'Use your shell tool in the current working directory. Do not skip this.',
  `Run: printf '%s' '${nonce}' > model-artifact.txt`,
  "Then run: hash=$(sha256sum model-artifact.txt | cut -d' ' -f1); printf '%s' \"$hash\" > model-artifact.sha256",
  `After both files are created, reply with exactly ${nonce} and no other text.`,
].join('\n');
const systemPrompt =
  'You are a smoke-test agent. You may use the shell tool to complete the requested file task.';
const anthropicEnvironmentVariableNames = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
];
const omitAuth = process.env.CLAUDE_PROVIDER_SMOKE_OMIT_AUTH === '1';
const rawApiKey = process.env.OPENCODE_GO_API_KEY;
const apiKey = rawApiKey?.trim() || null;
const redactionValues = [rawApiKey, apiKey, nonce, prompt, systemPrompt].filter(
  (value, index, values) => value && values.indexOf(value) === index,
);

let paseo;
let client;
let agentId = null;
let finished;
let timeline;
let stage = 'setup';

try {
  if (!omitAuth && !apiKey) throw new Error('missing_api_key');

  if (omitAuth) {
    for (const name of anthropicEnvironmentVariableNames)
      delete process.env[name];
  } else {
    process.env.ANTHROPIC_BASE_URL = 'https://opencode.ai/zen/go';
    process.env.ANTHROPIC_API_KEY = apiKey;
    for (const name of anthropicEnvironmentVariableNames.slice(2))
      process.env[name] = model;
  }

  stage = 'workspace';
  await mkdir(projectCwd, { recursive: true });

  stage = 'paseo';
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: await getAvailablePort(),
    environmentVariableNames: omitAuth ? [] : anthropicEnvironmentVariableNames,
  });

  stage = 'connect';
  client = new DaemonClient({
    url: paseo.wsUrl,
    clientId: `claude-provider-smoke-${process.pid}`,
    clientType: 'cli',
    appVersion: 'agent-server-claude-provider-smoke/2',
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
  const usage = safeUsage(finished.final?.lastUsage);
  const usageAccepted =
    usage !== null && (usage.inputTokens > 0 || usage.outputTokens > 0);
  const finalMessageAccepted =
    finished.status === 'idle' && finished.lastMessage?.trim() === nonce;
  const timelineAccepted = timelineEntries.some(
    (entry) =>
      entry.item.type === 'assistant_message' &&
      typeof entry.item.text === 'string' &&
      entry.item.text.trim() === nonce,
  );
  if (!usageAccepted || !finalMessageAccepted || !timelineAccepted) {
    throw new Error('acceptance_failed');
  }
  const artifacts = await readAgentArtifacts();

  process.stdout.write(
    `${JSON.stringify({
      outcome: 'PASS',
      nonce_sha256: artifacts.nonceSha256,
      provider,
      gateway_provider: gatewayProvider,
      model,
      agent_id: agentId,
      status: finished.status,
      usage,
      model_artifact_path: artifactPath,
      model_artifact_bytes: artifacts.modelBytes,
      model_artifact_sha256: artifacts.modelArtifactSha256,
      sidecar_artifact_path: sidecarPath,
      sidecar_artifact_bytes: artifacts.sidecarBytes,
      sidecar_artifact_sha256: artifacts.sidecarArtifactSha256,
      sidecar_hash: artifacts.sidecarHash,
      timeline_entry_count: timelineEntries.length,
      daemon_log_path: paseo.logPath,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      outcome: 'FAIL',
      stage,
      error_code: `claude_provider_smoke_${stage}`,
      message: sanitizeText(error instanceof Error ? error.message : error),
      status: finished?.status ?? null,
      usage: safeUsage(finished?.final?.lastUsage),
      last_message: limitText(sanitizeText(finished?.lastMessage), 160),
      cause: limitText(
        sanitizeText(error instanceof Error ? error.cause : undefined),
        512,
      ),
      stack: limitText(
        sanitizeText(error instanceof Error ? error.stack : undefined),
        4096,
      ),
      daemon_log_path: paseo?.logPath ?? null,
      daemon_log_tail: await readDaemonLogTail(paseo?.logPath),
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  if (client) await client.close().catch(() => undefined);
  await stopProcessTree(paseo?.child).catch(() => undefined);
}

async function readAgentArtifacts() {
  const modelStat = await stat(artifactPath);
  const sidecarStat = await stat(sidecarPath);
  if (!modelStat.isFile() || !sidecarStat.isFile())
    throw new Error('artifact_missing');
  const [modelOutput, sidecarHash] = await Promise.all([
    readFile(artifactPath, 'utf8'),
    readFile(sidecarPath, 'utf8'),
  ]);
  const nonceSha256 = createHash('sha256').update(nonce).digest('hex');
  const modelArtifactSha256 = createHash('sha256')
    .update(modelOutput)
    .digest('hex');
  if (modelOutput !== nonce) throw new Error('artifact_content_invalid');
  if (
    !/^[a-f0-9]{64}$/.test(sidecarHash) ||
    sidecarHash !== modelArtifactSha256
  ) {
    throw new Error('artifact_hash_invalid');
  }
  if (modelStat.size <= 0 || sidecarStat.size !== 64)
    throw new Error('artifact_size_invalid');
  return {
    modelBytes: modelStat.size,
    modelArtifactSha256,
    nonceSha256,
    sidecarBytes: sidecarStat.size,
    sidecarArtifactSha256: createHash('sha256')
      .update(sidecarHash)
      .digest('hex'),
    sidecarHash,
  };
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens =
    typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
      ? usage.inputTokens
      : null;
  const outputTokens =
    typeof usage.outputTokens === 'number' &&
    Number.isFinite(usage.outputTokens)
      ? usage.outputTokens
      : null;
  if (inputTokens === null && outputTokens === null) return null;
  return { inputTokens, outputTokens };
}

function sanitizeText(value) {
  let text = value === undefined || value === null ? '' : String(value);
  for (const valueToRedact of redactionValues) {
    text = text.split(valueToRedact).join('[REDACTED]');
  }
  text = text.replace(/(\bbearer\s+)[^\s,;]+/gi, '$1[REDACTED]');
  text = text.replace(
    /(\b(?:x-api-key|api[-_]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi,
    '$1[REDACTED]',
  );
  return text;
}

function limitText(value, maxLength) {
  return value.slice(0, maxLength);
}

async function readDaemonLogTail(logPath) {
  if (!logPath) return null;
  try {
    const contents = sanitizeText(await readFile(logPath, 'utf8'));
    return contents.split(/\r?\n/).slice(-40).join('\n');
  } catch {
    return null;
  }
}
