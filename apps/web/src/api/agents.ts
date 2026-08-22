import type { Coworker } from '../components/chat/contracts';

export interface CoworkerProfile {
  readonly agent: Coworker;
  readonly capabilities: {
    readonly modelPolicyRef: string;
    readonly proposalLimit: number | null;
    readonly tools: readonly string[];
    readonly skills: readonly string[];
  };
}

export async function loadCoworkerProfile(
  agentId: string,
): Promise<CoworkerProfile> {
  const response = await fetch(
    `/api/agents/${encodeURIComponent(agentId)}/profile`,
    {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      errorMessage(payload, 'Coworker profile could not be loaded.'),
    );
  const root = record(payload);
  const agent = record(root?.agent);
  const capabilities = record(root?.capabilities);
  if (!agent || !capabilities) throw new Error('Invalid Coworker profile.');
  return {
    agent: {
      id: text(agent.id),
      displayName: text(agent.display_name),
      roleLabel: nullableText(agent.role_label),
      summary: nullableText(agent.summary),
      activeAgentVersionId: text(agent.active_agent_version_id),
      runtimeStatus: runtimeStatus(agent.runtime_status),
    },
    capabilities: {
      modelPolicyRef: text(capabilities.model_policy_ref),
      proposalLimit:
        capabilities.proposal_limit === null
          ? null
          : integer(capabilities.proposal_limit),
      tools: strings(capabilities.tools),
      skills: strings(capabilities.skills),
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Invalid Coworker profile.');
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error('Invalid Coworker capability list.');
  return value as string[];
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error('Invalid Coworker profile.');
  return value as number;
}
function runtimeStatus(value: unknown): Coworker['runtimeStatus'] {
  if (value === 'available' || value === 'draining' || value === 'unavailable')
    return value;
  throw new Error('Invalid Coworker runtime status.');
}
function errorMessage(payload: unknown, fallback: string): string {
  const error = record(record(payload)?.error);
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message
    : fallback;
}
