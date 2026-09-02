export interface WhisperOrigin {
  readonly conversationId: string | null;
  readonly triggerMessageId: string | null;
  readonly workRef: string | null;
}

export interface WhisperChannel {
  readonly id: string;
  readonly tenantId: string;
  readonly topic: string | null;
  readonly memberAgentDefinitionIds: readonly string[];
  readonly initiatedByAgentDefinitionId: string;
  readonly origin: WhisperOrigin;
  readonly nextSequence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Deterministic dedup key for a two-agent whisper, mirroring
 * `directPairKey`. Whispers with three or more members are always distinct
 * rooms (no reuse), same as Cumora's pull_group vs. dm_with split.
 */
export function whisperPairKey(
  tenantId: string,
  agentDefinitionIds: readonly string[],
): string | null {
  if (agentDefinitionIds.length !== 2) return null;
  const [first, second] = [...agentDefinitionIds].sort();
  return `whisper:${tenantId}:${first}:${second}`;
}
