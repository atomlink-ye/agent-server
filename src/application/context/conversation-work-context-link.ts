import type {
  ConversationWorkLink,
  ConversationWorkLinkRepository,
} from '../../domain/chat/chat-work-origin-ref.js';
import { workContextScope } from '../../domain/context/context-fs.js';
import type { LogicalFileStore } from '../ports/logical-file-store.js';

const CONVERSATION_INPUT_PATH = 'input/conversation.json';

/**
 * Decorates the durable Conversation↔Work link with one explicit, bounded
 * ContextFS admission. Workers receive only this reference, never an implicit
 * mount of the originating private Conversation namespace.
 */
export class ConversationWorkContextLink implements ConversationWorkLinkRepository {
  public constructor(
    private readonly links: ConversationWorkLinkRepository,
    private readonly files: LogicalFileStore,
  ) {}

  public async linkWorkToConversation(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
    readonly conversationId: string;
    readonly triggerMessageId: string;
  }): Promise<ConversationWorkLink> {
    const link = await this.links.linkWorkToConversation(input);
    const scope = workContextScope(input);
    const content = JSON.stringify(
      {
        conversation_id: input.conversationId,
        trigger_message_id: input.triggerMessageId,
      },
      null,
      2,
    );
    const existing = await this.files.read(scope, CONVERSATION_INPUT_PATH);
    if (existing?.content !== content) {
      await this.files.write({
        scope,
        path: CONVERSATION_INPUT_PATH,
        content,
      });
    }
    return link;
  }

  public findConversationIdByWork(
    input: Parameters<ConversationWorkLinkRepository['findConversationIdByWork']>[0],
  ) {
    return this.links.findConversationIdByWork(input);
  }

  public findRecentWorkByConversation(
    input: Parameters<
      ConversationWorkLinkRepository['findRecentWorkByConversation']
    >[0],
  ) {
    return this.links.findRecentWorkByConversation(input);
  }

  public findWorkIdsByOrigin(
    input: Parameters<ConversationWorkLinkRepository['findWorkIdsByOrigin']>[0],
  ) {
    return this.links.findWorkIdsByOrigin(input);
  }
}

export { CONVERSATION_INPUT_PATH };
