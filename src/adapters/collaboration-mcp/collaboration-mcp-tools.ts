import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  collaborationErrorCode,
  type CollaborationKernel,
} from '../../application/collaboration/collaboration-kernel.js';
import { TeamContextError } from '../../application/teams/team-tool-context.js';
import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import type { SyntheticToolReceipt } from '../../application/runtime/synthetic-tool-receipt.js';
import { AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF } from '../../application/agents/built-in-skills.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import {
  AGENT_SERVER_COLLABORATION_MCP_NAMES,
  AGENT_SERVER_COLLABORATION_TOOL_REFS,
} from '../../domain/collaboration/canonical-collaboration-tools.js';
import { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';

export interface CollaborationMcpContext {
  readonly resolve: (
    grant: AuthorizedRuntimeToolContext,
  ) => ReturnType<TeamToolContextResolver['resolve']>;
  readonly grant: AuthorizedRuntimeToolContext;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
  readonly kernel: CollaborationKernel;
  readonly syntheticToolReceipt?: SyntheticToolReceipt;
}

const WORK_REF = z.string().regex(/^W-\d+$/);
const MESSAGE_REF = z.string().regex(/^M-\d+$/);
const LOGICAL_REF = z.string().min(1).max(512);

/**
 * Register the complete Agent Server collaboration toolbox for a Team
 * participant. Registration is deliberately stable across roles and turns;
 * every invocation is authorized from the current grant/context and durable
 * Collaboration state.
 */
export function registerCollaborationMcpTools(
  server: McpServer,
  context: CollaborationMcpContext,
): void {
  const tool = <Input extends z.ZodRawShape>(
    _ref: string,
    name: string,
    description: string,
    schema: Input,
    operation: (
      input: z.infer<z.ZodObject<Input>>,
      ctx: Awaited<ReturnType<typeof context.resolve>>,
    ) => Promise<unknown>,
    readOnly = false,
  ) => {
    (server.registerTool as any)(
      name,
      {
        description,
        inputSchema: schema,
        ...(readOnly ? { annotations: { readOnlyHint: true } } : {}),
      },
      async (args: z.infer<z.ZodObject<Input>>) => {
        try {
          const grant = await context.authorize(_ref);
          if (!grant) return failure('unauthorized', true);
          const resolved = await context.resolve(grant);
          return success(await operation(args, resolved));
        } catch (error) {
          return failure(collaborationErrorCode(error));
        }
      },
    ) as RegisteredTool;
  };

  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.state,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.state,
    'Read current collaboration state, capabilities, limits, Workboard and Mailbox summary. Tool availability does not imply that every mutation is currently legal.',
    {},
    (_input, ctx) => context.kernel.state(ctx),
    true,
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardList,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardList,
    'Read the durable Workboard.',
    {},
    (_input, ctx) => context.kernel.boardList(ctx),
    true,
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCreate,
    'Create an open or explicitly assigned Workboard item when your participant capability allows it.',
    {
      subject: z.string().min(1).max(4096),
      description: z.string().max(4096).optional(),
      assignee: z.string().min(1).max(256).optional(),
      dependency_refs: z
        .array(WORK_REF)
        .max(COLLABORATION_LIMITS.maxDependenciesPerWorkItem)
        .optional(),
    },
    (input, ctx) =>
      context.kernel.createWork(ctx, {
        subject: input.subject,
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
        ...(input.dependency_refs === undefined
          ? {}
          : { dependencyRefs: input.dependency_refs }),
      }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAssign,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardAssign,
    'Assign one open Workboard item when authorized by collaboration policy.',
    { work_ref: WORK_REF, assignee: z.string().min(1).max(256) },
    (input, ctx) =>
      context.kernel.assignWork(ctx, {
        workRef: input.work_ref,
        assignee: input.assignee,
      }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardClaim,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardClaim,
    'Claim one open actionable Workboard item for yourself when authorized.',
    { work_ref: WORK_REF },
    (input, ctx) => context.kernel.claimWork(ctx, { workRef: input.work_ref }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCheckpoint,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCheckpoint,
    'Persist progress on the current Workboard attempt without completing it.',
    {
      summary: z.string().min(1).max(4096),
      next_step: z.string().max(4096).optional(),
      blocker: z.string().max(4096).optional(),
      evidence_refs: z.array(LOGICAL_REF).max(16).optional(),
    },
    (input, ctx) =>
      context.kernel.checkpoint(ctx, {
        summary: input.summary,
        ...(input.next_step === undefined ? {} : { nextStep: input.next_step }),
        ...(input.blocker === undefined ? {} : { blocker: input.blocker }),
        ...(input.evidence_refs === undefined
          ? {}
          : { evidenceRefs: input.evidence_refs }),
      }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardBlock,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardBlock,
    'Mark the current Workboard item blocked with a recoverable reason.',
    { summary: z.string().min(1).max(4096) },
    (input, ctx) => context.kernel.blockWork(ctx, input),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardSubmit,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardSubmit,
    'Submit the current semantic work attempt with durable evidence and artifact references.',
    {
      summary: z.string().min(1).max(4096),
      evidence_refs: z.array(LOGICAL_REF).max(16).optional(),
      artifact_refs: z.array(LOGICAL_REF).max(16).optional(),
    },
    (input, ctx) => {
      if (
        ctx.task.teamTaskKind === 'work_attempt' &&
        ctx.domainTools.includes(
          AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
        ) &&
        !context.syntheticToolReceipt?.hasExactlyOne({
          grant: ctx.grant,
          toolRef: AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
        })
      )
        throw new TeamContextError('not_allowed');
      return context.kernel.submitWork(ctx, {
        summary: input.summary,
        ...(input.evidence_refs === undefined
          ? {}
          : { evidenceRefs: input.evidence_refs }),
        ...(input.artifact_refs === undefined
          ? {}
          : { artifactRefs: input.artifact_refs }),
      });
    },
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardAccept,
    'Accept a submitted Workboard item when authorized and the transition is valid.',
    { work_ref: WORK_REF },
    (input, ctx) => context.kernel.acceptWork(ctx, { workRef: input.work_ref }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardRequestChanges,
    'Request semantic rework on a submitted or blocked item when authorized.',
    {
      work_ref: WORK_REF,
      assignee: z.string().min(1).max(256),
      feedback: z.string().min(1).max(4096),
    },
    (input, ctx) =>
      context.kernel.requestChanges(ctx, {
        workRef: input.work_ref,
        assignee: input.assignee,
        feedback: input.feedback,
      }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCancel,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCancel,
    'Cancel a non-terminal Workboard item when authorized.',
    { work_ref: WORK_REF },
    (input, ctx) => context.kernel.cancelWork(ctx, { workRef: input.work_ref }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.inboxList,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.inboxList,
    'Read durable messages addressed to the current participant.',
    {},
    (_input, ctx) => context.kernel.inboxList(ctx),
    true,
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.messageSend,
    'Persist a direct participant message. Messages never mutate Workboard ownership or status.',
    {
      recipient: z.string().min(1).max(256),
      body: z.string().min(1).max(4096),
      about_work_ref: WORK_REF.optional(),
      reply_to_ref: MESSAGE_REF.optional(),
      priority: z.enum(['normal', 'urgent']).optional(),
      requires_ack: z.boolean().optional(),
    },
    (input, ctx) =>
      context.kernel.sendMessage(ctx, {
        recipient: input.recipient,
        body: input.body,
        ...(input.about_work_ref === undefined
          ? {}
          : { aboutWorkRef: input.about_work_ref }),
        ...(input.reply_to_ref === undefined
          ? {}
          : { replyToRef: input.reply_to_ref }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.requires_ack === undefined
          ? {}
          : { requiresAck: input.requires_ack }),
      }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.messageAck,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.messageAck,
    'Acknowledge a durable message that requested acknowledgement.',
    { message_ref: MESSAGE_REF },
    (input, ctx) =>
      context.kernel.acknowledgeMessage(ctx, { messageRef: input.message_ref }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.finish,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.finish,
    'Request collaboration completion after required Workboard items are accepted and the finish transition is legal.',
    {},
    (_input, ctx) => context.kernel.finish(ctx),
  );
}

function success(value: unknown) {
  const structuredContent = Array.isArray(value)
    ? { items: value }
    : (value as Record<string, unknown>);
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

function failure(error: string, isError = false) {
  const structuredContent = { error };
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}
