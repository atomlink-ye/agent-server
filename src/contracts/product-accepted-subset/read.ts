import { z } from 'zod';
import {
  CreateWorkResponseSchema,
  CreateWorkRequestSchema,
  GetWorkResponseSchema,
  GetWorkRequestSchema,
  GetWorkRunRequestSchema,
  ListWorkRunsRequestSchema,
  ListWorksRequestSchema,
  GetRunTraceRequestSchema,
  StartWorkRunRequestSchema,
  WorkListResponseSchema,
  WorkRunListResponseSchema,
  StartWorkRunResponseSchema,
  WorkDefinitionResponseSchema,
} from '../product-work-commands.js';
import {
  GetProductExecutionDetailRequestSchema,
  ProductExecutionDetailResponseSchema,
  GetProductSessionTranscriptsRequestSchema,
  ProductSessionTranscriptsResponseSchema,
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
} from '../product-projection/index.js';

export type AcceptedEndpoint = {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly request_schema: string;
  readonly response_schema: string;
  readonly success: readonly {
    readonly status: number;
    readonly variant: string;
  }[];
  readonly errors: readonly {
    readonly status: number;
    readonly code: string;
  }[];
  readonly capabilities: readonly string[];
  readonly responseSchema: z.ZodType;
};

type ReadEndpoint = Omit<AcceptedEndpoint, 'responseSchema'> & {
  readonly responseSchema: z.ZodType;
};

const read = (endpoint: ReadEndpoint): ReadEndpoint => endpoint;

