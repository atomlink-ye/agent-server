import { createHash } from 'node:crypto';
import {
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  MAX_COLLECTION_SIZE,
  MAX_SCALAR_LENGTH,
  MAX_SOURCE_BYTES,
} from '../agents/managed-agent-package.js';
import { parse as parseYaml, YAMLError } from 'yaml';

const MAX_SOURCE_LENGTH = 64 * 1024;

export interface ManagedTeamPackage {
  readonly apiVersion: 'agent-server/v1alpha1';
  readonly kind: 'ManagedTeam';
  readonly metadata: { readonly name: string };
  readonly spec: ManagedTeamSpec;
}

export interface ManagedTeamSpec {
  readonly environmentVersionId: string;
  readonly lead: LeadSpec;
  readonly roster: readonly RosterMemberSpec[];
  readonly coordination: CoordinationSpec;
}

export interface LeadSpec {
  readonly name: string;
  readonly agentVersionId: string;
}

export interface RosterMemberSpec {
  readonly name: string;
  readonly agentVersionId: string;
}

export interface CoordinationSpec {
  readonly mode: 'collaborative' | 'agentic_mve';
  readonly taskAssignment: 'lead_or_self_claim';
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TeamPackageValidationError extends Error {
  public readonly code: string;
  public constructor(code: string, message: string) {
    super(message);
    this.name = 'TeamPackageValidationError';
    this.code = code;
  }
}

export function validateAndCanonicalizeTeamPackage(source: string): {
  package: ManagedTeamPackage;
  fingerprint: string;
  canonicalJson: string;
} {
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_LENGTH) {
    throw new TeamPackageValidationError(
      'team_package_too_large',
      'Team package source exceeds the maximum size limit.',
    );
  }

  let doc: unknown;
  try {
    const results = parseYaml(source, { strict: true, uniqueKeys: true });
    if (results === null || results === undefined) {
      throw new TeamPackageValidationError(
        'empty_package',
        'Team package source must not be empty.',
      );
    }
    if (Array.isArray(results)) {
      throw new TeamPackageValidationError(
        'multiple_documents',
        'Team package must be a single YAML document.',
      );
    }
    doc = results;
  } catch (error) {
    if (error instanceof TeamPackageValidationError) throw error;
    const message = error instanceof YAMLError ? error.message : 'Invalid YAML';
    throw new TeamPackageValidationError('invalid_yaml', message);
  }

  if (typeof doc !== 'object' || doc === null) {
    throw new TeamPackageValidationError(
      'invalid_root',
      'Team package must be a YAML mapping.',
    );
  }

  const root = doc as Record<string, unknown>;
  const allowedRootKeys = new Set(['apiVersion', 'kind', 'metadata', 'spec']);
  for (const key of Object.keys(root)) {
    if (!allowedRootKeys.has(key)) {
      throw new TeamPackageValidationError(
        'unknown_field',
        `Unknown root field: ${key}`,
      );
    }
  }

  if (root.apiVersion !== 'agent-server/v1alpha1') {
    throw new TeamPackageValidationError(
      'invalid_api_version',
      'apiVersion must be agent-server/v1alpha1',
    );
  }
  if (root.kind !== 'ManagedTeam') {
    throw new TeamPackageValidationError(
      'invalid_kind',
      'kind must be ManagedTeam',
    );
  }

  const metadata = root.metadata as Record<string, unknown> | undefined;
  if (
    !metadata ||
    typeof metadata.name !== 'string' ||
    metadata.name.length === 0
  ) {
    throw new TeamPackageValidationError(
      'invalid_metadata',
      'metadata.name is required and must be a non-empty string.',
    );
  }
  for (const key of Object.keys(metadata)) {
    if (key !== 'name') {
      throw new TeamPackageValidationError(
        'unknown_field',
        `Unknown metadata field: ${key}`,
      );
    }
  }

  const spec = root.spec as Record<string, unknown> | undefined;
  if (!spec || typeof spec !== 'object') {
    throw new TeamPackageValidationError('invalid_spec', 'spec is required.');
  }

  const allowedSpecKeys = new Set([
    'environmentVersionId',
    'lead',
    'roster',
    'coordination', 'executionMode',
  ]);
  for (const key of Object.keys(spec)) {
    if (!allowedSpecKeys.has(key)) {
      throw new TeamPackageValidationError(
        'unknown_field',
        `Unknown spec field: ${key}`,
      );
    }
  }

