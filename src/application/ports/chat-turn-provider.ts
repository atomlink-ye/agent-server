import type { ExecutionExtensionBinding } from './execution-plane.js';

export interface ChatTurnMessage {
  readonly authorType: 'principal' | 'agent_definition';
  readonly authorId: string;
  readonly body: string;
}

export const CHAT_AGENT_HOME_NAMESPACE_ALLOWLIST = [
  'definition',
  'organization',
  'space',
  'agent-shared',
  'user',
  'conversation',
] as const;

export type ChatAgentHomeNamespace =
  (typeof CHAT_AGENT_HOME_NAMESPACE_ALLOWLIST)[number];

export interface ChatAgentHomeEntry {
  readonly path: string;
  readonly content: string;
}

/**
 * `work` and `scratch` are deliberately absent: a plain chat turn has neither
 * a Work reference nor a runtime-session scope to resolve them safely.
 */
export type ChatAgentHomeProjection = Readonly<
  Partial<Record<ChatAgentHomeNamespace, readonly ChatAgentHomeEntry[]>>
>;

export type ChatTurnCapabilitySummary = Readonly<Record<string, unknown>>;

export interface ChatTurnProvider {
  runTurn(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly agentVersionId: string;
    readonly conversationId: string;
    /** Server-derived durable message that triggered this turn. */
    readonly triggerMessageId: string;
    readonly instructions: string;
    readonly capabilitySummary: ChatTurnCapabilitySummary;
    readonly agentHome: ChatAgentHomeProjection;
    readonly messages: readonly ChatTurnMessage[];
    readonly extensions?: ExecutionExtensionBinding;
  }): Promise<{ readonly body: string }>;
}
