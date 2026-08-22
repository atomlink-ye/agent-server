import { describe, expect, it } from 'vitest';

import type {
  ProductWorkDefinitionVersionRecord,
  PublishWorkDefinitionSourceInput,
  WorkDefinitionApplyRequestRecord,
  WorkDefinitionSourceOwner,
  WorkDefinitionSourceRepository,
} from '../ports/work-definition-source-repository.js';
import type {
  WorkDefinitionSourceDefinition,
  WorkDefinitionSourceVersion,
} from '../../domain/work/work-definition-source.js';
import { ProductWorkDefinitionApi } from './product-work-definition-api.js';

const access = {
  tenantId: 'tenant-1',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  principalType: 'service_account',
  principalId: 'svc-1',
  policySnapshotVersion: 'policy-1',
} as const;
const agentVersionId = '22222222-2222-4222-8222-222222222222';
const environmentVersionId = '33333333-3333-4333-8333-333333333333';
const now = '2026-08-16T00:00:00.000Z';

const SOURCE = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: earnings-research
  description: First version
spec:
  kind: single_agent
  agent_version_id: ${agentVersionId}
  environment_version_id: ${environmentVersionId}
  input_schema:
    type: object
    properties:
      symbol:
        type: string
    required: [symbol]
    additional_properties: false
