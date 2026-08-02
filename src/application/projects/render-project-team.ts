import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { parseManagedAgentYaml } from '../../domain/agents/managed-agent-yaml.js';
import {
  validateAndCanonicalizeTeamPackage,
  type ManagedTeamPackage,
} from '../../domain/teams/managed-team-package.js';
import type { NormalizedAgentProject } from '../../domain/projects/agent-project.js';
import {
  parseLogicalRef,
  type TeamRef,
} from '../../domain/projects/logical-ref.js';
import type { Sha256Fingerprint } from '../../domain/projects/project-canonicalization.js';

export class ProjectTeamRenderError extends Error {
  public constructor(
    readonly code: string,
    readonly path = '$',
  ) {
    super(code);
    this.name = 'ProjectTeamRenderError';
  }
}
export type TeamRenderTargetMap =
  ReadonlyMap<string, string> | Readonly<Record<string, string>>;
export interface RenderProjectTeamInput {
  readonly project: NormalizedAgentProject;
  readonly team: TeamRef;
  readonly mode?: 'plan' | 'apply';
  readonly targets?: TeamRenderTargetMap;
}
export interface RenderedProjectTeam {
  readonly source: string;
  readonly sourceFingerprint: Sha256Fingerprint;
  readonly nativeFingerprint: Sha256Fingerprint;
  readonly dependencies: readonly string[];
  readonly nativeParserResult: {
    readonly package: ManagedTeamPackage;
    readonly fingerprint: string;
    readonly canonicalJson: string;
  };
}

export function renderProjectTeam(
  input: RenderProjectTeamInput,
): RenderedProjectTeam {
  if (!isLogicalKind(input.team, 'team'))
    throw new ProjectTeamRenderError('invalid_team_reference');
  const record = input.project.teams.get(input.team);
  if (!record) throw new ProjectTeamRenderError('missing_team_reference');
  const raw = parseYaml(record.source);
  const root = object(raw, '$');
  const spec = object(root.spec, '$.spec');
  const dependencies = new Set<string>();
  const mode = input.mode ?? 'plan';
  const targets = input.targets;
  const resolve = (
    value: unknown,
    kind: 'environment' | 'agent',
    path: string,
  ): string => {
    if (typeof value !== 'string' || !isLogicalKind(value, kind))
      throw new ProjectTeamRenderError('invalid_project_reference', path);
    const ref = value;
    if (
      !(kind === 'environment'
        ? input.project.environments.has(ref as any)
        : input.project.agents.has(ref as any))
    )
      throw new ProjectTeamRenderError('missing_project_reference', path);
    dependencies.add(ref);
    if (mode === 'plan') return sentinel(ref);
    if (!targets) throw new ProjectTeamRenderError('missing_render_targets');
    const target = lookup(targets, ref);
    if (!target || !UUID_RE.test(target))
      throw new ProjectTeamRenderError('missing_render_target', path);
    return target;
  };
  const lead = object(spec.lead, '$.spec.lead');
  const roster = Array.isArray(spec.roster)
    ? spec.roster
    : (() => {
        throw new ProjectTeamRenderError('invalid_roster', '$.spec.roster');
      })();
  const renderedSpec = {
    ...spec,
    environmentVersionId: resolve(
      spec.environmentVersionId,
      'environment',
      '$.spec.environmentVersionId',
    ),
    lead: {
      ...lead,
      agentVersionId: resolve(
        lead.agentVersionId,
        'agent',
        '$.spec.lead.agentVersionId',
      ),
    },
    roster: roster.map((member, index) => {
      const item = object(member, `$.spec.roster[${index}]`);
      return {
        ...item,
        agentVersionId: resolve(
          item.agentVersionId,
          'agent',
          `$.spec.roster[${index}].agentVersionId`,
        ),
      };
    }),
  };
  const source = stringify(sortValue({ ...root, spec: renderedSpec }), {
    lineWidth: 0,
  });
  const nativeParserResult = validateAndCanonicalizeTeamPackage(source);
  return {
    source,
    sourceFingerprint: sha256(record.source),
    nativeFingerprint: nativeParserResult.fingerprint as Sha256Fingerprint,
    dependencies: [...dependencies].sort(compare),
    nativeParserResult,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isLogicalKind(
  value: string,
  kind: 'environment' | 'agent' | 'team',
): boolean {
  try {
    return parseLogicalRef(value).startsWith(`${kind}://`);
  } catch {
    return false;
  }
}
function parseYaml(source: string): unknown {
  try {
    return parseManagedAgentYaml(source);
  } catch {
    throw new ProjectTeamRenderError('invalid_yaml');
  }
}
function object(value: unknown, path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProjectTeamRenderError('invalid_object', path);
  return value as Record<string, any>;
}
function lookup(targets: TeamRenderTargetMap, ref: string): string | undefined {
  return targets instanceof Map
    ? targets.get(ref)
    : (targets as Readonly<Record<string, string>>)[ref];
}
function sentinel(ref: string): string {
  const hex = createHash('sha256').update(ref).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function sortValue(value: any): any {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort(compare)
        .map((key) => [key, sortValue(value[key])]),
    );
  return value;
}
function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
