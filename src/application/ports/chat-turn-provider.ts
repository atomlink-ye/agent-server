import type { ExecutionExtensionBinding } from './execution-plane.js';
import type { ResolvedChatBrain } from '../chat/chat-brain-resolver.js';

export interface ChatTurnMessage {
  readonly messageId?: string;
  readonly sequence?: number;
  readonly authorType: 'principal' | 'agent_definition';
  readonly authorId: string;
  readonly body: string;
  readonly workRef?: string | null;
  readonly deliveryId?: string | null;
}

export type ChatTurnMode = 'bootstrap' | 'delta' | 'recover';

export interface ChatTurnWindow {
  /** bootstrap for a new epoch, delta for a healthy already-admitted epoch. */
  readonly modeHint: Exclude<ChatTurnMode, 'recover'>;
  readonly fromSequenceExclusive: number;
  readonly throughSequence: number;
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
    /** Server-derived durable message that triggered this activation. */
    readonly triggerMessageId: string;
    readonly brain: ResolvedChatBrain;
    /** Messages admitted by this activation. Healthy sessions receive deltas only. */
    readonly messages: readonly ChatTurnMessage[];
    /** Bounded canonical snapshot used only for bootstrap/recovery. */
    readonly recoveryMessages?: readonly ChatTurnMessage[];
    readonly turn?: ChatTurnWindow;
    readonly extensions?: ExecutionExtensionBinding;
  }): Promise<{
    readonly body: string;
    readonly provider: string;
    readonly mode?: ChatTurnMode;
  }>;
}
