import { apiTransport } from '../../api/transport';

/**
 * A published Skill an author can attach to a Work-layer participant.
 * `requiredToolRefs` is what the compiler must union into `tools:` for any
 * Worker that selects this Skill — see `authoring.ts` `workerSource()`.
 */
export interface WorkSkillSummary {
  readonly ref: string;
  readonly name: string;
  readonly requiredToolRefs: readonly string[];
}

export async function loadSkills(): Promise<readonly WorkSkillSummary[]> {
  const root = record(
    await apiTransport.request('/api/skills', { cache: 'no-store' }),
  );
  if (!root || !Array.isArray(root.skills))
    throw new Error('Invalid Skills response.');
  return root.skills.map(normalizeSkill);
}

function normalizeSkill(value: unknown): WorkSkillSummary {
  const item = record(value);
  if (!item) throw new Error('Invalid Skill entry.');
  return {
    ref: text(item.ref),
    name: text(item.name),
    requiredToolRefs: strings(item.required_tool_refs),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Invalid Skill entry.');
  return value;
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error('Invalid Skill entry.');
  return value as string[];
}
