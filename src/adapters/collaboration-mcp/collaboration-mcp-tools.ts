import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  collaborationErrorCode,
  type CollaborationKernel,
} from '../../application/collaboration/collaboration-kernel.js';
import type { RuntimeToolGrant } from '../../application/extensions/runtime-tool-grant-service.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import {
  AGENT_SERVER_COLLABORATION_MCP_NAMES,
  AGENT_SERVER_COLLABORATION_TOOL_REFS,
} from '../../domain/collaboration/canonical-collaboration-tools.js';

export interface CollaborationMcpContext {
  readonly resolve: (
    grant: RuntimeToolGrant,
  ) => ReturnType<TeamToolContextResolver['resolve']>;
  readonly grantId: string;
  readonly currentGrant: () => RuntimeToolGrant | null;
  readonly begin: (grantId: string) => void;
  readonly end: (grantId: string) => void;
  readonly kernel: CollaborationKernel;
}

const WORK_REF = z.string().regex(/^W-\d+$/);
const MESSAGE_REF = z.string().regex(/^M-\d+$/);
const LOGICAL_REF = z.string().min(1).max(512);

export function registerCollaborationMcpTools(
  server: McpServer,
  catalogTools: readonly string[],
  authorize: (toolRef: string) => boolean,
  context: CollaborationMcpContext,
): void {
  const catalog = new Set(catalogTools);
  const tool = <Input extends z.ZodRawShape>(
    ref: string,
    name: string,
    description: string,
    schema: Input,
    operation: (
      input: z.infer<z.ZodObject<Input>>,
      ctx: Awaited<ReturnType<typeof context.resolve>>,
    ) => Promise<unknown>,
    readOnly = false,
  ) => {
    if (!catalog.has(ref)) return;
    (server.registerTool as any)(
      name,
      {
        description,
        inputSchema: schema,
        ...(readOnly ? { annotations: { readOnlyHint: true } } : {}),
      },
      async (args: z.infer<z.ZodObject<Input>>) => {
        if (!authorize(ref)) return failure('unauthorized', true);
        let begun = false;
        try {
          context.begin(context.grantId);
          begun = true;
          const grant = context.currentGrant();
          if (!grant) return failure('not_allowed', true);
          return success(await operation(args, await context.resolve(grant)));
        } catch (error) {
          return failure(collaborationErrorCode(error));
        } finally {
          if (begun) context.end(context.grantId);
        }
      },
    ) as RegisteredTool;
  };

  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.state,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.state,
    'Read current collaboration state.',
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
    'Create an open or explicitly assigned Workboard item.',
    {
      subject: z.string().min(1).max(4096),
      description: z.string().max(4096).optional(),
      assignee: z.string().min(1).max(256).optional(),
      dependency_refs: z.array(WORK_REF).max(4).optional(),
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
    'Assign one open Workboard item.',
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
    'Claim one open actionable Workboard item for yourself.',
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
    (input, ctx) =>
      context.kernel.submitWork(ctx, {
        summary: input.summary,
        ...(input.evidence_refs === undefined
          ? {}
          : { evidenceRefs: input.evidence_refs }),
        ...(input.artifact_refs === undefined
          ? {}
          : { artifactRefs: input.artifact_refs }),
      }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardAccept,
    'Accept a submitted Workboard item.',
    { work_ref: WORK_REF },
    (input, ctx) => context.kernel.acceptWork(ctx, { workRef: input.work_ref }),
  );
  tool(
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardRequestChanges,
    'Request semantic rework on a submitted or blocked item.',
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
    'Cancel a non-terminal Workboard item.',
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
    'Request collaboration completion after required Workboard items are accepted.',
    {},
    (_input, ctx) => context.kernel.finish(ctx),
  );
}

function success(value: unknown) {
  const structuredContent = Array.isArray(value)
    ? { items: value }
    : (value as Record<string, unknown>);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function failure(error: string, isError = false) {
  const structuredContent = { error };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}