  if (
    typeof spec.environmentVersionId !== 'string' ||
    !UUID_RE.test(spec.environmentVersionId)
  ) {
    throw new TeamPackageValidationError(
      'invalid_environment_version',
      'spec.environmentVersionId must be a valid UUID.',
    );
  }

  const lead = spec.lead as Record<string, unknown> | undefined;
  if (
    !lead ||
    typeof lead !== 'object' ||
    typeof lead.name !== 'string' ||
    lead.name.length === 0
  ) {
    throw new TeamPackageValidationError(
      'invalid_lead',
      'spec.lead.name is required.',
    );
  }
  if (
    typeof lead.agentVersionId !== 'string' ||
    !UUID_RE.test(lead.agentVersionId)
  ) {
    throw new TeamPackageValidationError(
      'invalid_lead',
      'spec.lead.agentVersionId must be a valid UUID.',
    );
  }
  for (const key of Object.keys(lead)) {
    if (!['name', 'agentVersionId'].includes(key)) {
      throw new TeamPackageValidationError(
        'unknown_field',
        `Unknown lead field: ${key}`,
      );
    }
  }

  const roster = spec.roster;
  if (!Array.isArray(roster) || roster.length !== 2) {
    throw new TeamPackageValidationError(
      'invalid_roster',
      'spec.roster must contain exactly two members.',
    );
  }

  const names = new Set<string>();
  const rosterMembers: RosterMemberSpec[] = [];
  for (const member of roster) {
    if (typeof member !== 'object' || member === null) {
      throw new TeamPackageValidationError(
        'invalid_roster',
        'Each roster member must be an object.',
      );
    }
    const m = member as Record<string, unknown>;
    if (typeof m.name !== 'string' || m.name.length === 0) {
      throw new TeamPackageValidationError(
        'invalid_roster',
        'Each roster member requires a non-empty name.',
      );
    }
    if (
      typeof m.agentVersionId !== 'string' ||
      !UUID_RE.test(m.agentVersionId)
    ) {
      throw new TeamPackageValidationError(
        'invalid_roster',
        'Each roster member requires a valid agentVersionId UUID.',
      );
    }
    for (const key of Object.keys(m)) {
      if (!['name', 'agentVersionId'].includes(key)) {
        throw new TeamPackageValidationError(
          'unknown_field',
          `Unknown roster member field: ${key}`,
        );
      }
    }
    if (names.has(m.name) || m.name === lead.name) {
      throw new TeamPackageValidationError(
        'duplicate_name',
        `Duplicate member name: ${m.name}`,
      );
    }
    names.add(m.name);
    rosterMembers.push({ name: m.name, agentVersionId: m.agentVersionId });
  }

  const coordination = spec.coordination as Record<string, unknown> | undefined;
  if (!coordination || (coordination.mode !== 'collaborative' && coordination.mode !== 'agentic_mve')) {
    throw new TeamPackageValidationError(
      'invalid_coordination',
      'spec.coordination.mode must be collaborative.',
    );
  }
  if (coordination.taskAssignment !== 'lead_or_self_claim') {
    throw new TeamPackageValidationError(
      'invalid_coordination',
      'spec.coordination.taskAssignment must be lead_or_self_claim.',
    );
  }
  for (const key of Object.keys(coordination)) {
    if (!['mode', 'taskAssignment'].includes(key)) {
      throw new TeamPackageValidationError(
        'unknown_field',
        `Unknown coordination field: ${key}`,
      );
    }
  }

  const pkg: ManagedTeamPackage = {
    apiVersion: 'agent-server/v1alpha1',
    kind: 'ManagedTeam' as const,
    metadata: { name: metadata.name },
    spec: {
      environmentVersionId: spec.environmentVersionId as string,
      lead: {
        name: lead.name as string,
        agentVersionId: lead.agentVersionId as string,
      },
      roster: rosterMembers,
      coordination: {
        mode: coordination.mode as 'collaborative' | 'agentic_mve',
        taskAssignment: 'lead_or_self_claim' as const,
      },
    },
  };

  // Canonicalize to stable sorted JSON.
  const canonicalObj = {
    ...pkg,
    spec: {
      environmentVersionId: pkg.spec.environmentVersionId,
      lead: pkg.spec.lead,
      roster: [...pkg.spec.roster].sort((a, b) => a.name.localeCompare(b.name)),
      coordination: pkg.spec.coordination,
    },
  };
  const canonicalJson = JSON.stringify(canonicalObj);
  const fingerprint = `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`;

  return { package: pkg, fingerprint, canonicalJson };
}
