import { describe, expect, it } from 'vitest';

import { importAgent } from './import-agent.js';
import type { AgentRegistry } from '../ports/agent-registry.js';
import type {
  ImportAgentAtomicCommand,
  ImportAgentAtomicResult,
  PublishAgentAtomicCommand,
} from '../ports/agent-registry.js';
import type { AgentDefinition } from '../../domain/agents/managed-agent-definition.js';
import type { ManagedAgentOwner } from '../../domain/agents/managed-agent-owner.js';
import type { ManagedAgentVersion } from '../../domain/agents/managed-agent-version.js';
import { publishAgentVersion } from './publish-agent-version.js';
import {
  readAgentDefinition,
  readAgentVersion,
  listAgentVersions,
} from './read-agent.js';
import { AgentNotFoundError, IdempotencyConflictError } from './errors.js';

describe('ImportAgent', () => {
  it('derives an owner without workspace and normalizes the package name', async () => {
    const calls: unknown[] = [];
    const registry: AgentRegistry = {
      importAgent: async (command: unknown) => {
        calls.push(command);
        return { kind: 'created', definition: {} as any, version: {} as any };
      },
      publishAgentVersion: async () => {
        throw new Error('unused');
      },
      findDefinition: async () => null,
      findVersion: async () => null,
      listVersionsForOwner: async () => ({ items: [], nextCursor: null }),
    };

    await importAgent(registry, {
      accessContext: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-a',
        principalType: 'service_account',
        principalId: 'principal-1',
        policySnapshotVersion: 'p1',
      },
      idempotencyKey: 'key-1',
      source: validPackage('  My Agent  '),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      owner: {
        tenantId: 'tenant-1',
        principalType: 'service_account',
        principalId: 'principal-1',
      },
      normalizedName: 'my-agent',
    });
    expect(calls[0]).not.toMatchObject({
      owner: { workspaceId: expect.anything() },
    });
  });

  it('derives identical owner identity when only workspace changes', async () => {
    const fake = new AtomicFake();
    await importAgent(fake, {
      accessContext: context('one'),
      idempotencyKey: 'a',
      source: validPackage('A Name'),
    });
    await importAgent(fake, {
      accessContext: context('two'),
      idempotencyKey: 'b',
      source: validPackage('A Name'),
    });
    expect(fake.calls[0]?.owner).toEqual(fake.calls[1]?.owner);
    expect(fake.calls[0]?.normalizedName).toBe('a-name');
  });

  it('replays the same exact request through one atomic port call', async () => {
    const fake = new AtomicFake();
    const input = {
      accessContext: context('w'),
      idempotencyKey: 'same',
      source: validPackage('Replay'),
    };
    const first = await importAgent(fake, input);
    const second = await importAgent(fake, input);
    expect(second).toEqual(first);
    expect(fake.calls).toHaveLength(2);
    expect(fake.atomicCalls).toBe(2);
  });

  it('conflicts on same key and different body despite equal package fingerprint', async () => {
    const fake = new AtomicFake();
    await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'same',
      source: validPackage('Replay'),
    });
    await expect(
      importAgent(fake, {
        accessContext: context('w'),
        idempotencyKey: 'same',
        source: reorderedPackage('Replay'),
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('converges semantically equal YAML under a different key', async () => {
    const fake = new AtomicFake();
    const first = await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'one',
      source: validPackage('Converge'),
    });
    const second = await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'two',
      source: reorderedPackage('Converge'),
    });
    expect(fake.calls[0]?.version.fingerprint).toBe(
      fake.calls[1]?.version.fingerprint,
    );
    expect(second.version.id).toBe(first.version.id);
  });

  it('converges concurrent imports atomically', async () => {
    const fake = new AtomicFake();
    const input = {
      accessContext: context('w'),
      idempotencyKey: 'concurrent',
      source: validPackage('Concurrent'),
    };
    const results = await Promise.all([
      importAgent(fake, input),
      importAgent(fake, input),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(fake.definitions).toHaveLength(1);
    expect(fake.versions).toHaveLength(1);
    expect(fake.atomicCalls).toBe(2);
  });

  it('converges concurrent equal packages under different keys', async () => {
    const fake = new AtomicFake();
    const results = await Promise.all([
      importAgent(fake, {
        accessContext: context('w'),
        idempotencyKey: 'one',
        source: validPackage('Concurrent Equal'),
      }),
      importAgent(fake, {
        accessContext: context('w'),
        idempotencyKey: 'two',
        source: reorderedPackage('Concurrent Equal'),
      }),
    ]);
    expect(results[0]!.version.id).toBe(results[1]!.version.id);
    expect(fake.definitions).toHaveLength(1);
    expect(fake.versions).toHaveLength(1);
  });

  it('creates a distinct draft when the package fingerprint changes', async () => {
    const fake = new AtomicFake();
    const first = await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'one',
      source: validPackage('Versions'),
    });
    const second = await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'two',
      source: validPackage('Versions').replace(
        'instructions: instructions',
        'instructions: changed',
      ),
    });
    expect(second.version.id).not.toBe(first.version.id);
    expect(second.definition.id).toBe(first.definition.id);
    expect(second.version.status).toBe('draft');
  });

  it('carries compiler metadata unchanged into the atomic request', async () => {
    const fake = new AtomicFake();
    const result = await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'compiler',
      source: validPackage('Compiler'),
    });
    expect(result.version.compiler).toEqual({
      patternDialect: 're2',
      patternCompilerVersion: 're2js-2.8.6',
    });
    expect(fake.calls[0]?.version.compiler).toEqual(result.version.compiler);
  });

  it('publishes an immutable snapshot and replays publication', async () => {
    const fake = new AtomicFake();
    const imported = await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'import',
      source: validPackage('Publish'),
    });
    const published = await publishAgentVersion(fake, {
      accessContext: context('w'),
      idempotencyKey: 'publish',
      versionId: imported.version.id,
    });
    const replay = await publishAgentVersion(fake, {
      accessContext: context('w'),
      idempotencyKey: 'publish',
      versionId: imported.version.id,
    });
    expect(published).toEqual(replay);
    expect(published.status).toBe('published');
    expect(published.package).toBe(imported.version.package);
    expect(published.compiler).toBe(imported.version.compiler);
  });

  it('conflicts publish key reuse and converges concurrent publication', async () => {
    const fake = new AtomicFake();
    const first = await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'a',
      source: validPackage('Publish One'),
    });
    const second = await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'b',
      source: validPackage('Publish Two'),
    });
    await publishAgentVersion(fake, {
      accessContext: context('w'),
      idempotencyKey: 'pub',
      versionId: first.version.id,
    });
    await expect(
      publishAgentVersion(fake, {
        accessContext: context('w'),
        idempotencyKey: 'pub',
        versionId: second.version.id,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    const results = await Promise.all([
      publishAgentVersion(fake, {
        accessContext: context('w'),
        idempotencyKey: 'concurrent-pub',
        versionId: second.version.id,
      }),
      publishAgentVersion(fake, {
        accessContext: context('w'),
        idempotencyKey: 'concurrent-pub',
        versionId: second.version.id,
      }),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(fake.publishAtomicCalls).toBe(4);
  });

  it('hides foreign and absent reads and publication as not-found', async () => {
    const fake = new AtomicFake();
    const imported = await importAgent(fake, {
      accessContext: context('owner'),
      idempotencyKey: 'import',
      source: validPackage('Hidden'),
    });
    await expect(
      readAgentDefinition(
        fake,
        context('foreign', 'other-tenant'),
        imported.definition.id,
      ),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(
      readAgentVersion(
        fake,
        context('foreign', 'other-tenant'),
        imported.version.id,
      ),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(
      publishAgentVersion(fake, {
        accessContext: context('foreign', 'other-tenant'),
        idempotencyKey: 'publish',
        versionId: imported.version.id,
      }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(
      publishAgentVersion(fake, {
        accessContext: context('owner'),
        idempotencyKey: 'missing',
        versionId: 'foreign-id',
      }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it('returns versions in deterministic createdAt then id order', async () => {
    const fake = new AtomicFake();
    await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'one',
      source: validPackage('List'),
    });
    await importAgent(fake, {
      accessContext: context('w'),
      idempotencyKey: 'two',
      source: validPackage('List').replace(
        'instructions: instructions',
        'instructions: later',
      ),
    });
    const listed = await listAgentVersions(
      fake,
      context('w'),
      fake.definitions[0]!.id,
    );
    expect(listed.items.map((v) => v.fingerprint)).toEqual(
      [...listed.items]
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        )
        .map((v) => v.fingerprint),
    );
    expect(listed.nextCursor).toBeNull();
  });

  it('does not echo invalid body or idempotency material in safe errors', async () => {
    const secret = 'token: super-secret-value';
    await expect(
      importAgent(new AtomicFake(), {
        accessContext: context('w'),
        idempotencyKey: '',
        source: secret,
      }),
    ).rejects.toMatchObject({ code: 'invalid_idempotency_key' });
    await expect(
      importAgent(new AtomicFake(), {
        accessContext: context('w'),
        idempotencyKey: 'valid',
        source: secret,
      }),
    ).rejects.toSatisfy(
      (error: Error) =>
        !error.message.includes(secret) &&
        !error.message.includes('super-secret') &&
        !error.message.includes('token'),
    );
  });
});

function context(workspaceId: string, tenantId = 'tenant') {
  return {
    tenantId,
    workspaceId,
    principalType: 'service_account' as const,
    principalId: 'principal',
    policySnapshotVersion: 'p1',
  };
}

function reorderedPackage(name: string): string {
  return validPackage(name).replace(
    'apiVersion: agent-server/v1alpha1\nkind: ManagedAgent',
    'kind: ManagedAgent\napiVersion: agent-server/v1alpha1',
  );
}

class AtomicFake implements AgentRegistry {
  readonly calls: ImportAgentAtomicCommand[] = [];
  readonly definitions: AgentDefinition[] = [];
  readonly versions: ManagedAgentVersion[] = [];
  private readonly keys = new Map<
    string,
    { fingerprint: string; result: ImportAgentAtomicResult }
  >();
  private readonly ownerKey = (o: ManagedAgentOwner) =>
    `${o.tenantId}/${o.principalType}/${o.principalId}`;
  atomicCalls = 0;
  publishAtomicCalls = 0;
  private importQueue = Promise.resolve();
  private publishQueue = Promise.resolve();
  private readonly publishKeys = new Map<
    string,
    { fingerprint: string; version: ManagedAgentVersion }
  >();
  async importAgent(
    command: ImportAgentAtomicCommand,
  ): Promise<ImportAgentAtomicResult> {
    const result = this.importQueue.then(() => this.importAtomic(command));
    this.importQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async importAtomic(
    command: ImportAgentAtomicCommand,
  ): Promise<ImportAgentAtomicResult> {
    this.atomicCalls++;
    this.calls.push(command);
    const key = `${this.ownerKey(command.owner)}/${command.idempotencyKey}`;
    const previous = this.keys.get(key);
    if (previous) {
      if (previous.fingerprint !== command.requestFingerprint)
        throw new IdempotencyConflictError();
      return previous.result;
    }
    const existing = this.versions.find(
      (v) =>
        this.ownerKey(v) === this.ownerKey(command.owner) &&
        v.definitionId ===
          this.definitions.find(
            (d) =>
              d.normalizedName === command.normalizedName &&
              this.ownerKey(d) === this.ownerKey(command.owner),
          )?.id &&
        v.fingerprint === command.version.fingerprint,
    );
    const result = existing
      ? {
          kind: 'converged' as const,
          definition: this.definitions.find(
            (d) => d.id === existing.definitionId,
          )!,
          version: existing,
        }
      : this.create(command);
    this.keys.set(key, { fingerprint: command.requestFingerprint, result });
    return result;
  }
  private create(command: ImportAgentAtomicCommand): ImportAgentAtomicResult {
    const definition =
      this.definitions.find(
        (candidate) =>
          candidate.normalizedName === command.normalizedName &&
          this.ownerKey(candidate) === this.ownerKey(command.owner),
      ) ?? command.definition;
    const version =
      definition.id === command.version.definitionId
        ? command.version
        : { ...command.version, definitionId: definition.id };
    if (!this.definitions.some((candidate) => candidate.id === definition.id))
      this.definitions.push(definition);
    this.versions.push(version);
    return {
      kind: 'created',
      definition,
      version,
    };
  }
  async publishAgentVersion(
    command: PublishAgentAtomicCommand,
  ): Promise<ManagedAgentVersion> {
    const result = this.publishQueue.then(() => this.publishAtomic(command));
    this.publishQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async publishAtomic(
    command: PublishAgentAtomicCommand,
  ): Promise<ManagedAgentVersion> {
    this.publishAtomicCalls++;
    const key = `${this.ownerKey(command.owner)}/publish/${command.idempotencyKey}`;
    const previous = this.publishKeys.get(key);
    if (previous) {
      if (previous.fingerprint !== command.requestFingerprint)
        throw new IdempotencyConflictError();
      return previous.version;
    }
    const version = await this.findVersion(command.owner, command.versionId);
    if (!version) throw new AgentNotFoundError();
    const published =
      version.status === 'published'
        ? version
        : {
            ...version,
            status: 'published' as const,
            publishedAt: version.updatedAt,
          };
    this.versions.splice(this.versions.indexOf(version), 1, published);
    this.publishKeys.set(key, {
      fingerprint: command.requestFingerprint,
      version: published,
    });
    return published;
  }
  async findDefinition(owner: ManagedAgentOwner, id: string) {
    return (
      this.definitions.find(
        (d) => d.id === id && this.ownerKey(d) === this.ownerKey(owner),
      ) ?? null
    );
  }
  async findVersion(owner: ManagedAgentOwner, id: string) {
    return (
      this.versions.find(
        (v) => v.id === id && this.ownerKey(v) === this.ownerKey(owner),
      ) ?? null
    );
  }
  async listVersionsForOwner(owner: ManagedAgentOwner, definitionId: string) {
    return {
      items: this.versions.filter(
        (v) =>
          v.definitionId === definitionId &&
          this.ownerKey(v) === this.ownerKey(owner),
      ),
      nextCursor: null,
    };
  }
}

function validPackage(name: string): string {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: ${name}
spec:
  description: description
  instructions: instructions
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      additionalProperties: false
      properties: {}
    prompt: hello
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 1
  permissions:
    network: none
    filesystem: none
  completion:
    type: executable
    command: done
`;
}