`;

describe('ProductWorkDefinitionApi apply', () => {
  it('creates, replays the same idempotency key, and converges the same canonical source', async () => {
    const repository = new MemoryDefinitionRepository();
    const api = createApi(repository);

    const created = await api.apply({
      source: SOURCE,
      idempotencyKey: 'apply-1',
      accessContext: access,
    });
    const replayed = await api.apply({
      source: SOURCE,
      idempotencyKey: 'apply-1',
      accessContext: access,
    });
    const converged = await api.apply({
      source: SOURCE.replace('required: [symbol]', 'required:\n      - symbol'),
      idempotencyKey: 'apply-2',
      accessContext: access,
    });

    expect(created.result).toBe('created');
    expect(replayed.result).toBe('replayed');
    expect(converged.result).toBe('converged');
    expect(replayed.version.version.id).toBe(created.version.version.id);
    expect(converged.version.version.id).toBe(created.version.version.id);
    expect(repository.versions.size).toBe(1);
  });

  it('creates a new immutable version when author intent changes', async () => {
    const repository = new MemoryDefinitionRepository();
    const api = createApi(repository);
    const first = await api.apply({
      source: SOURCE,
      idempotencyKey: 'apply-1',
      accessContext: access,
    });
    const second = await api.apply({
      source: SOURCE.replace('First version', 'Second version'),
      idempotencyKey: 'apply-2',
      accessContext: access,
    });

    expect(second.result).toBe('created');
    expect(second.definition.id).toBe(first.definition.id);
    expect(second.version.version.id).not.toBe(first.version.version.id);
    expect(repository.versions.size).toBe(2);
  });

  it('rejects reusing an idempotency key with another source', async () => {
    const repository = new MemoryDefinitionRepository();
    const api = createApi(repository);
    await api.apply({
      source: SOURCE,
      idempotencyKey: 'apply-1',
      accessContext: access,
    });
    await expect(
      api.apply({
        source: SOURCE.replace('First version', 'Changed'),
        idempotencyKey: 'apply-1',
        accessContext: access,
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
});

function createApi(repository: MemoryDefinitionRepository) {
  return new ProductWorkDefinitionApi({
    repository,
    resolver: {
      async resolve(input) {
        return {
          definitionId: input.definitionId,
          definitionVersionId: input.definitionVersionId,
          kind: 'single_agent',
          name: 'earnings-research',
          description: null,
          sourceFingerprint: `sha256:${'a'.repeat(64)}`,
          resolvedFingerprint: `sha256:${input.definitionVersionId.replaceAll('-', '').padEnd(64, '0').slice(0, 64)}`,
          participants: [],
          environment: null,
          memories: [],
          platformCapabilities: [],
          executionPolicy: {
            invokable: { kind: 'agent', versionId: agentVersionId },
            requiredRuntimeCapabilities: [],
          },
        };
      },
    },
    agents: {
      async resolvePublished(versionId) {
        return versionId === agentVersionId
          ? {
              source: 'managed',
              id: agentVersionId,
              instructions: 'research',
              modelPolicyRef: 'free-only',
              skills: [],
              toolRefs: [],
            }
          : null;
      },
    },
    invokables: {
      saveTeamDefinition: async () => undefined,
      findTeamDefinitionById: async () => null,
      saveTeamVersion: async () => undefined,
      findTeamVersionById: async () => null,
    },
    environments: {
      async findVersion(_owner, id) {
        return id === environmentVersionId
          ? ({ id, status: 'published' } as any)
          : null;
      },
    },
    now: () => new Date(now),
  });
}

class MemoryDefinitionRepository implements WorkDefinitionSourceRepository {
  public readonly definitions = new Map<
    string,
    WorkDefinitionSourceDefinition
  >();
  public readonly versions = new Map<
    string,
    ProductWorkDefinitionVersionRecord
  >();
  private readonly applyRequests = new Map<
    string,
    WorkDefinitionApplyRequestRecord
  >();

  public async findDefinition(id: string, owner: WorkDefinitionSourceOwner) {
    const value = this.definitions.get(id) ?? null;
    return value && sameOwner(value.owner, owner) ? value : null;
  }

  public async findPublishedVersion(
    id: string,
    owner: WorkDefinitionSourceOwner,
  ) {
    const value = this.versions.get(id)?.version ?? null;
    return value && sameOwner(value.owner, owner) ? value : null;
  }

  public async publish(input: PublishWorkDefinitionSourceInput) {
    const definition =
      this.definitions.get(input.definitionId) ??
      ({
        id: input.definitionId,
        owner: input.owner,
        name: input.name,
        description: input.description,
        createdAt: input.now,
      } satisfies WorkDefinitionSourceDefinition);
    this.definitions.set(definition.id, definition);
    const existing = this.versions.get(input.versionId);
    if (existing) return { definition, version: existing.version };
    const version = {
      id: input.versionId,
      definitionId: input.definitionId,
      owner: input.owner,
      status: 'published' as const,
      source: input.source,
      fingerprint: input.fingerprint,
      createdAt: input.now,
      publishedAt: input.now,
    } satisfies WorkDefinitionSourceVersion;
    this.versions.set(version.id, {
      version,
      authorSource: input.authorSource!,
      authorFingerprint: input.authorFingerprint!,
      resolvedFingerprint: null,
    });
    return { definition, version };
  }

  public async findProductVersion(
    id: string,
    owner: WorkDefinitionSourceOwner,
  ) {
    const value = this.versions.get(id) ?? null;
    return value && sameOwner(value.version.owner, owner) ? value : null;
  }

  public async findProductVersionByAuthorFingerprint(input: {
    readonly definitionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly authorFingerprint: string;
  }) {
    return (
      [...this.versions.values()].find(
        (value) =>
          value.version.definitionId === input.definitionId &&
          value.authorFingerprint === input.authorFingerprint &&
          sameOwner(value.version.owner, input.owner),
      ) ?? null
    );
  }

  public async listProductVersions(input: {
    readonly definitionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly limit: number;
    readonly cursor: string | null;
  }) {
    const items = [...this.versions.values()]
      .filter(
        (value) =>
          value.version.definitionId === input.definitionId &&
          sameOwner(value.version.owner, input.owner),
      )
      .slice(0, input.limit);
    return { items, nextCursor: null };
  }

  public async recordResolvedFingerprint(input: {
    readonly versionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly resolvedFingerprint: string;
    readonly now: string;
  }) {
    const current = await this.findProductVersion(input.versionId, input.owner);
    if (!current) throw new Error('missing version');
    if (
      current.resolvedFingerprint &&
      current.resolvedFingerprint !== input.resolvedFingerprint
    )
      throw new Error('resolved fingerprint conflict');
    this.versions.set(input.versionId, {
      ...current,
      resolvedFingerprint: input.resolvedFingerprint,
    });
    return input.resolvedFingerprint;
  }

  public async findApplyRequest(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly idempotencyKey: string;
  }) {
    return (
      this.applyRequests.get(
        `${ownerKey(input.owner)}:${input.idempotencyKey}`,
      ) ?? null
    );
  }

  public async recordApplyRequest(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
    readonly definitionId: string;
    readonly versionId: string;
    readonly resolvedFingerprint: string;
    readonly now: string;
  }) {
    const key = `${ownerKey(input.owner)}:${input.idempotencyKey}`;
    const existing = this.applyRequests.get(key);
    if (existing && existing.requestFingerprint !== input.requestFingerprint)
      throw new Error('idempotency_conflict');
    const record =
      existing ??
      ({
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        definitionId: input.definitionId,
        versionId: input.versionId,
        resolvedFingerprint: input.resolvedFingerprint,
        createdAt: input.now,
      } satisfies WorkDefinitionApplyRequestRecord);
    this.applyRequests.set(key, record);
    return record;
  }
}

function sameOwner(
  a: WorkDefinitionSourceOwner,
  b: WorkDefinitionSourceOwner,
): boolean {
  return ownerKey(a) === ownerKey(b);
}

function ownerKey(owner: WorkDefinitionSourceOwner): string {
  return [
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
  ].join(':');
}
