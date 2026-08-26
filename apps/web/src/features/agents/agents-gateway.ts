import type {
  CapabilityInputProperty,
  CapabilityInputSchema,
  Coworker,
  CoworkerCapability,
} from './contracts';
import { apiTransport } from '../../api/transport';

export async function loadCoworkers(): Promise<readonly Coworker[]> {
  const root = record(await apiTransport.request('/api/agents'));
  if (!Array.isArray(root?.items))
    throw new Error('Invalid Coworker response.');
  return root.items.map(normalizeCoworker);
}

export interface CoworkerProfile {
  readonly agent: Coworker;
  readonly capabilities: {
    readonly modelPolicyRef: string;
    readonly proposalLimit: number | null;
    readonly tools: readonly string[];
    readonly skills: readonly string[];
  };
  readonly workCatalog: readonly CoworkerCapability[];
}

export interface CreateCoworkerDraft {
  readonly name: string;
  readonly role: string;
  readonly summary: string;
  readonly instructions?: string;
  readonly modelPolicyRef?:
    | 'free-only'
    | 'claude/deepseek-v4-flash'
    | 'codex/deepseek-v4-flash';
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
}

export interface CreateCoworkerResult {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly conversationId: string;
}

export async function createCoworker(
  draft: CreateCoworkerDraft,
): Promise<CreateCoworkerResult> {
  const payload = record(
    await apiTransport.request('/api/agents', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: draft.name,
        role: draft.role,
        summary: draft.summary,
        ...(draft.instructions?.trim()
          ? { instructions: draft.instructions }
          : {}),
        model_policy_ref: draft.modelPolicyRef ?? 'free-only',
        tools: [...(draft.tools ?? [])],
        skills: [...(draft.skills ?? [])],
      }),
    }),
  );
  if (!payload) throw new Error('Invalid Coworker creation response.');
  return {
    agentId: text(payload.agent_id),
    agentVersionId: text(payload.agent_version_id),
    conversationId: text(payload.conversation_id),
  };
}

export async function associateCapability(
  agentId: string,
  input: { readonly definitionId: string; readonly definitionVersionId: string },
): Promise<void> {
  const payload = record(
    await apiTransport.request(
      `/api/agents/${encodeURIComponent(agentId)}/capabilities`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          definition_id: input.definitionId,
          definition_version_id: input.definitionVersionId,
        }),
      },
    ),
  );
  if (!payload || payload.associated !== true)
    throw new Error('The Capability could not be added to this Coworker.');
}

export async function loadCoworkerProfile(
  agentId: string,
): Promise<CoworkerProfile> {
  const payload = await apiTransport.request(
    `/api/agents/${encodeURIComponent(agentId)}/profile`,
  );
  const root = record(payload);
  const agent = record(root?.agent);
  const capabilities = record(root?.capabilities);
  if (!agent || !capabilities) throw new Error('Invalid Coworker profile.');
  const workCatalog = Array.isArray(root?.work_catalog)
    ? root.work_catalog.map(normalizeCapability)
    : [];
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
    workCatalog,
  };
}

function normalizeCapability(value: unknown): CoworkerCapability {
  const item = record(value);
  if (!item) throw new Error('Invalid Coworker Work Catalog entry.');
  return {
    definitionId: text(item.definition_id),
    definitionVersionId: text(item.definition_version_id),
    name: text(item.name),
    description: nullableText(item.description),
    inputSchema: normalizeInputSchema(item.input_schema),
  };
}

function normalizeInputSchema(value: unknown): CapabilityInputSchema {
  const schema = record(value);
  const properties = record(schema?.properties);
  if (!schema || schema.type !== 'object' || !properties)
    throw new Error('Invalid Capability input contract.');
  const normalized: Record<string, CapabilityInputProperty> = {};
  for (const [name, raw] of Object.entries(properties)) {
    const property = record(raw);
    if (!property) throw new Error('Invalid Capability input property.');
    if (property.type === 'string') {
      normalized[name] = {
        type: 'string',
        ...(property.min_length === undefined
          ? {}
          : { minLength: integer(property.min_length) }),
        ...(property.max_length === undefined
          ? {}
          : { maxLength: integer(property.max_length) }),
        ...(property.enum === undefined
          ? {}
          : { choices: strings(property.enum) }),
      };
      continue;
    }
    if (property.type === 'number' || property.type === 'integer') {
      normalized[name] = {
        type: property.type,
        ...(property.minimum === undefined
          ? {}
          : { minimum: finiteNumber(property.minimum) }),
        ...(property.maximum === undefined
          ? {}
          : { maximum: finiteNumber(property.maximum) }),
      };
      continue;
    }
    if (property.type === 'boolean') {
      normalized[name] = { type: 'boolean' };
      continue;
    }
    throw new Error('Unsupported Capability input property.');
  }
  return {
    properties: normalized,
    required: strings(schema.required),
    additionalProperties: boolean(schema.additional_properties),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function normalizeCoworker(value: unknown): Coworker {
  const agent = record(value);
  return {
    id: text(agent?.id),
    displayName: text(agent?.display_name),
    roleLabel: nullableText(agent?.role_label),
    summary: nullableText(agent?.summary),
    activeAgentVersionId: text(agent?.active_agent_version_id),
    runtimeStatus: runtimeStatus(agent?.runtime_status),
  };
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Invalid Coworker profile.');
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
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
function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Invalid Capability numeric bound.');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new Error('Invalid Capability input contract.');
  return value;
}
function runtimeStatus(value: unknown): Coworker['runtimeStatus'] {
  if (value === 'available' || value === 'draining' || value === 'unavailable')
    return value;
  throw new Error('Invalid Coworker runtime status.');
}
