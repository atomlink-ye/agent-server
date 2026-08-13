#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createApp } from '../../src/entrypoints/api/app.ts';
import {
  CreateWorkResponseSchema,
  GetWorkResponseSchema,
  StartWorkRunResponseSchema,
  WorkDefinitionResponseSchema,
  WorkListResponseSchema,
  WorkRunListResponseSchema,
} from '../../src/contracts/product-work-commands.ts';
import {
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
} from '../../src/contracts/product-projection/index.ts';

const MANIFEST_PATH = fileURLToPath(
  new URL('../../src/contracts/product-accepted-subset.v1.json', import.meta.url),
);
const OWNER = Object.freeze({
  tenantId: 'tenant_guard',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  principalType: 'service_account',
  principalId: 'svc_guard',
  serviceAccountId: 'svc_guard',
  policySnapshotVersion: 'policy-guard',
});
const TOKEN = 'token-create-app-guard';
const WORK_ID = '00000000-0000-4000-8000-000000000010';
const WORK_RUN_ID = '00000000-0000-4000-8000-000000000011';
const ROOT_TASK_ID = '00000000-0000-4000-8000-000000000012';
const TEAM_RUN_ID = '00000000-0000-4000-8000-000000000013';
const WORK_ITEM_ID = '00000000-0000-4000-8000-000000000014';
const ACTOR_ID = '00000000-0000-4000-8000-000000000015';
const DEFINITION_ID = '00000000-0000-4000-8000-000000000020';
const DEFINITION_VERSION_ID = '00000000-0000-4000-8000-000000000021';
const AGENT_VERSION_ID = '00000000-0000-4000-8000-000000000022';
const ENVIRONMENT_VERSION_ID = '00000000-0000-4000-8000-000000000023';
const NOW = '2026-08-14T00:00:00.000Z';
const MUTATION = process.env.GUARD_CREATE_APP_MUTATION;

const responseSchemas = new Map([
  ['CreateWorkResponseSchema', CreateWorkResponseSchema],
  ['GetWorkResponseSchema', GetWorkResponseSchema],
  ['ProductWorkRunResponseSchema', ProductWorkRunResponseSchema],
  ['ProductRunTraceResponseSchema', ProductRunTraceResponseSchema],
  ['StartWorkRunResponseSchema', StartWorkRunResponseSchema],
  ['WorkDefinitionResponseSchema', WorkDefinitionResponseSchema],
  ['WorkListResponseSchema', WorkListResponseSchema],
  ['WorkRunListResponseSchema', WorkRunListResponseSchema],
]);

