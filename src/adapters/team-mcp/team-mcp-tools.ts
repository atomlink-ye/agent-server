import { z } from 'zod';
import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES,
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS,
} from '../../application/agents/built-in-skills.js';
import type { CollaborationKernel } from '../../application/collaboration/collaboration-kernel.js';
import type { TeamCommandService } from '../../application/teams/team-command-service.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import type { RuntimeToolGrant } from '../../application/extensions/runtime-tool-grant-service.js';
import { TeamContextError } from '../../application/teams/team-tool-context.js';
import { TeamExecutionError } from '../../application/ports/team-execution-repository.js';
import { registerCollaborationMcpTools } from '../collaboration-mcp/collaboration-mcp-tools.js';

export interface CanonicalTeamToolContext {
  readonly resolve: (
    grant: RuntimeToolGrant,
  ) => ReturnType<TeamToolContextResolver['resolve']>;
  readonly grantId: string;
  readonly currentGrant: () => RuntimeToolGrant | null;
  readonly begin: (grantId: string) => void;
  readonly end: (grantId: string) => void;
  readonly commands: TeamCommandService & {
    readonly collaboration?: CollaborationKernel;
  };
}

/**
 * Legacy `team_*` names are compatibility aliases only. In production the
 * mutating aliases delegate to the same CollaborationKernel used by the new
 * board/mailbox surface, so there is no second coordination state machine.
 */
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
  const collaboration = context.commands.collaboration;

  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state,
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.state,
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
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.workList,
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
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.workCreate,
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
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate, async (ctx) => {
        if (!collaboration)
          return context.commands.createWork(ctx, {
            subject: input.subject,
            assignee: input.assignee,
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            ...(input.dependency_refs === undefined
              ? {}
              : { dependencyRefs: input.dependency_refs }),
          });
        const value = await collaboration.createWork(ctx, {
          subject: input.subject,
          assignee: input.assignee,
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.dependency_refs === undefined
            ? {}
            : {
                dependencyRefs: input.dependency_refs.map(toCollaborationWorkRef),
              }),
        });
        return legacyWorkResult(value);
      }),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend,
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.messageSend,
    {
      description: 'Send an addressed direct Team message.',
      inputSchema: {
        recipient: z.string().min(1),
        summary: z.string().min(1).max(4096),
      },
    },
    (input: { recipient: string; summary: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend, async (ctx) => {
        if (!collaboration) return context.commands.sendMessage(ctx, input);
        const value = await collaboration.sendMessage(ctx, {
          recipient: input.recipient,
          body: input.summary,
        });
        return {
          sent: true,
          recipient: value.recipient,
          summary: input.summary,
        };
      }),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept,
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.accept,
    {
      description: 'Accept submitted work.',
      inputSchema: { work_ref: z.string().regex(/^work-\d+$/) },
    },
    (input: { work_ref: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept, async (ctx) => {
        if (!collaboration)
          return context.commands.accept(ctx, { workRef: input.work_ref });
        const value = await collaboration.acceptWork(ctx, {
          workRef: toCollaborationWorkRef(input.work_ref),
        });
        return legacyWorkResult(value);
      }),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges,
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.requestChanges,
    {
      description: 'Request changes.',
      inputSchema: {
        work_ref: z.string().regex(/^work-\d+$/),
        assignee: z.string().min(1),
        feedback: z.string().min(1),
      },
    },
    (input: { work_ref: string; assignee: string; feedback: string }) =>
      current(
        AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges,
        async (ctx) => {
          if (!collaboration)
            return context.commands.requestChanges(ctx, {
              workRef: input.work_ref,
              assignee: input.assignee,
              feedback: input.feedback,
            });
          const value = await collaboration.requestChanges(ctx, {
            workRef: toCollaborationWorkRef(input.work_ref),
            assignee: input.assignee,
            feedback: input.feedback,
          });
          return legacyWorkResult(value);
        },
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.cancel,
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.cancel,
    {
      description: 'Abandon work.',
      inputSchema: { work_ref: z.string().regex(/^work-\d+$/) },
    },
    (input: { work_ref: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.cancel, async (ctx) => {
        if (!collaboration)
          return context.commands.cancel(ctx, { workRef: input.work_ref });
        const value = await collaboration.cancelWork(ctx, {
          workRef: toCollaborationWorkRef(input.work_ref),
        });
        return legacyWorkResult(value);
      }),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish,
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.finish,
    { description: 'Finish Team.', inputSchema: {} },
    () =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish, (ctx) =>
        collaboration
          ? collaboration.finish(ctx)
          : context.commands.finish(ctx, {}),
      ),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint,
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.checkpoint,
    {
      description: 'Record a safe work checkpoint.',
      inputSchema: { summary: z.string().min(1) },
    },
    (input: { summary: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint, async (ctx) => {
        if (!collaboration) return context.commands.checkpoint(ctx, input);
        const value = await collaboration.checkpoint(ctx, input);
        return {
          checkpointed: value.checkpointed,
          summary: value.summary,
          status: ctx.member.status,
        };
      }),
  );
  canonical(
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit,
    AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.submit,
    {
      description: 'Submit the current work attempt.',
      inputSchema: { summary: z.string().min(1) },
    },
    (input: { summary: string }) =>
      current(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit, async (ctx) => {
        if (!collaboration) return context.commands.submit(ctx, input);
        const value = await collaboration.submitWork(ctx, input);
        return {
          work_ref: toLegacyWorkRef(value.work_ref),
          submitted: value.submitted,
          status: 'completed',
          summary: value.summary,
        };
      }),
  );

  if (collaboration)
    registerCollaborationMcpTools(server, allowedTools, authorize, {
      resolve: context.resolve,
      grantId: context.grantId,
      currentGrant: context.currentGrant,
      begin: context.begin,
      end: context.end,
      kernel: collaboration,
    });

  return () => undefined;
}

function toCollaborationWorkRef(value: string): string {
  const match = /^work-(\d+)$/.exec(value);
  if (!match) throw new TeamContextError('not_found');
  return `W-${match[1]}`;
}

function toLegacyWorkRef(value: string): string {
  const match = /^W-(\d+)$/.exec(value);
  if (!match) return value;
  return `work-${match[1]}`;
}

function legacyWorkResult<T extends Record<string, unknown>>(value: T): T {
  return {
    ...value,
    ...(typeof value.work_ref === 'string'
      ? { work_ref: toLegacyWorkRef(value.work_ref) }
      : {}),
  };
}

async function result(value: Promise<unknown>) {
  try {
    const resolved = await value;
    const structuredContent = Array.isArray(resolved)
      ? { items: resolved }
      : (resolved as Record<string, unknown>);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
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
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  }
}

function authorizationError() {
  const structuredContent = { error: 'unauthorized' };
  return Promise.resolve({
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  });
}
