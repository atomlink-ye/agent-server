import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  TeamToolHandler,
  TeamToolActor,
} from '../../application/teams/team-tools.js';
import { AGENT_SERVER_TEAM_TOOL_REFS } from '../../application/extensions/runtime-tool-grant-service.js';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../../application/agents/built-in-skills.js';
import type { TeamCommandService } from '../../application/teams/team-command-service.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import type { RuntimeToolGrant } from '../../application/extensions/runtime-tool-grant-service.js';
import { TeamContextError } from '../../application/teams/team-tool-context.js';
import { TeamExecutionError } from '../../application/ports/team-execution-repository.js';

export function registerTeamMcpTools(
  server: McpServer,
  handler: TeamToolHandler,
  actor: TeamToolActor,
  allowedTools: readonly string[] = AGENT_SERVER_TEAM_TOOL_REFS,
  authorize: (toolRef: string) => boolean = (toolRef) =>
    allowedTools.includes(toolRef),
  context?: {
    readonly resolve: (
      grant: RuntimeToolGrant,
    ) => ReturnType<TeamToolContextResolver['resolve']>;
    readonly grantId: string;
    readonly currentGrant: () => RuntimeToolGrant | null;
    readonly begin: (grantId: string) => void;
    readonly end: (grantId: string) => void;
    readonly commands: TeamCommandService;
  },
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
  if (
    context &&
    Object.values(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS).some((ref) =>
      allowedTools.includes(ref),
    )
  ) {
    const bound = context;
    const registerCanonical = (name: string, config: any, operation: any) => {
      const registration = server.registerTool(name, config, operation);
      const ref = canonicalRefForName(name);
      if (!ref || !allowedTools.includes(ref)) registration.remove();
    };
    const current = (
      ref: string,
      operation: (
        ctx: Awaited<ReturnType<typeof bound.resolve>>,
      ) => Promise<unknown>,
    ) => {
      if (!authorize(ref)) return authorizationError();
      return result(
        (async () => {
          try {
            bound.begin(bound.grantId);
          } catch {
            throw new TeamContextError('stale_state');
          }
          try {
            const grant = bound.currentGrant();
            if (!grant) throw new TeamContextError('not_allowed');
            return await operation(await bound.resolve(grant));
          } finally {
            bound.end(bound.grantId);
          }
        })(),
      );
    };
    registerCanonical(
      'team_state',
      {
        description: 'Read current Team state.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      () =>
        current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state, (ctx) =>
          bound.commands.state(ctx),
        ),
    );
    registerCanonical(
      'team_work_list',
      {
        description: 'List Team work.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      () =>
        current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList, (ctx) =>
          bound.commands.workList(ctx),
        ),
    );
    registerCanonical(
      'team_work_create',
      {
        description: 'Create Team work.',
        inputSchema: {
          subject: z.string().min(1),
          description: z.string().optional(),
          assignee: z.string().min(1),
        },
      },
      (i: { subject: string; assignee: string; description?: string }) =>
        current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate, (ctx) =>
          bound.commands.createWork(ctx, {
            subject: i.subject,
            assignee: i.assignee,
            ...(i.description === undefined
              ? {}
              : { description: i.description }),
          }),
        ),
    );
    registerCanonical(
      'team_work_accept',
      {
        description: 'Accept submitted work.',
        inputSchema: { work_ref: z.string().regex(/^work-\d+$/) },
      },
      (i: { work_ref: string }) =>
        current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept, (ctx) =>
          bound.commands.accept(ctx, { workRef: i.work_ref }),
        ),
    );
    registerCanonical(
      'team_work_request_changes',
      {
        description: 'Request changes.',
        inputSchema: {
          work_ref: z.string().regex(/^work-\d+$/),
          assignee: z.string().min(1),
          feedback: z.string().min(1),
        },
      },
      (i: { work_ref: string; assignee: string; feedback: string }) =>
        current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges, (ctx) =>
          bound.commands.requestChanges(ctx, {
            workRef: i.work_ref,
            assignee: i.assignee,
            feedback: i.feedback,
          }),
        ),
    );
    registerCanonical(
      'team_finish',
      {
        description: 'Finish Team.',
        inputSchema: {},
      },
      () =>
        current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish, (ctx) =>
          bound.commands.finish(ctx, {}),
        ),
    );
    registerCanonical(
      'team_work_checkpoint',
      {
        description: 'Record a safe work checkpoint.',
        inputSchema: { summary: z.string().min(1) },
      },
      (i: { summary: string }) =>
        current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint, (ctx) =>
          bound.commands.checkpoint(ctx, i),
        ),
    );
    registerCanonical(
      'team_work_submit',
      {
        description: 'Submit the current work attempt.',
        inputSchema: { summary: z.string().min(1) },
      },
      (i: { summary: string }) =>
        current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit, (ctx) =>
          bound.commands.submit(ctx, i),
        ),
    );
  }
}

function canonicalRefForName(name: string): string | null {
  const refs: Record<string, string> = {
    team_state: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state,
    team_work_list: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList,
    team_work_create: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate,
    team_work_accept: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept,
    team_work_request_changes:
      AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges,
    team_finish: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish,
    team_work_checkpoint: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint,
    team_work_submit: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit,
  };
  return refs[name] ?? null;
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
  } catch (error) {
    const structuredContent = {
      error:
        error instanceof TeamContextError || error instanceof TeamExecutionError
          ? error.code
          : 'internal_error',
    };
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
