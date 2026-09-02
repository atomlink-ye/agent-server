import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import type { ConversationAgentIdentityResolver } from '../../application/work-organization/conversation-agent-identity.js';
import { OpenWhisper } from '../../application/whisper/open-whisper.js';
import { SendWhisperMessage } from '../../application/whisper/send-whisper-message.js';
import type { WhisperRepository } from '../../application/ports/whisper-repository.js';
import {
  AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
  AGENT_SERVER_WHISPER_SEND_TOOL_REF,
} from '../../application/agents/built-in-skills.js';

export {
  AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
  AGENT_SERVER_WHISPER_SEND_TOOL_REF,
};

const whisperOpenInput = z.strictObject({
  partner_agent_ids: z.array(z.string().min(1).max(256)).min(1).max(8),
  opening_message: z.string().min(1).max(4096),
  topic: z.string().min(1).max(512).optional(),
  work_ref: z.string().min(1).max(256).optional(),
});
type WhisperOpenInput = z.infer<typeof whisperOpenInput>;

const whisperSendInput = z.strictObject({
  whisper_channel_id: z.string().uuid(),
  body: z.string().min(1).max(4096),
});
type WhisperSendInput = z.infer<typeof whisperSendInput>;

/**
 * Lets an agent step out of a public conversation and quietly coordinate
 * with one or more teammates, mirroring Cumora's Whisper: the human never
 * initiates this, only peeks at it afterwards (see the browser-facing
 * `/api/whispers` read routes). The caller's own identity is always
 * resolved from its current conversation, never taken from tool input, so
 * an agent can only ever whisper as itself.
 */
export function registerWhisperMcpTools(input: {
  readonly server: McpServer;
  readonly grant: AuthorizedRuntimeToolContext;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
  readonly repository: WhisperRepository;
  readonly agentIdentities: ConversationAgentIdentityResolver;
}): void {
  const { server, grant, authorize, repository, agentIdentities } = input;
  const openWhisper = new OpenWhisper(repository, agentIdentities);
  const sendWhisperMessage = new SendWhisperMessage(
    repository,
    agentIdentities,
  );

  if (grant.catalogTools.includes(AGENT_SERVER_WHISPER_OPEN_TOOL_REF)) {
    (server.registerTool as any)(
      'whisper_open',
      {
        description:
          '在公开回复之后，私下拉一个或多个队友对齐。这会打开（或复用已有的）whisper 频道并发出第一条消息。' +
          '人类看不到你在这里说了什么会参与，只能事后旁观；不要把需要人类决策的内容放在这里。',
        inputSchema: whisperOpenInput.shape,
      },
      async (args: WhisperOpenInput) => {
        const current = await authorize(AGENT_SERVER_WHISPER_OPEN_TOOL_REF);
        if (!current) return toolError('not_found');
        if (!current.chatContext)
          return toolError(
            'whisper_open 需要在对话上下文中调用，当前调用没有对话上下文。',
          );
        try {
          const { channel, message } = await openWhisper.execute({
            tenantId: current.tenantId,
            callerConversationId: current.chatContext.conversationId,
            partnerAgentDefinitionIds: args.partner_agent_ids,
            ...(args.topic === undefined ? {} : { topic: args.topic }),
            openingMessage: args.opening_message,
            triggerMessageId: current.chatContext.triggerMessageId,
            ...(args.work_ref === undefined ? {} : { workRef: args.work_ref }),
          });
          return success({
            whisper_channel_id: channel.id,
            members: channel.memberAgentDefinitionIds,
            message_id: message.id,
            sequence: message.sequence,
          });
        } catch (error) {
          return toolError(errorMessage(error));
        }
      },
    );
  }

  if (grant.catalogTools.includes(AGENT_SERVER_WHISPER_SEND_TOOL_REF)) {
    (server.registerTool as any)(
      'whisper_send',
      {
        description:
          '在你已经是成员的 whisper 频道里发一条后续消息。频道 id 来自 whisper_open 的返回值。',
        inputSchema: whisperSendInput.shape,
      },
      async (args: WhisperSendInput) => {
        const current = await authorize(AGENT_SERVER_WHISPER_SEND_TOOL_REF);
        if (!current) return toolError('not_found');
        if (!current.chatContext)
          return toolError(
            'whisper_send 需要在对话上下文中调用，当前调用没有对话上下文。',
          );
        try {
          const message = await sendWhisperMessage.execute({
            tenantId: current.tenantId,
            callerConversationId: current.chatContext.conversationId,
            whisperChannelId: args.whisper_channel_id,
            body: args.body,
          });
          return success({
            whisper_channel_id: message.whisperChannelId,
            message_id: message.id,
            sequence: message.sequence,
          });
        } catch (error) {
          return toolError(errorMessage(error));
        }
      },
    );
  }
}

function success(value: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function toolError(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'whisper_failed';
}
