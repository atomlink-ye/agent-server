import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite-smoke';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

import {
  delay,
  getAvailablePort,
  isProcessAlive,
  startPaseo,
  stopProcessTree,
  waitForHttp,
} from '../dev/paseo-process.mjs';

const expectedText = 'PASEO_OPENCODE_BASELINE_OK';
const requestedSmokeModel = process.env.PASEO_SMOKE_MODEL?.trim();
if (
  requestedSmokeModel &&
  !/(?:^|[-/])free(?:$|-)/i.test(requestedSmokeModel)
) {
  throw new Error(
    'PASEO_SMOKE_MODEL must be an explicitly free model identifier.',
  );
}
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const runKey = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`;
const runtimeRoot = join(repositoryRoot, '.local', 'smoke', runKey);
const agentWorkspace = join(runtimeRoot, 'agent-workspace');
const evidencePath = join(runtimeRoot, 'evidence.json');
const smokeToken = `paseo-smoke-${randomUUID()}`;
await Promise.all([
  mkdir(runtimeRoot, { recursive: true }),
  mkdir(agentWorkspace, { recursive: true }),
]);

const paseoPort = await getAvailablePort();
const apiPort = await getAvailablePort();
let paseo;
let api;
let paseoPid;
let apiPid;
let smokeDatabase;
let smokePostgres;

try {
  const smokePostgresBootstrap = await startSmokePostgres(
    join(runtimeRoot, 'pglite-postgres'),
  );
  smokeDatabase = smokePostgresBootstrap.database;
  smokePostgres = smokePostgresBootstrap.server;

  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: paseoPort,
  });
  paseoPid = paseo.child.pid;
  await assertNoOpenCodeCredentials(runtimeRoot);

  const apiLogPath = join(runtimeRoot, 'agent-server.log');
  const apiLog = openSync(apiLogPath, 'a');
  try {
    api = spawn(
      process.execPath,
      [join(repositoryRoot, 'dist', 'entrypoints', 'api', 'server.js')],
      {
        cwd: repositoryRoot,
        env: {
          ...paseo.environment,
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: String(apiPort),
          LOG_LEVEL: 'info',
          DATABASE_URL: smokePostgresBootstrap.databaseUrl,
          POSTGRES_URL: smokePostgresBootstrap.databaseUrl,
          PGSSLMODE: 'disable',
          PASEO_WS_URL: paseo.wsUrl,
          PASEO_AGENT_CWD: agentWorkspace,
          PASEO_WORKSPACE_TITLE: 'Paseo OpenCode Baseline Smoke',
          ...(requestedSmokeModel ? { PASEO_MODEL: requestedSmokeModel } : {}),
          PASEO_CONNECT_TIMEOUT_MS: '10000',
          PASEO_EXECUTION_TIMEOUT_MS: '150000',
          SERVICE_ACCOUNTS_JSON: JSON.stringify([
            {
              serviceAccountId: 'svc_paseo_smoke',
              token: smokeToken,
              tenantId: 'tenant_paseo_smoke',
              workspaceId: 'workspace_paseo_smoke',
              policyVersion: 'policy-paseo-smoke-v1',
            },
          ]),
        },
        detached: process.platform !== 'win32',
        stdio: ['ignore', apiLog, apiLog],
      },
    );
  } finally {
    closeSync(apiLog);
  }
  apiPid = api.pid;

  const baseUrl = `http://127.0.0.1:${apiPort}`;
  await waitForHttp(`${baseUrl}/health/live`, 30_000, api);
  const readyResponse = await waitForHttp(
    `${baseUrl}/health/ready`,
    90_000,
    api,
  );
  const readiness = await readyResponse.json();

  const createdResponse = await fetch(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${smokeToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      prompt: `Do not use tools. Reply with exactly: ${expectedText}`,
    }),
  });
  if (createdResponse.status !== 202) {
    throw new Error(
      `Run creation returned HTTP ${createdResponse.status}: ${await createdResponse.text()}`,
    );
  }
  const created = await createdResponse.json();
  if (!created.run_id || created.status !== 'queued') {
    throw new Error(`Unexpected create response: ${JSON.stringify(created)}`);
  }

  const completed = await pollRun(baseUrl, created.run_id, smokeToken, 180_000);
  if (completed.status !== 'succeeded') {
    throw new Error(`Run did not succeed: ${JSON.stringify(completed)}`);
  }
  if (completed.runtime?.provider !== 'opencode') {
    throw new Error(`Unexpected provider: ${completed.runtime?.provider}`);
  }
  if (!/(?:^|[-/])free(?:$|-)/i.test(completed.runtime?.model ?? '')) {
    throw new Error(
      `Selected model is not explicitly free: ${completed.runtime?.model}`,
    );
  }
  if (completed.result?.text.trim() !== expectedText) {
    throw new Error(
      `Unexpected model output: ${JSON.stringify(completed.result?.text)}`,
    );
  }
  await assertNoOpenCodeCredentials(runtimeRoot);

  const evidence = {
    verified_at: new Date().toISOString(),
    paseo_version: '0.1.110',
    opencode_version: '1.18.4',
    requested_model: requestedSmokeModel ?? null,
    credential_files: 0,
    readiness,
    created,
    completed,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      success: true,
      database: 'pglite-socket',
      marker: expectedText,
      provider: completed.runtime.provider,
      model: completed.runtime.model,
      status: completed.status,
      evidence: evidencePath,
    })}\n`,
  );
} finally {
  await Promise.all([
    stopProcessTree(api),
    stopProcessTree(paseo?.child),
    stopSmokePostgres(smokePostgres, smokeDatabase),
  ]);
  if (isProcessAlive(apiPid) || isProcessAlive(paseoPid)) {
    throw new Error('Smoke cleanup left a managed process running.');
  }
}

async function startSmokePostgres(databasePath) {
  const database = new PGlite(databasePath);
  const server = new PGLiteSocketServer({
    db: database,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 10,
  });
  await server.start();

  const connection = server.getServerConn();
  if (!/^127\.0\.0\.1:\d+$/.test(connection)) {
    throw new Error(
      `Unexpected PGlite socket connection string: ${connection}`,
    );
  }

  return {
    database,
    server,
    databaseUrl: `postgresql://postgres:postgres@${connection}/postgres`,
  };
}

async function stopSmokePostgres(server, database) {
  await server?.stop();
  await database?.close();
}

async function pollRun(baseUrl, runId, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Run polling returned HTTP ${response.status}`);
    }
    last = await response.json();
    if (['succeeded', 'failed', 'timed_out'].includes(last.status)) {
      return last;
    }
    await delay(500);
  }
  throw new Error(`Timed out polling run. Last state: ${JSON.stringify(last)}`);
}

async function assertNoOpenCodeCredentials(root) {
  const files = await findNamedFiles(root, 'auth.json');
  const openCodeCredentials = files.filter((path) =>
    path.toLowerCase().includes('opencode'),
  );
  if (openCodeCredentials.length > 0) {
    throw new Error(
      `Zero-credential smoke found OpenCode auth files: ${openCodeCredentials.join(', ')}`,
    );
  }
}

async function findNamedFiles(root, name) {
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.name === name) {
        found.push(path);
      }
    }
  }
  await visit(root);
  return found;
}