const work = {
  id: WORK_ID,
  tenantId: OWNER.tenantId,
  workspaceId: OWNER.workspaceId,
  definitionId: DEFINITION_ID,
  currentDefinitionVersionId: DEFINITION_VERSION_ID,
  title: 'createApp guard work',
  origin: 'created',
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const workResponse = {
  id: WORK_ID,
  tenant_id: OWNER.tenantId,
  workspace_id: OWNER.workspaceId,
  definition_id: DEFINITION_ID,
  definition_version_id: DEFINITION_VERSION_ID,
  title: work.title,
  origin: 'created',
  archived_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const workRun = {
  id: WORK_RUN_ID,
  tenantId: OWNER.tenantId,
  workspaceId: OWNER.workspaceId,
  workId: WORK_ID,
  definitionVersionId: DEFINITION_VERSION_ID,
  triggerKind: 'manual',
  triggerRef: 'guard-trigger',
  idempotencyKey: 'guard-idempotency-key',
  rootTaskId: ROOT_TASK_ID,
  expiresAt: '2026-08-14T00:15:00.000Z',
  boundAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

const workRunResponse = {
  id: WORK_RUN_ID,
  work_id: WORK_ID,
  definition_version_id: DEFINITION_VERSION_ID,
  trigger_kind: 'manual',
  trigger_ref: workRun.triggerRef,
  expires_at: workRun.expiresAt,
  bound_at: NOW,
  created_at: NOW,
  updated_at: NOW,
};

const definition = {
  id: DEFINITION_ID,
  tenantId: OWNER.tenantId,
  workspaceId: OWNER.workspaceId,
  principalType: OWNER.principalType,
  principalId: OWNER.principalId,
  name: 'Guard Team',
  description: 'Deterministic createApp guard fixture',
  createdAt: NOW,
  updatedAt: NOW,
};

const version = {
  id: DEFINITION_VERSION_ID,
  definitionId: DEFINITION_ID,
  tenantId: OWNER.tenantId,
  workspaceId: OWNER.workspaceId,
  principalType: OWNER.principalType,
  principalId: OWNER.principalId,
  status: 'published',
  name: 'Guard Team v1',
  description: 'Deterministic createApp guard fixture',
  environmentVersionId: ENVIRONMENT_VERSION_ID,
  spec: {
    lead: { name: 'lead', agentVersionId: AGENT_VERSION_ID },
    roster: [{ name: 'member', agentVersionId: AGENT_VERSION_ID }],
    environmentVersionId: ENVIRONMENT_VERSION_ID,
  },
  createdAt: NOW,
  updatedAt: NOW,
  publishedAt: NOW,
};

const workListItem = {
  ...workResponse,
  product_state: 'not_captured',
  latest_run_summary: null,
};

const projectionIdentity = {
  work_items: [
    {
      id: WORK_ITEM_ID,
      subject: 'Guard work item',
      description: null,
      status: 'pending',
      actor_id: ACTOR_ID,
      dependency_ids: [],
      attempts: [],
      source_refs: {
        root_task_id: ROOT_TASK_ID,
        team_run_id: TEAM_RUN_ID,
      },
    },
  ],
  actors: [
    {
      id: ACTOR_ID,
      name: 'guard-member',
      source_refs: {
        root_task_id: ROOT_TASK_ID,
        team_run_id: TEAM_RUN_ID,
      },
    },
  ],
  messages: [],
};

const productWorkRunDetail = {
  ...workRunResponse,
  product_state: 'not_captured',
  problem_kind: 'not_captured',
  attention_reason: 'not_captured',
  result_summary: null,
  result_capture_status: 'not_captured',
  control_revision: null,
  cancel_availability: 'not_captured',
  completion_decision_availability: 'not_captured',
};

const validWorkRunProjection = {
  work: workResponse,
  work_run: productWorkRunDetail,
  projection_status: 'internally_anchored',
  ...projectionIdentity,
};

const validTraceProjection = {
  ...validWorkRunProjection,
  runs: [],
  events: [],
  edges: [],
  mcp_activities: [],
  timeline_coverage: {
    scope: 'mcp_dispatch_and_confirmation',
    completeness: 'mcp_only',
    excluded_execution: [
      'direct_shell',
      'direct_file_edit',
      'other_non_mcp_execution',
    ],
  },
};

const endpointRequests = new Map([
  [
    'create_work',
    {
      body: {
        definition_id: DEFINITION_ID,
        definition_version_id: DEFINITION_VERSION_ID,
        title: work.title,
      },
    },
  ],
  ['get_run_trace', {}],
  ['get_work', {}],
  ['get_work_definition', {}],
  ['get_work_run', {}],
  ['list_work_runs', {}],
  ['list_works', {}],
  [
    'start_work_run',
    { body: { trigger_kind: 'manual', trigger_ref: 'guard-trigger' } },
  ],
]);

function fail(code, detail = '') {
  process.stderr.write(`FAIL:${code}${detail ? `:${detail}` : ''}\n`);
  return 1;
}

function missing(endpointId) {
  process.stderr.write(`MISSING:${endpointId}\n`);
  return 2;
}

function ownerScopeMatches(value) {
  return (
    value?.tenantId === OWNER.tenantId &&
    value?.workspaceId === OWNER.workspaceId
  );
}

function assertOwner(value, label) {
  if (!ownerScopeMatches(value))
    throw new Error(`owner_scope_not_forwarded:${label}`);
}

function pathFor(path) {
  return path
    .replace('{work_id}', WORK_ID)
    .replace('{work_run_id}', WORK_RUN_ID);
}

function createMinimalDependencies(observed, mutation) {
  const recordAccess = (input, label) => {
    assertOwner(input.accessContext, label);
    observed.push(label);
  };
  const recordScope = (input, label) => {
    assertOwner(input, label);
    observed.push(label);
  };
  const dependencies = {
    config: {
      serviceName: 'create-app-guard',
      serviceAccounts: [
        {
          serviceAccountId: OWNER.serviceAccountId,
          token: TOKEN,
          tenantId: OWNER.tenantId,
          workspaceId: OWNER.workspaceId,
          policyVersion: OWNER.policySnapshotVersion,
          disabled: false,
        },
      ],
    },
    logger: { log() {} },
    readiness: {
      async check() {
        return [];
      },
    },
    runtime: {},
    submitRun: {},
    getRun: {},
    invokeTask: {},
    getTask: {},
    getTaskTree: {},
    createMemoryProposal: {},
    listMemoryProposals: {},
    reviewMemoryProposal: {},
    listMemoryEntries: {},
    agentRegistry: {},
    workIdentity: {
      async createWork(input) {
        recordAccess(input, 'createWork');
        return work;
      },
      async listWorks(input) {
        recordAccess(input, 'listWorks');
        return { items: [work], nextCursor: null };
      },
      async listWorkRuns(input) {
        recordAccess(input, 'listWorkRuns');
        return { items: [workRun], nextCursor: null };
      },
      async getWorkDefinition(input) {
        recordAccess(input, 'getWorkDefinition');
        return { definition, version };
      },
    },
    startWorkRun: {
      async execute(input) {
        recordAccess(input, 'startWorkRun');
        return {
          workRun,
          executionReceipt: { reused: false, taskId: ROOT_TASK_ID },
        };
      },
    },
    productProjection: {
      async getWork(input) {
        recordScope(input, 'getWork');
        return { work: workResponse };
      },
      async getWorkListItem(input) {
        recordScope(
          {
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
          },
          'getWorkListItem',
        );
        return workListItem;
      },
      async getWorkRun(input) {
        recordScope(input, 'getWorkRun');
        return validWorkRunProjection;
      },
      async getRunTrace(input) {
        recordScope(input, 'getRunTrace');
        return validTraceProjection;
      },
    },
  };

  if (mutation === 'omit_product_projection') {
    const { productProjection: _omitted, ...mutated } = dependencies;
    return mutated;
  }
  return dependencies;
}

async function readInventory() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const endpoints = manifest?.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length !== 8)
    throw new Error('accepted_subset_endpoint_count');
  const keys = endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
  if (
    endpoints.some((endpoint) => !endpoint?.id) ||
    new Set(endpoints.map((endpoint) => endpoint.id)).size !== 8 ||
    new Set(keys).size !== 8
  )
    throw new Error('accepted_subset_endpoint_inventory_not_unique');
  return endpoints;
}

async function main() {
  if (
    MUTATION !== undefined &&
    MUTATION !== '' &&
    MUTATION !== 'omit_product_projection'
  )
    return fail('mutation_invalid', MUTATION);

  let endpoints;
  try {
    endpoints = await readInventory();
  } catch (error) {
    return fail(
      'inventory_invalid',
      error instanceof Error ? error.message : 'unknown',
    );
  }

  for (const endpoint of endpoints) {
    if (!endpointRequests.has(endpoint.id))
      return fail('inventory_endpoint_not_supported', endpoint.id);
    if (!responseSchemas.has(endpoint.response_schema))
      return fail('response_schema_not_supported', endpoint.response_schema);
  }

  const observed = [];
  const app = createApp(
    createMinimalDependencies(observed, MUTATION === '' ? undefined : MUTATION),
  );
  for (const endpoint of endpoints) {
    const request = endpointRequests.get(endpoint.id);
    const body =
      request.body === undefined ? undefined : JSON.stringify(request.body);
    const response = await app.request(
      new Request(`http://create-app-guard${pathFor(endpoint.path)}`, {
        method: endpoint.method,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body }),
      }),
    );
    const responseBody = await response.json().catch(() => null);
    if (
      response.status === 404 &&
      responseBody?.error?.code === 'route_not_found'
    )
      return missing(endpoint.id);
    if (!endpoint.success.some((success) => success.status === response.status))
      return fail('response_status', `${endpoint.id}:${response.status}`);
    const schema = responseSchemas.get(endpoint.response_schema);
    if (!schema.safeParse(responseBody).success)
      return fail('response_shape', endpoint.id);
  }

  if (!observed.includes('createWork') || !observed.includes('startWorkRun'))
    return fail('access_context_positive_control_missing');
  process.stdout.write(
    `${JSON.stringify({
      guard: 'createApp-product-accepted-endpoints',
      endpoints: endpoints.length,
      owner_scope: {
        tenant_id: OWNER.tenantId,
        workspace_id: OWNER.workspaceId,
      },
      access_context_positive_control: true,
      observed_dependencies: observed,
    })}\n`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.exitCode = fail(
      'harness_error',
      error instanceof Error ? error.message : 'unknown',
    );
  });
