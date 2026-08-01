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
): void {
  const id = z.string().uuid();
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[0]!))
    server.registerTool(
      'team_members_list',
      {
        description: 'List collaborative team members.',
        inputSchema: { team_run_id: id },
        annotations: { readOnlyHint: true },
      },
      ({ team_run_id }) =>
        result(handler.team_members_list(team_run_id, actor)),
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
        result(
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
      ({ team_run_id }) => result(handler.team_task_list(team_run_id, actor)),
    );
  if (allowedTools.includes(AGENT_SERVER_TEAM_TOOL_REFS[3]!))
    server.registerTool(
      'team_task_claim',
      {
        description: 'Claim a pending team work item.',
        inputSchema: { team_run_id: id, work_item_id: id },
      },
      ({ team_run_id, work_item_id }) =>
        result(handler.team_task_claim(team_run_id, work_item_id, actor)),
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
        result(
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
        result(handler.team_complete(team_run_id, final_text, actor)),
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
