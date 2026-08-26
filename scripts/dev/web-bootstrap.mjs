import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import {
  managedAgentYaml,
  managedEnvironmentYaml,
  mixedTeamWorkerYaml,
  mixedTeamYaml,
} from './web-bootstrap-fixtures.mjs';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const outputPath = resolve(repositoryRoot, '.local/web-bootstrap.env');

// `baseUrl`/`token` are read by `request()` below. They are assigned once,
// early in `main()`, rather than passed through every bootstrap* helper.
let baseUrl;
let token;

export async function main() {
  const fileEnv = await readEnvFile(outputPath);
  const env = (name) =>
    process.env[name]?.trim() || fileEnv[name]?.trim() || '';
  baseUrl = (env('AGENT_SERVER_BASE_URL') || 'http://127.0.0.1:3000').replace(
    /\/$/,
    '',
  );
  token = env('AGENT_SERVER_SERVICE_TOKEN') || 'token-local-dev';
  const skipProductWork = env('WEB_BOOTSTRAP_SKIP_WORK') === '1';
  const workspaceName = env('WEB_WORKSPACE_NAME') || 'Web Chat MVE';

  // Each cached id below is a performance optimisation, not a source of
  // truth: a dev database reset or a destructive test leaves the cache
  // pointing at fixtures that no longer exist. `resolveCachedId` verifies a
  // cached id with a live GET and only recreates the specific fixture whose
  // id 404s, so one stale id cannot take down the whole bootstrap and a
  // healthy cache is never discarded just because it is present.
  const agentVersionId = await resolveCachedId({
    label: 'agent version',
    cachedId: env('WEB_AGENT_VERSION_ID'),
    check: (id) => readPublished(`${baseUrl}/api/v1/agent-versions/${id}`),
    recreate: () => bootstrapAgentVersion(),
  });
  const environmentVersionId = await resolveCachedId({
    label: 'environment version',
    cachedId: env('WEB_ENVIRONMENT_VERSION_ID'),
    check: (id) =>
      readPublished(`${baseUrl}/api/v1/environment-versions/${id}`),
    recreate: () => bootstrapEnvironmentVersion(),
  });
  const agenticTeamVersionId = await resolveCachedId({
    label: 'agentic team version',
    cachedId: env('WEB_AGENTIC_TEAM_VERSION_ID'),
    check: (id) => readPublished(`${baseUrl}/api/v1/team-versions/${id}`),
    recreate: () => bootstrapMixedTeamVersion(environmentVersionId),
  });
  const workspaceId = await resolveCachedId({
    label: 'workspace',
    cachedId: env('WEB_WORKSPACE_ID'),
    check: (id) => request(`${baseUrl}/api/v1/workspaces/${id}`),
    recreate: async () =>
      (
        await request(`${baseUrl}/api/v1/workspaces`, {
          method: 'POST',
          body: { name: workspaceName },
          expectedStatus: 201,
        })
      ).workspace_id,
  });

  // Core mode intentionally has no Product Work execution plane. Do not carry
  // a stale WEB_SAMPLE_WORK_ID forward from an older runtime bootstrap,
  // otherwise a fresh/recreated local database can point the Web UI at a
  // non-existent Work.
  let sampleWorkId = skipProductWork
    ? ''
    : await resolveCachedId({
        label: 'sample Work',
        cachedId: env('WEB_SAMPLE_WORK_ID'),
        check: (id) => request(`${baseUrl}/api/v1/works/${id}`),
        // The replacement Work needs a Work Definition that is only created
        // below, once. Leaving this empty defers creation to that point,
        // exactly like the "no cached id yet" case.
        recreate: () => '',
      });
  let workerVersionId = '';
  if (!skipProductWork) {
    workerVersionId = await resolveCachedId({
      label: 'sample Worker version',
      cachedId: env('WEB_WORKER_VERSION_ID'),
      check: (id) => readPublished(`${baseUrl}/api/v1/worker-versions/${id}`),
      recreate: () =>
        bootstrapPublishedWorker(
          `apiVersion: agent-server/v1alpha1\nkind: Worker\nmetadata:\n  name: web-bootstrap-work-worker\nspec:\n  description: Formal execution role for Web sample Work\n  instructions: Complete the requested Work safely.\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools: []\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: Complete the Work.\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: done\n`,
          'web-bootstrap-work-worker',
        ),
    });
    const { definitionId, definitionVersionId } = await bootstrapWorkDefinition(
      workerVersionId,
      environmentVersionId,
    );
    await bootstrapAgentWorkflowAssociation(
      agentVersionId,
      definitionId,
      definitionVersionId,
    );
    if (!sampleWorkId)
      sampleWorkId = await bootstrapWork(definitionId, definitionVersionId);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    [
      `AGENT_SERVER_BASE_URL=${baseUrl}`,
      `WEB_AGENT_VERSION_ID=${agentVersionId}`,
      ...(skipProductWork ? [] : [`WEB_WORKER_VERSION_ID=${workerVersionId}`]),
      `WEB_ENVIRONMENT_VERSION_ID=${environmentVersionId}`,
      `WEB_AGENTIC_TEAM_VERSION_ID=${agenticTeamVersionId}`,
      `WEB_WORKSPACE_NAME=${quoteEnv(workspaceName)}`,
      `WEB_WORKSPACE_ID=${workspaceId}`,
      ...(sampleWorkId ? [`WEB_SAMPLE_WORK_ID=${sampleWorkId}`] : []),
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  process.stdout.write(
    `web bootstrap ready: ${outputPath}${skipProductWork ? ' (core resources only)' : ''}\n`,
  );
}

/**
 * Resolves one cached fixture id against a live check, recreating it when
 * the check reports the id is gone (HTTP 404). Any other failure (5xx,
 * unauthenticated, unreachable server) is not staleness and must still fail
 * the whole bootstrap loudly rather than risk duplicating fixtures against a
 * database that is actually healthy.
 */
export async function resolveCachedId({ label, cachedId, check, recreate }) {
  if (cachedId) {
    try {
      await check(cachedId);
      return cachedId;
    } catch (error) {
      if (error?.status !== 404) throw error;
      noteStaleCache(label);
    }
  }
  return recreate();
}

export function noteStaleCache(label) {
  process.stderr.write(
    `web bootstrap: cached ${label} id no longer exists in the database; recreating it.\n`,
  );
}

async function readPublished(url) {
  const value = await request(url);
  // Deliberately not the same failure shape as a 404: an existing-but-unpublished
  // version is a real configuration problem, not a stale cache, so it must fail
  // loudly rather than be treated as "recreate this fixture".
  if (value.status !== 'published')
    fail('Configured version is not published.');
  return value;
}

async function bootstrapAgentVersion() {
  return bootstrapPublishedAgent(
    managedAgentYaml(),
    'web-chat-mve-agent-work-tools',
  );
}

async function bootstrapPublishedAgent(source, key) {
  await request(`${baseUrl}/api/v1/agent-packages:validate`, {
    method: 'POST',
    body: { source },
  });
  const imported = await request(`${baseUrl}/api/v1/agents:import`, {
    method: 'POST',
    idempotencyKey: `${key}-import-v1`,
    body: { source },
    expectedStatus: 201,
  });
  const versionId = imported.version?.id;
  if (typeof versionId !== 'string')
    fail(`Agent bootstrap returned no version for ${key}.`);
  const published = await request(
    `${baseUrl}/api/v1/agent-versions/${versionId}:publish`,
    {
      method: 'POST',
      idempotencyKey: `${key}-publish-v1`,
      body: {},
    },
  );
  if (published.status !== 'published')
    fail(`Agent publish did not complete for ${key}.`);
  return versionId;
}

async function bootstrapPublishedWorker(source, key) {
  await request(`${baseUrl}/api/v1/worker-packages:validate`, {
    method: 'POST',
    body: { source },
  });
  const imported = await request(`${baseUrl}/api/v1/workers:import`, {
    method: 'POST',
    idempotencyKey: `${key}-import-v1`,
    body: { source },
    expectedStatus: 201,
  });
  const versionId = imported.version?.id;
  if (typeof versionId !== 'string')
    fail(`Worker bootstrap returned no version for ${key}.`);
  const published = await request(
    `${baseUrl}/api/v1/worker-versions/${versionId}:publish`,
    {
      method: 'POST',
      idempotencyKey: `${key}-publish-v1`,
      body: {},
    },
  );
  if (published.status !== 'published')
    fail(`Worker publish did not complete for ${key}.`);
  return versionId;
}

async function bootstrapMixedTeamVersion(environmentVersionId) {
  const workers = {};
  for (const name of ['lead', 'fixer', 'reviewer'])
    workers[name] = await bootstrapPublishedWorker(
      mixedTeamWorkerYaml(name),
      `web-chat-mixed-team-worker-${name}`,
    );
  const imported = await request(`${baseUrl}/api/v1/teams:import`, {
    method: 'POST',
    idempotencyKey: 'web-chat-mixed-team-worker-import-v1',
    body: {
      source: mixedTeamYaml(
        workers.lead,
        workers.fixer,
        workers.reviewer,
        environmentVersionId,
      ),
    },
    expectedStatus: 201,
  });
  const versionId = imported.version?.id;
  if (typeof versionId !== 'string')
    fail('Mixed team bootstrap returned no version.');
  const published = await request(
    `${baseUrl}/api/v1/team-versions/${versionId}:publish`,
    {
      method: 'POST',
      idempotencyKey: 'web-chat-mixed-team-worker-publish-v1',
      body: {},
    },
  );
  if (published.status !== 'published')
    fail('Mixed team publish did not complete.');
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

async function bootstrapWorkDefinition(workerVersionId, environmentVersionId) {
  const workDefinitionSource = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: web-bootstrap-single-worker
spec:
  kind: single_worker
  worker_version_id: ${workerVersionId}
  environment_version_id: ${environmentVersionId}`;

  // Only the fetch itself (a network-level failure) belongs in this try/catch.
  // A `fail()` call for an unexpected status must not be caught here too,
  // otherwise it would be swallowed and replaced by the generic
  // "not reachable" message below.
  let fetchResponse;
  try {
    fetchResponse = await fetch(`${baseUrl}/api/v1/work-definitions:apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'web-bootstrap-single-worker-work-tools-apply-v1',
      },
      body: JSON.stringify({ source: workDefinitionSource }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    fail('Agent Server is not reachable. Start the local API first.', error);
  }
  // :apply endpoint may return 200 (already exists) or 201 (newly created), both are success
  if (fetchResponse.status !== 200 && fetchResponse.status !== 201)
    fail(
      `Agent Server bootstrap request failed (${fetchResponse.status}, expected 200 or 201).`,
    );
  const response = await fetchResponse.json();

  const definitionId = response.definition?.id;
  const definitionVersionId = response.version?.id;

  if (
    typeof definitionId !== 'string' ||
    typeof definitionVersionId !== 'string'
  )
    fail('Work definition bootstrap returned no ids.');

  return { definitionId, definitionVersionId };
}

async function bootstrapWork(definitionId, definitionVersionId) {
  const response = await request(`${baseUrl}/api/v1/works`, {
    method: 'POST',
    body: {
      definition_id: definitionId,
      definition_version_id: definitionVersionId,
      title: 'Web Bootstrap Sample',
    },
    expectedStatus: 201,
  });

  const workId = response.work?.id;
  if (typeof workId !== 'string') fail('Work bootstrap returned no id.');

  return workId;
}

async function bootstrapAgentWorkflowAssociation(
  agentVersionId,
  definitionId,
  definitionVersionId,
) {
  const version = await readPublished(
    `${baseUrl}/api/v1/agent-versions/${agentVersionId}`,
  );
  const agentDefinitionId = version.definition_id;
  if (typeof agentDefinitionId !== 'string')
    fail('Agent bootstrap returned no definition id.');

  const databaseUrl =
    process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
  if (!databaseUrl)
    fail(
      'DATABASE_URL or POSTGRES_URL is required to bootstrap agent workflows.',
    );

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query(
      `INSERT INTO agent_work_bindings
         (tenant_id,workspace_id,principal_type,principal_id,agent_definition_id,work_definition_id,active_work_definition_version_id,status,created_at,updated_at)
       SELECT tenant_id,workspace_id,principal_type,principal_id,$1,id,$3,'enabled',now(),now()
         FROM work_definition_source_definitions
        WHERE id=$2
       ON CONFLICT (tenant_id,workspace_id,principal_type,principal_id,agent_definition_id,work_definition_id)
       DO UPDATE SET active_work_definition_version_id=EXCLUDED.active_work_definition_version_id,status='enabled',updated_at=EXCLUDED.updated_at`,
      [agentDefinitionId, definitionId, definitionVersionId],
    );
    if (result.rowCount === 0) {
      const existing = await pool.query(
        `SELECT b.active_work_definition_version_id,b.status
           FROM agent_work_bindings b
           JOIN work_definition_source_definitions d
            ON d.id=b.work_definition_id
            AND d.tenant_id=b.tenant_id
            AND d.workspace_id=b.workspace_id
            AND d.principal_type=b.principal_type
            AND d.principal_id=b.principal_id
          WHERE b.agent_definition_id=$1 AND b.work_definition_id=$2`,
        [agentDefinitionId, definitionId],
      );
      const binding = existing.rows[0];
      if (
        existing.rowCount !== 1 ||
        binding.active_work_definition_version_id !== definitionVersionId ||
        binding.status !== 'enabled'
      )
        fail(
          'Agent Work binding bootstrap did not persist the requested version.',
        );
    }
  } finally {
    await pool.end();
  }
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
  } catch (error) {
    fail('Agent Server is not reachable. Start the local API first.', error);
  }
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus)
    // The numeric status rides along on the thrown Error so callers such as
    // `resolveCachedId` can tell "the id is gone" (404) apart from a real
    // outage without re-parsing this message.
    fail(
      `Agent Server bootstrap request failed (${response.status}, expected ${expectedStatus}).`,
      undefined,
      response.status,
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
// `fail()` throws rather than exiting the process directly. That keeps every
// helper above catchable (`resolveCachedId` needs to see a real Error to
// branch on `.status`), and pushes the one place this script prints
// "web bootstrap failed" and sets the exit code down to the invocation guard
// at the bottom of this file.
function fail(message, cause, status) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  if (status !== undefined) error.status = status;
  throw error;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `web bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