export const PRODUCT_ACCEPTED_SUBSET_READ_ENDPOINTS = [
  read({
    id: 'list_works',
    method: 'GET',
    path: '/api/v1/works',
    request_schema: 'ListWorksRequestSchema',
    response_schema: 'WorkListResponseSchema',
    responseSchema: WorkListResponseSchema,
    success: [{ status: 200, variant: 'page' }],
    errors: [
      { status: 400, code: 'invalid_request' },
      { status: 400, code: 'invalid_limit' },
      { status: 400, code: 'invalid_cursor' },
    ],
    capabilities: ['work_identity', 'opaque_pagination'],
  }),
  read({
    id: 'get_work',
    method: 'GET',
    path: '/api/v1/works/{work_id}',
    request_schema: 'GetWorkRequestSchema',
    response_schema: 'GetWorkResponseSchema',
    responseSchema: GetWorkResponseSchema,
    success: [{ status: 200, variant: 'found' }],
    errors: [
      { status: 400, code: 'invalid_request' },
      { status: 404, code: 'work_not_found' },
    ],
    capabilities: ['work_identity', 'workspace_scope'],
  }),
  read({
    id: 'get_work_definition',
    method: 'GET',
    path: '/api/v1/works/{work_id}/definition',
    request_schema: 'GetWorkRequestSchema',
    response_schema: 'WorkDefinitionResponseSchema',
    responseSchema: WorkDefinitionResponseSchema,
    success: [{ status: 200, variant: 'found' }],
    errors: [
      { status: 400, code: 'invalid_request' },
      { status: 404, code: 'work_not_found' },
    ],
    capabilities: ['work_identity', 'workspace_scope'],
  }),
  read({
    id: 'create_work',
    method: 'POST',
    path: '/api/v1/works',
    request_schema: 'CreateWorkRequestSchema',
    response_schema: 'CreateWorkResponseSchema',
    responseSchema: CreateWorkResponseSchema,
    success: [{ status: 201, variant: 'created' }],
    errors: [],
    capabilities: ['work_identity', 'workspace_scope'],
  }),
  read({
    id: 'list_work_runs',
    method: 'GET',
    path: '/api/v1/works/{work_id}/runs',
    request_schema: 'ListWorkRunsRequestSchema',
    response_schema: 'WorkRunListResponseSchema',
    responseSchema: WorkRunListResponseSchema,
    success: [{ status: 200, variant: 'page' }],
    errors: [
      { status: 400, code: 'invalid_request' },
      { status: 400, code: 'invalid_limit' },
      { status: 400, code: 'invalid_cursor' },
      { status: 404, code: 'work_not_found' },
    ],
    capabilities: ['work_identity', 'opaque_pagination', 'workspace_scope'],
  }),
  read({
    id: 'start_work_run',
    method: 'POST',
    path: '/api/v1/works/{work_id}/runs',
    request_schema: 'StartWorkRunRequestSchema',
    response_schema: 'StartWorkRunResponseSchema',
    responseSchema: StartWorkRunResponseSchema,
    success: [
      { status: 202, variant: 'new' },
      { status: 202, variant: 'reused' },
    ],
    errors: [
      { status: 400, code: 'invalid_json' },
      { status: 400, code: 'invalid_request' },
      { status: 404, code: 'work_not_found' },
      { status: 409, code: 'pending_expired' },
      { status: 409, code: 'work_run_binding_conflict' },
    ],
    capabilities: ['work_identity', 'workspace_scope'],
  }),
  read({
    id: 'get_work_run',
    method: 'GET',
    path: '/api/v1/works/{work_id}/runs/{work_run_id}',
    request_schema: 'GetWorkRunRequestSchema',
    response_schema: 'ProductWorkRunResponseSchema',
    responseSchema: ProductWorkRunResponseSchema,
    success: [{ status: 200, variant: 'internally_anchored' }],
    errors: [
      { status: 400, code: 'invalid_request' },
      { status: 404, code: 'work_run_not_found' },
      { status: 500, code: 'projection_invalid' },
      { status: 503, code: 'projection_unavailable' },
    ],
    capabilities: [
      'terminal_outcome',
      'attempt_timing',
      'rework_attempt_identity',
    ],
  }),
  read({
    id: 'get_run_trace',
    method: 'GET',
    path: '/api/v1/works/{work_id}/runs/{work_run_id}/trace',
    request_schema: 'GetRunTraceRequestSchema',
    response_schema: 'ProductRunTraceResponseSchema',
    responseSchema: ProductRunTraceResponseSchema,
    success: [{ status: 200, variant: 'internally_anchored' }],
    errors: [
      { status: 400, code: 'invalid_request' },
      { status: 404, code: 'work_run_not_found' },
      { status: 500, code: 'projection_invalid' },
      { status: 503, code: 'projection_unavailable' },
    ],
    capabilities: ['mcp_only_timeline', 'chat_detail_pointer'],
  }),
  read({
    id: 'get_execution_detail',
    method: 'GET',
    path: '/api/v1/works/{work_id}/runs/{work_run_id}/execution-detail',
    request_schema: 'GetProductExecutionDetailRequestSchema',
    response_schema: 'ProductExecutionDetailResponseSchema',
    responseSchema: ProductExecutionDetailResponseSchema,
    success: [{ status: 200, variant: 'safe_run_events' }],
    errors: [
      { status: 400, code: 'invalid_request' },
      { status: 404, code: 'work_run_not_found' },
      { status: 503, code: 'projection_unavailable' },
    ],
    capabilities: ['attempt_execution_detail', 'safe_provider_output'],
  }),
  read({
    id: 'get_session_transcripts',
    method: 'GET',
    path: '/api/v1/works/{work_id}/runs/{work_run_id}/session-transcripts',
    request_schema: 'GetProductSessionTranscriptsRequestSchema',
    response_schema: 'ProductSessionTranscriptsResponseSchema',
    responseSchema: ProductSessionTranscriptsResponseSchema,
    success: [{ status: 200, variant: 'safe_run_events' }],
    errors: [
      { status: 400, code: 'invalid_request' },
      { status: 404, code: 'work_run_not_found' },
      { status: 503, code: 'projection_unavailable' },
    ],
    capabilities: ['agent_session_transcripts', 'safe_provider_output'],
  }),
] as const;

// The checker needs the request schemas to be exported from this module so it can
// verify that every manifest identifier resolves to a real schema.
export const PRODUCT_ACCEPTED_SUBSET_READ_SCHEMAS = {
  ListWorksRequestSchema,
  GetWorkRequestSchema,
  CreateWorkRequestSchema,
  ListWorkRunsRequestSchema,
  StartWorkRunRequestSchema,
  GetWorkRunRequestSchema,
  GetRunTraceRequestSchema,
  GetProductExecutionDetailRequestSchema,
  GetProductSessionTranscriptsRequestSchema,
  WorkListResponseSchema,
  GetWorkResponseSchema,
  WorkDefinitionResponseSchema,
  CreateWorkResponseSchema,
  WorkRunListResponseSchema,
  StartWorkRunResponseSchema,
  ProductWorkRunResponseSchema,
  ProductRunTraceResponseSchema,
  ProductExecutionDetailResponseSchema,
  ProductSessionTranscriptsResponseSchema,
} as const;
