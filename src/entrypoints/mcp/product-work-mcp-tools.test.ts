import { describe, expect, it, vi } from 'vitest';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import {
  AGENT_SERVER_PRODUCT_WORK_READ_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_READ_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_TRANSCRIPT_TOOL_REF,
} from '../../application/agents/built-in-skills.js';
import { registerProductWorkMcpTools } from './product-work-mcp-tools.js';

type Handler = (args: Record<string, unknown>) => Promise<{
  readonly isError?: boolean;
  readonly content: readonly { readonly text: string }[];
}>;

const workId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';

function grant(conversationId: string): AuthorizedRuntimeToolContext {
  const refs = [
    AGENT_SERVER_PRODUCT_WORK_READ_TOOL_REF,
    AGENT_SERVER_PRODUCT_WORK_RUN_READ_TOOL_REF,
    AGENT_SERVER_PRODUCT_WORK_RUN_TRANSCRIPT_TOOL_REF,
  ];
  return {
    grantId: `grant-${conversationId}`,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    principalType: 'service_account',
    principalId: 'service-account-a',
    scopeId: 'scope-a',
    allowedTools: refs,
    catalogTools: refs,
    runtimeSession: {} as never,
    generation: {} as never,
    chatContext: { conversationId, triggerMessageId: 'message-a' },
  };
}

function register(current: AuthorizedRuntimeToolContext) {
  const handlers = new Map<string, Handler>();
  const projection = {
    getWorkListItem: vi.fn().mockResolvedValue({
      id: workId,
      tenant_id: 'tenant-a',
      workspace_id: 'workspace-a',
      definition_id: '00000000-0000-4000-8000-000000000003',
      definition_version_id: '00000000-0000-4000-8000-000000000004',
      title: 'Private Work',
      origin: 'created',
      archived_at: null,
      created_at: '2026-09-07T00:00:00.000Z',
      updated_at: '2026-09-07T00:00:00.000Z',
      product_state: 'problem',
      latest_run_summary: {
        id: runId,
        updated_at: '2026-09-07T00:00:00.000Z',
        result_summary: null,
        result_capture_status: 'not_present',
      },
    }),
    getRunTrace: vi.fn().mockResolvedValue({
      projection_status: 'internally_anchored',
      work: { id: workId },
      work_run: { id: runId, product_state: 'problem' },
      runs: [{ status: 'failed', error_code: 'worker_timeout' }],
      actors: [{ id: 'actor-a', name: 'Worker A' }],
      messages: [],
      mcp_activities: Array.from({ length: 201 }, (_, index) => ({
        activity_id: `activity-${index}`,
      })),
    }),
  };
  const server = {
    registerTool(
      name: string,
      _config: Record<string, unknown>,
      handler: Handler,
    ) {
      handlers.set(name, handler);
    },
  };
  registerProductWorkMcpTools({
    server: server as never,
    grant: current,
    authorize: async () => current,
    workIdentity: {
      findWorkById: async () =>
        ({
          id: workId,
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
        }) as never,
    } as never,
    startWorkRun: {} as never,
    productProjection: projection as never,
    sessionTranscripts: {
      execute: vi.fn().mockResolvedValue({
        work_id: workId,
        work_run_id: runId,
        capture_scope: 'safe_run_events',
        sessions: [
          {
            label: {
              name: 'Worker A',
              role: null,
              status: 'failed',
              status_basis: 'agent_runs',
              source_refs: {},
            },
            summary: {
              status: 'failed',
              entry_count: 1,
              last_timestamp: null,
              last_meaningful: null,
              work_refs: [],
              truncated: true,
            },
            entries: [],
          },
        ],
      }),
    },
    conversationWorkLinks: {
      findConversationIdByWork: async () => 'conversation-a',
    } as never,
  });
  return { handlers, projection };
}

describe('Coworker Work inspection MCP tools', () => {
  it('lets the current chat turn inspect its Work projection', async () => {
    const setup = register(grant('conversation-a'));
    const response = await setup.handlers.get('product_work_read')!({
      work_id: workId,
    });

    expect(response.isError).toBeUndefined();
    expect(JSON.parse(response.content[0]!.text).work.product_state).toBe(
      'problem',
    );
    expect(setup.projection.getWorkListItem).toHaveBeenCalledOnce();
  });

  it('authorization canary: another Agent cannot query the same Work id', async () => {
    const setup = register(grant('conversation-b'));
    const response = await setup.handlers.get('product_work_read')!({
      work_id: workId,
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toBe('not_found');
    expect(setup.projection.getWorkListItem).not.toHaveBeenCalled();
  });

  it('preserves projection failure codes and discloses bounded trace/transcript output', async () => {
    const setup = register(grant('conversation-a'));
    const run = await setup.handlers.get('product_work_run_read')!({
      work_id: workId,
      work_run_id: runId,
    });
    const transcript = await setup.handlers.get('product_work_run_transcript')!(
      {
        work_id: workId,
        work_run_id: runId,
      },
    );

    const runBody = JSON.parse(run.content[0]!.text);
    expect(runBody.runs[0]).toMatchObject({
      status: 'failed',
      error_code: 'worker_timeout',
    });
    expect(runBody.actors[0].name).toBe('Worker A');
    expect(runBody.mcp_activities).toHaveLength(200);
    expect(runBody.mcp_activities_truncated).toBe(true);
    expect(
      JSON.parse(transcript.content[0]!.text).sessions[0].summary.truncated,
    ).toBe(true);
  });

  it('rejects caller-selected identity or scope fields', () => {
    const setup = register(grant('conversation-a'));
    const result = (setup.handlers.get('product_work_read')! as Handler)({
      work_id: workId,
      agent_id: 'foreign-agent',
    });
    return expect(result).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'invalid_request' }],
    });
  });
});
