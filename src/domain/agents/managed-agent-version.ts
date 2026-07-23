import { randomUUID } from 'node:crypto';
import type {
  ManagedAgentPackage,
  ParsedManagedAgentPackage,
} from './managed-agent-package.js';
import type { ManagedAgentOwner } from './managed-agent-owner.js';
import type { AgentDefinition } from './managed-agent-definition.js';

export type ManagedAgentVersionStatus = 'draft' | 'published';
export interface ManagedAgentVersion extends ManagedAgentOwner {
  readonly id: string;
  readonly definitionId: string;
  readonly status: ManagedAgentVersionStatus;
  readonly displayName: string;
  readonly package: ManagedAgentPackage;
  readonly canonicalJson: string;
  readonly fingerprint: string;
  readonly compiler: ParsedManagedAgentPackage['compiler'];
  readonly policySnapshot: Readonly<{ readonly modelPolicyRef: string }>;
  readonly referenceSnapshot: Readonly<{
    readonly tools: readonly unknown[];
    readonly skills: readonly unknown[];
  }>;
  readonly validationSnapshot: Readonly<{
    readonly valid: true;
    readonly metadata: Readonly<{ readonly normalizedName: string }>;
  }>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export function createManagedAgentDraft(options: {
  readonly definition: AgentDefinition;
  readonly parsed: ParsedManagedAgentPackage;
  readonly id?: string;
  readonly now?: () => Date;
}): ManagedAgentVersion {
  const at = (options.now ?? (() => new Date()))().toISOString();
  const p = options.parsed.package;
  return deepFreeze({
    id: options.id ?? randomUUID(),
    definitionId: options.definition.id,
    tenantId: options.definition.tenantId,
    principalType: options.definition.principalType,
    principalId: options.definition.principalId,
    status: 'draft',
    displayName: p.metadata.name,
    package: p,
    canonicalJson: options.parsed.canonicalJson,
    fingerprint: options.parsed.fingerprint,
    compiler: options.parsed.compiler,
    policySnapshot: { modelPolicyRef: p.spec.runtime.modelPolicyRef },
    referenceSnapshot: { tools: p.spec.tools, skills: p.spec.skills },
    validationSnapshot: {
      valid: true,
      metadata: { normalizedName: options.definition.normalizedName },
    },
    createdAt: at,
    updatedAt: at,
    publishedAt: null,
  });
}

export function publishManagedAgentVersion(
  version: ManagedAgentVersion,
  now = () => new Date(),
): ManagedAgentVersion {
  if (version.status === 'published') return version;
  const at = now().toISOString();
  return deepFreeze({
    ...version,
    status: 'published',
    updatedAt: at,
    publishedAt: at,
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
