export const MEMORY_POLICY_VERSION = 'memory-policy-v1';
export const DEFAULT_MEMORY_POLICY_MODE: MemoryPolicyMode = 'disabled';

export const MEMORY_POLICY_MODES = [
  'disabled',
  'proposal',
  'auto_safe',
] as const;
export type MemoryPolicyMode = (typeof MEMORY_POLICY_MODES)[number];
export const MEMORY_POLICY_CATEGORIES = [
  'terminology',
  'output_preference',
  'project_constraint',
  'confirmed_workflow_procedure',
] as const;
export type MemoryPolicyCategory = (typeof MEMORY_POLICY_CATEGORIES)[number];
export const MEMORY_SOURCE_KINDS = [
  'current_user_message',
  'structured_system',
  'untrusted',
  'unknown',
] as const;
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];

export interface MemoryPolicyDecision {
  readonly mode: MemoryPolicyMode;
  readonly decision: 'reject' | 'proposal' | 'accept';
  readonly category: string;
  readonly source: MemorySourceKind;
  readonly reasonCodes: readonly string[];
  readonly policyVersion: string;
}

export interface ExistingMemoryCandidate {
  readonly category: string;
  readonly content: string;
  readonly workspaceId?: string;
}

export interface EvaluateMemoryPolicyInput {
  readonly mode?: MemoryPolicyMode;
  readonly category: string;
  readonly source: MemorySourceKind;
  readonly content: string;
  readonly existingEntries?: readonly ExistingMemoryCandidate[];
  readonly workspaceId?: string;
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:api[_ -]?key|secret|token|password|passwd|access[_ -]?key)\s*[:=]/i,
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
];
const PII_PATTERNS = [
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
  /\b(?:\+?\d[\d(). -]{8,}\d)\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
];
const ACTION_PATTERN =
  /\b(?:grant|revoke|delete|remove|disable|enable|reset|pay|transfer|purchase|authorize|permission|access|legal|financial|security|account)\b/i;
const INSTRUCTION_PATTERN =
  /\b(?:ignore previous|system prompt|developer message|override instructions|do not follow)\b/i;

export function evaluateMemoryPolicy(
  input: EvaluateMemoryPolicyInput,
): MemoryPolicyDecision {
  const mode = input.mode ?? DEFAULT_MEMORY_POLICY_MODE;
  const reasons: string[] = [];
  if (mode === 'disabled') {
    return decision(mode, 'reject', input, ['mode_disabled']);
  }
  if (mode === 'proposal') {
    return decision(mode, 'proposal', input, ['manual_review_required']);
  }

  if (
    !MEMORY_POLICY_CATEGORIES.includes(input.category as MemoryPolicyCategory)
  )
    reasons.push('category_not_allowlisted');
  if (
    input.source !== 'current_user_message' &&
    input.source !== 'structured_system'
  )
    reasons.push('source_not_trusted');
  if (SECRET_PATTERNS.some((pattern) => pattern.test(input.content)))
    reasons.push('secret_like_content');
  if (PII_PATTERNS.some((pattern) => pattern.test(input.content)))
    reasons.push('pii_like_content');
  if (ACTION_PATTERN.test(input.content)) reasons.push('sensitive_action');
  if (INSTRUCTION_PATTERN.test(input.content))
    reasons.push('instruction_marker');
  if (
    (input.existingEntries ?? []).some(
      (entry) =>
        entry.workspaceId !== undefined &&
        entry.workspaceId !== input.workspaceId,
    )
  )
    reasons.push('cross_workspace_candidate');
  if (
    (input.existingEntries ?? []).some(
      (entry) =>
        entry.category === input.category &&
        normalize(entry.content) !== normalize(input.content),
    )
  )
    reasons.push('same_category_conflict');

  return decision(
    mode,
    reasons.length === 0 ? 'accept' : 'reject',
    input,
    reasons.length === 0 ? ['all_predicates_passed'] : reasons,
  );
}

function decision(
  mode: MemoryPolicyMode,
  result: MemoryPolicyDecision['decision'],
  input: EvaluateMemoryPolicyInput,
  reasonCodes: readonly string[],
): MemoryPolicyDecision {
  return Object.freeze({
    mode,
    decision: result,
    category: input.category,
    source: input.source,
    reasonCodes: Object.freeze([...reasonCodes]),
    policyVersion: MEMORY_POLICY_VERSION,
  });
}

export function normalizeMemoryContent(content: string): string {
  return normalize(content);
}

function normalize(content: string): string {
  return content.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
