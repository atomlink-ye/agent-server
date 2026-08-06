import { z } from 'zod';
import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../../application/agents/built-in-skills.js';
import type { TeamCommandService } from '../../application/teams/team-command-service.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import type { RuntimeToolGrant } from '../../application/extensions/runtime-tool-grant-service.js';
import { TeamContextError } from '../../application/teams/team-tool-context.js';
import { TeamExecutionError } from '../../application/ports/team-execution-repository.js';

export interface CanonicalTeamToolContext {
  readonly resolve: (
    grant: RuntimeToolGrant,
  ) => ReturnType<TeamToolContextResolver['resolve']>;
  readonly grantId: string;
  readonly currentGrant: () => RuntimeToolGrant | null;
  readonly begin: (grantId: string) => void;
  readonly end: (grantId: string) => void;
  readonly commands: TeamCommandService;
}

export function registerTeamMcpTools(
  server: McpServer,
  allowedTools: readonly string[],
  authorize: (toolRef: string) => boolean,
  context: CanonicalTeamToolContext,
): (allowedTools: readonly string[]) => void {
  const catalog = new Set(allowedTools);
  const register = <Input extends z.ZodRawShape>(
    ref: string,
    name: string,
    config: { inputSchema: Input } & Record<string, unknown>,
    operation: (args: z.infer<z.ZodObject<Input>>) => unknown,
  ) => {
    (server.registerTool as any)(name, config, operation) as RegisteredTool;
  };
  const current = (
    ref: string,
    operation: (
      ctx: Awaited<ReturnType<typeof context.resolve>>,
    ) => Promise<unknown>,
  ) => {
    if (!authorize(ref)) return authorizationError();
    return result(
      (async () => {
        try {
          context.begin(context.grantId);
        } catch {
          throw new TeamContextError('stale_state');
        }
        try {
          const grant = context.currentGrant();
          if (!grant) throw new TeamContextError('not_allowed');
          return await operation(await context.resolve(grant));
        } finally {
          context.end(context.grantId);
        }
      })(),
    );
  };
  const canonical = (ref: string, name: string, config: any, operation: any) =>
    catalog.has(ref) && register(ref, name, config, operation);

  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state,
    'team_state',
    {
      description: 'Read current Team state.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state, (ctx) =>
        context.commands.state(ctx),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList,
    'team_work_list',
    {
      description: 'List Team work.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList, (ctx) =>
        context.commands.workList(ctx),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate,
    'team_work_create',
    {
      description: 'Create Team work.',
      inputSchema: {
        subject: z.string().min(1),
        description: z.string().optional(),
        assignee: z.string().min(1),
        dependency_refs: z
          .array(z.string().regex(/^work-\d+$/))
          .max(4)
          .optional(),
      },
    },
    (input: {
      subject: string;
      assignee: string;
      description?: string;
      dependency_refs?: string[];
    }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate, (ctx) =>
        context.commands.createWork(ctx, {
          subject: input.subject,
          assignee: input.assignee,
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.dependency_refs === undefined
            ? {}
            : { dependencyRefs: input.dependency_refs }),
        }),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend,
    'team_message_send',
    {
      description: 'Send an addressed direct Team message.',
      inputSchema: {
        recipient: z.string().min(1),
        summary: z.string().min(1).max(4096),
      },
    },
    (input: { recipient: string; summary: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend, (ctx) =>
        context.commands.sendMessage(ctx, input),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept,
    'team_work_accept',
    {
      description: 'Accept submitted work.',
      inputSchema: { work_ref: z.string().regex(/^work-\d+$/) },
    },
    (input: { work_ref: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept, (ctx) =>
        context.commands.accept(ctx, { workRef: input.work_ref }),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges,
    'team_work_request_changes',
    {
      description: 'Request changes.',
      inputSchema: {
        work_ref: z.string().regex(/^work-\d+$/),
        assignee: z.string().min(1),
        feedback: z.string().min(1),
      },
    },
    (input: { work_ref: string; assignee: string; feedback: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges, (ctx) =>
        context.commands.requestChanges(ctx, {
          workRef: input.work_ref,
          assignee: input.assignee,
          feedback: input.feedback,
        }),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.cancel,
    'team_work_cancel',
    {
      description: 'Abandon failed work.',
      inputSchema: { work_ref: z.string().regex(/^work-\d+$/) },
    },
    (input: { work_ref: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.cancel, (ctx) =>
        context.commands.cancel(ctx, { workRef: input.work_ref }),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish,
    'team_finish',
    { description: 'Finish Team.', inputSchema: {} },
    () =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish, (ctx) =>
        context.commands.finish(ctx, {}),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint,
    'team_work_checkpoint',
    {
      description: 'Record a safe work checkpoint.',
      inputSchema: { summary: z.string().min(1) },
    },
    (input: { summary: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint, (ctx) =>
        context.commands.checkpoint(ctx, input),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit,
    'team_work_submit',
    {
      description: 'Submit the current work attempt.',
      inputSchema: { summary: z.string().min(1) },
    },
    (input: { summary: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit, (ctx) =>
        context.commands.submit(ctx, input),
      ),
  );
  return () => undefined;
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
