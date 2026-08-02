import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  TeamToolHandler,
  TeamToolActor,
} from '../../application/teams/team-tools.js';
import { AGENT_SERVER_TEAM_TOOL_REFS } from '../../application/extensions/runtime-tool-grant-service.js';

export function registerTeamMcpTools(
  server: McpServer,
  handler: TeamToolHandler,
  actor: TeamToolActor,
  allowedTools: readonly string[] = AGENT_SERVER_TEAM_TOOL_REFS,
  authorize: (toolRef: string) => boolean = (toolRef) =>
    allowedTools.includes(toolRef),
): void {
  const id = z.string().uuid();
  const invoke = (toolRef: string, operation: () => Promise<unknown>) =>
    authorize(toolRef) ? result(operation()) : authorizationError();
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[0]!))
    server.registerTool(
      'team_members_list',
      {
        description: 'List collaborative team members.',
        inputSchema: { team_run_id: id },
        annotations: { readOnlyHint: true },
      },
      ({ team_run_id }) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[0]!, () =>
          handler.team_members_list(team_run_id, actor),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[1]!))
    server.registerTool(
      'team_task_create',
      {
        description: 'Create a collaborative team work item.',
        inputSchema: {
          team_run_id: id,
          subject: z.string().min(1),
          description: z.string().optional(),
        },
      },
      ({ team_run_id, subject, description }) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[1]!, () =>
          handler.team_task_create(team_run_id, subject, description, actor),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[2]!))
    server.registerTool(
      'team_task_list',
      {
        description: 'List collaborative team work items.',
        inputSchema: { team_run_id: id },
        annotations: { readOnlyHint: true },
      },
      ({ team_run_id }) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[2]!, () =>
          handler.team_task_list(team_run_id, actor),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[3]!))
    server.registerTool(
      'team_task_claim',
      {
        description: 'Claim a pending team work item.',
        inputSchema: { team_run_id: id, work_item_id: id },
      },
      ({ team_run_id, work_item_id }) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[3]!, () =>
          handler.team_task_claim(team_run_id, work_item_id, actor),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[4]!))
    server.registerTool(
      'team_task_update',
      {
        description: 'Update a team work item.',
        inputSchema: {
          team_run_id: id,
          work_item_id: id,
          status: z.enum([
            'pending',
            'in_progress',
            'completed',
            'blocked',
            'cancelled',
          ]),
          completion_summary: z.string().optional(),
        },
      },
      ({ team_run_id, work_item_id, status, completion_summary }) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[4]!, () =>
          handler.team_task_update(
            team_run_id,
            work_item_id,
            status,
            completion_summary,
            actor,
          ),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[5]!))
    server.registerTool(
      'team_complete',
      {
        description: 'Complete the collaborative team.',
        inputSchema: { team_run_id: id, final_text: z.string().trim().min(1) },
      },
      ({ team_run_id, final_text }) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[5]!, () =>
          handler.team_complete(team_run_id, final_text, actor),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[6]!))
    server.registerTool(
      'team_work_create_and_assign',
      {
        description: 'Assign durable work.',
        inputSchema: {
          team_run_id: id,
          subject: z.string(),
          assignee_member_id: id,
          source_run_id: id,
          lead_task_id: id,
          command_hash: z.string(),
          expected_revision: z.number().int(),
        },
      },
      (i) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[6]!, () =>
          handler.team_work_create_and_assign(
            {
              teamRunId: i.team_run_id,
              subject: i.subject,
              assigneeMemberId: i.assignee_member_id,
              sourceRunId: i.source_run_id,
              leadTaskId: i.lead_task_id,
              commandHash: i.command_hash,
              expectedRevision: i.expected_revision,
            },
            actor,
          ),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[7]!))
    server.registerTool(
      'team_work_accept',
      {
        description: 'Accept work.',
        inputSchema: {
          team_run_id: id,
          work_item_id: id,
          source_run_id: id,
          command_hash: z.string(),
          expected_revision: z.number().int(),
        },
      },
      (i) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[7]!, () =>
          handler.team_work_accept(
            {
              teamRunId: i.team_run_id,
              workItemId: i.work_item_id,
              sourceRunId: i.source_run_id,
              commandHash: i.command_hash,
              expectedRevision: i.expected_revision,
            },
            actor,
          ),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[8]!))
    server.registerTool(
      'team_work_request_rework',
      {
        description: 'Request bounded rework.',
        inputSchema: {
          team_run_id: id,
          work_item_id: id,
          assignee_member_id: id,
          feedback: z.string(),
          source_run_id: id,
          lead_task_id: id,
          command_hash: z.string(),
          expected_revision: z.number().int(),
        },
      },
      (i) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[8]!, () =>
          handler.team_work_request_rework(
            {
              teamRunId: i.team_run_id,
              workItemId: i.work_item_id,
              assigneeMemberId: i.assignee_member_id,
              feedback: i.feedback,
              sourceRunId: i.source_run_id,
              leadTaskId: i.lead_task_id,
              commandHash: i.command_hash,
              expectedRevision: i.expected_revision,
            },
            actor,
          ),
        ),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[9]!))
    server.registerTool(
      'team_completion_request',
      {
        description: 'Request completion.',
        inputSchema: {
          team_run_id: id,
          source_run_id: id,
          command_hash: z.string(),
          expected_revision: z.number().int(),
        },
      },
      (i) =>
        invoke(AGENT_SERVER_TEAM_TOOL_REFS[9]!, () =>
          handler.team_completion_request(
            {
              teamRunId: i.team_run_id,
              sourceRunId: i.source_run_id,
              commandHash: i.command_hash,
              expectedRevision: i.expected_revision,
            },
            actor,
          ),
        ),
    );
}

async function result(value: Promise<unknown>) {
  try {
    const resolved = await value;
    const structuredContent = Array.isArray(resolved)
      ? { items: resolved }
      : (resolved as Record<string, unknown>);
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(structuredContent) },
      ],
      structuredContent,
    };
  } catch {
    const structuredContent = { error: 'internal_error' };
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(structuredContent) },
      ],
      structuredContent,
    };
  }
}

function authorizationError() {
  const structuredContent = { error: 'unauthorized' };
  return Promise.resolve({
    content: [
      { type: 'text' as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
    isError: true,
  });
}
