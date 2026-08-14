import type { AccessContext } from '../../platform/access-context.js';
import type { SessionTurnOrigin } from '../sessions/session-turn-origin.js';
export interface Workspace {
  readonly id: string;
  readonly tenantId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface ProductSession {
  readonly id: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly publishedAgentVersionId: string;
  readonly environmentVersionId: string | null;
  readonly generation: number;
  readonly status: 'active' | 'resetting';
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface ProductSessionListItem {
  readonly sessionId: string;
  readonly title: string;
  readonly preview: string | null;
  readonly previewRole: 'user' | 'assistant' | null;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
}
export interface ProductSessionListPage {
  readonly items: readonly ProductSessionListItem[];
  readonly nextCursor: string | null;
}
export interface UserMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly sequence: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly taskId: string;
  readonly runId: string;
  readonly status: string;
  readonly createdAt: string;
}
export interface SubmitSessionTurnInput {
  readonly sessionId: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly owner: AccessContext;
  readonly origin: SessionTurnOrigin;
}
export interface SessionRepository {
  createWorkspace(name: string, owner: AccessContext): Promise<Workspace>;
  getWorkspace(id: string, owner: AccessContext): Promise<Workspace | null>;
  createSession(input: {
    workspaceId: string;
    agentVersionId: string;
    environmentVersionId?: string;
    requireEnvironment?: boolean;
    owner: AccessContext;
  }): Promise<ProductSession>;
  getSession(id: string, owner: AccessContext): Promise<ProductSession | null>;
  listSessions(
    owner: AccessContext,
    input: {
      readonly workspaceId: string;
      readonly limit: number;
      readonly cursor: string | null;
    },
  ): Promise<ProductSessionListPage>;
  listMessages(
    sessionId: string,
    owner: AccessContext,
  ): Promise<readonly UserMessage[] | null>;
  postMessage(input: SubmitSessionTurnInput): Promise<UserMessage>;
  appendAssistantMessage?(input: {
    sessionId: string;
    generation: number;
    taskId: string;
    runId: string;
    text: string;
  }): Promise<void>;
  reset(
    sessionId: string,
    owner: AccessContext,
    key: string,
  ): Promise<ProductSession | null>;
}
