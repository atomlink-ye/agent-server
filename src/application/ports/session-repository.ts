import type { AccessContext } from '../control-plane/access-context.js';
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
  readonly generation: number;
  readonly status: 'active' | 'resetting';
  readonly createdAt: string;
  readonly updatedAt: string;
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
export interface SessionRepository {
  createWorkspace(name: string, owner: AccessContext): Promise<Workspace>;
  getWorkspace(id: string, owner: AccessContext): Promise<Workspace | null>;
  createSession(input: {
    workspaceId: string;
    agentVersionId: string;
    owner: AccessContext;
  }): Promise<ProductSession>;
  getSession(id: string, owner: AccessContext): Promise<ProductSession | null>;
  listMessages(
    sessionId: string,
    owner: AccessContext,
  ): Promise<readonly UserMessage[] | null>;
  postMessage(
    sessionId: string,
    text: string,
    key: string,
    owner: AccessContext,
  ): Promise<UserMessage>;
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
