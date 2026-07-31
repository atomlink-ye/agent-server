import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  managedAgentYaml,
  managedEnvironmentYaml,
} from './web-bootstrap-fixtures.mjs';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const outputPath = resolve(repositoryRoot, '.local/web-bootstrap.env');
const fileEnv = await readEnvFile(outputPath);
const env = (name) => process.env[name]?.trim() || fileEnv[name]?.trim() || '';
const baseUrl = (
  env('AGENT_SERVER_BASE_URL') || 'http://127.0.0.1:3000'
).replace(/\/$/, '');
const token = env('AGENT_SERVER_SERVICE_TOKEN') || 'token-local-dev';
let agentVersionId = env('WEB_AGENT_VERSION_ID');
let environmentVersionId = env('WEB_ENVIRONMENT_VERSION_ID');
const workspaceName = env('WEB_WORKSPACE_NAME') || 'Web Chat MVE';

if (!agentVersionId) agentVersionId = await bootstrapAgentVersion();
else await readPublished(`${baseUrl}/api/v1/agent-versions/${agentVersionId}`);
if (!environmentVersionId)
  environmentVersionId = await bootstrapEnvironmentVersion();
else
  await readPublished(
    `${baseUrl}/api/v1/environment-versions/${environmentVersionId}`,
  );
let workspaceId = env('WEB_WORKSPACE_ID');
if (workspaceId) await request(`${baseUrl}/api/v1/workspaces/${workspaceId}`);
else
  workspaceId = (
    await request(`${baseUrl}/api/v1/workspaces`, {
      method: 'POST',
      body: { name: workspaceName },
      expectedStatus: 201,
    })
  ).workspace_id;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  [
    `AGENT_SERVER_BASE_URL=${baseUrl}`,
    `WEB_AGENT_VERSION_ID=${agentVersionId}`,
    `WEB_ENVIRONMENT_VERSION_ID=${environmentVersionId}`,
    `WEB_WORKSPACE_NAME=${quoteEnv(workspaceName)}`,
    `WEB_WORKSPACE_ID=${workspaceId}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);
process.stdout.write(`web bootstrap ready: ${outputPath}\n`);

async function readPublished(url) {
  const value = await request(url);
  if (value.status !== 'published')
    fail('Configured version is not published.');
  return value;
}

async function bootstrapAgentVersion() {
  await request(`${baseUrl}/api/v1/agent-packages:validate`, {
    method: 'POST',
    body: { source: managedAgentYaml() },
  });
  const imported = await request(`${baseUrl}/api/v1/agents:import`, {
    method: 'POST',
    idempotencyKey: 'web-chat-mve-agent-import-v1',
    body: { source: managedAgentYaml() },
    expectedStatus: 201,
  });
  const versionId = imported.version?.id;
  if (typeof versionId !== 'string')
    fail('Agent bootstrap returned no version.');
  const published = await request(
    `${baseUrl}/api/v1/agent-versions/${versionId}:publish`,
    {
      method: 'POST',
      idempotencyKey: 'web-chat-mve-agent-publish-v1',
      body: {},
    },
  );
  if (published.status !== 'published') fail('Agent publish did not complete.');
  return versionId;
}

async function bootstrapEnvironmentVersion() {
  await request(`${baseUrl}/api/v1/environment-packages:validate`, {
    method: 'POST',
    body: { source: managedEnvironmentYaml() },
  });
  const imported = await request(`${baseUrl}/api/v1/environments:import`, {
    method: 'POST',
    idempotencyKey: 'web-chat-mve-environment-import-v1',
    body: { source: managedEnvironmentYaml() },
    expectedStatus: 201,
  });
  const versionId = imported.version?.id;
  if (typeof versionId !== 'string')
    fail('Environment bootstrap returned no version.');
  const draft = await request(
    `${baseUrl}/api/v1/environment-versions/${versionId}`,
  );
  if (draft.status !== 'draft' && draft.status !== 'published')
    fail('Environment version has an invalid status.');
  if (draft.status === 'draft') {
    const published = await request(
      `${baseUrl}/api/v1/environment-versions/${versionId}:publish`,
      {
        method: 'POST',
        idempotencyKey: 'web-chat-mve-environment-publish-v1',
        body: {},
      },
    );
    if (published.status !== 'published')
      fail('Environment publish did not complete.');
  }
  return versionId;
}
async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey
          ? { 'idempotency-key': options.idempotencyKey }
          : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail('Agent Server is not reachable. Start the local API first.');
  }
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus)
    fail(
      `Agent Server bootstrap request failed (${response.status}, expected ${expectedStatus}).`,
    );
  return response.json();
}
async function readEnvFile(path) {
  try {
    const text = await readFile(path, 'utf8');
    return Object.fromEntries(
      text
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=');
          return [
            line.slice(0, index),
            line.slice(index + 1).replace(/^['"]|['"]$/g, ''),
          ];
        }),
    );
  } catch {
    return {};
  }
}
function quoteEnv(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : JSON.stringify(value);
}
function fail(message) {
  process.stderr.write(`web bootstrap failed: ${message}\n`);
  process.exit(1);
}
