import { createHash } from 'node:crypto';

import { importWorker } from '../workers/import-worker.js';
import { publishWorkerVersion } from '../workers/publish-worker-version.js';
import { parseWorkerForImport } from '../workers/validate-worker-package.js';
import {
  importEnvironment,
  publishEnvironmentVersion,
  validateEnvironmentPackage,
} from '../environments/environment-use-cases.js';
import type {
  WorkerRegistry,
  WorkerResolutionApi,
} from '../ports/worker-registry.js';
import type { EnvironmentRegistry } from '../ports/environment-registry.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import type { MemoryVersionReadApi } from '../ports/memory-version-read-api.js';
import type { WorkDefinitionSourceOwner } from '../ports/work-definition-source-repository.js';
import { createTeamDefinition } from '../../domain/invokables/team-definition.js';
import {
  createDraftTeamVersion,
  publishTeamVersion,
  type TeamSpec,
  type TeamVersion,
} from '../../domain/invokables/team-version.js';
import type { WorkDefinitionCompositionSource } from '../../domain/work/work-definition-source.js';
import type { AccessContext } from '../../domain/access-context.js';
import type {
  ProductWorkDefinitionDocument,
  ProductWorkParticipantBinding,
} from './validate-product-work-definition.js';

export type ProductWorkDefinitionParticipantInspection = {
  readonly name: string;
  readonly role: 'primary' | 'lead' | 'member';
  readonly source: 'referenced' | 'inline';
  readonly workerVersionId: string | null;
  readonly skills: readonly string[];
  readonly tools: readonly string[];
};

export type ProductWorkDefinitionInspection = {
  readonly participants: readonly ProductWorkDefinitionParticipantInspection[];
  readonly environment: {
    readonly source: 'referenced' | 'inline';
    readonly environmentVersionId: string | null;
  };
};

export class ProductWorkDefinitionInspector {
  public constructor(
    private readonly options: {
      readonly workers: WorkerResolutionApi;
      readonly environments: Pick<EnvironmentRegistry, 'findVersion'>;
      readonly memories?: MemoryVersionReadApi;
    },
  ) {}

  public async inspect(
    document: ProductWorkDefinitionDocument,
    owner: WorkDefinitionSourceOwner,
  ): Promise<ProductWorkDefinitionInspection> {
    const bindings: readonly {
      readonly name: string;
      readonly role: 'primary' | 'lead' | 'member';
      readonly binding: ProductWorkParticipantBinding | SingleWorkerBinding;
      readonly path: string;
    }[] =
      document.spec.kind === 'single_worker'
        ? [
            {
              name: document.metadata.name,
              role: 'primary',
              binding: document.spec,
              path: '$.spec',
            },
          ]
        : [
            {
              name: document.spec.lead.name,
              role: 'lead',
              binding: document.spec.lead,
              path: '$.spec.lead',
            },
            ...document.spec.members.map((member, index) => ({
              name: member.name,
              role: 'member' as const,
              binding: member,
              path: `$.spec.members[${index}]`,
            })),
          ];

    const participants: ProductWorkDefinitionParticipantInspection[] = [];
    for (const item of bindings) {
      if (item.binding.worker_version_id) {
        const worker = await this.options.workers.resolvePublished(
          item.binding.worker_version_id,
          owner,
          { resolveExtensions: true },
        );
        if (!worker)
          throw new ProductWorkDefinitionReferenceError(
            `${item.path}.worker_version_id`,
            'Referenced Worker version was not found or is not published in this owner scope.',
          );
        participants.push(
          Object.freeze({
            name: item.name,
            role: item.role,
            source: 'referenced' as const,
            workerVersionId: item.binding.worker_version_id,
            skills: Object.freeze(worker.skills.map((skill) => skill.ref)),
            tools: Object.freeze([...worker.toolRefs]),
          }),
        );
        continue;
      }

      const inline = item.binding.worker?.source;
      if (!inline)
        throw new ProductWorkDefinitionReferenceError(
          `${item.path}.worker`,
          'An inline Worker source is required.',
        );
      try {
        const parsed = parseWorkerForImport(inline);
        participants.push(
          Object.freeze({
            name: item.name,
            role: item.role,
            source: 'inline' as const,
            workerVersionId: null,
            skills: Object.freeze(
              parsed.package.spec.skills.map((skill) => skill.ref),
            ),
            tools: Object.freeze(
              parsed.package.spec.tools.map((tool) => tool.ref),
            ),
          }),
        );
      } catch {
        throw new ProductWorkDefinitionReferenceError(
          `${item.path}.worker.source`,
          'Inline Worker source is invalid.',
        );
      }
    }

    const environmentBinding = document.spec;
    let environment: ProductWorkDefinitionInspection['environment'];
    if (environmentBinding.environment_version_id) {
      const version = await this.options.environments.findVersion(
        owner,
        environmentBinding.environment_version_id,
      );
      if (!version || version.status !== 'published')
        throw new ProductWorkDefinitionReferenceError(
          '$.spec.environment_version_id',
          'Referenced Environment version was not found or is not published in this owner scope.',
        );
      environment = Object.freeze({
        source: 'referenced' as const,
        environmentVersionId: environmentBinding.environment_version_id,
      });
    } else {
      const source = environmentBinding.environment?.source;
      if (!source)
        throw new ProductWorkDefinitionReferenceError(
          '$.spec.environment',
          'An inline Environment source is required.',
        );
      try {
        validateEnvironmentPackage(source);
      } catch {
        throw new ProductWorkDefinitionReferenceError(
          '$.spec.environment.source',
          'Inline Environment source is invalid.',
        );
      }
      environment = Object.freeze({
        source: 'inline' as const,
        environmentVersionId: null,
      });
    }

    if (document.spec.memory_version_ids.length > 0) {
      if (!this.options.memories)
        throw new ProductWorkDefinitionReferenceError(
          '$.spec.memory_version_ids',
          'Memory version resolution is unavailable.',
        );
      for (const [
        index,
        versionId,
      ] of document.spec.memory_version_ids.entries()) {
        const memory = await this.options.memories.findVersion(
          versionId,
          owner,
        );
        if (!memory)
          throw new ProductWorkDefinitionReferenceError(
            `$.spec.memory_version_ids[${index}]`,
            'Referenced Memory version was not found in this owner scope.',
          );
      }
    }

    return {
      participants: Object.freeze(participants),
      environment,
    };
  }
}

export class ProductWorkDefinitionMaterializer {
  private readonly now: () => Date;

  public constructor(
    private readonly options: {
      readonly workerRegistry?: WorkerRegistry;
      readonly environmentRegistry?: EnvironmentRegistry;
      readonly invokables: Pick<
        InvokableRepository,
        | 'saveTeamDefinition'
        | 'findTeamDefinitionById'
        | 'saveTeamVersion'
        | 'findTeamVersionById'
        | 'importTeamVersionAtomically'
        | 'publishTeamVersionAtomically'
      >;
      readonly now?: () => Date;
    },
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public async materialize(input: {
    readonly document: ProductWorkDefinitionDocument;
    readonly owner: WorkDefinitionSourceOwner;
    readonly accessContext: AccessContext;
    readonly definitionId: string;
    readonly versionId: string;
    readonly authorFingerprint: string;
  }): Promise<WorkDefinitionCompositionSource> {
    const environmentVersionId = await this.materializeEnvironment(
      input.document.spec,
      input.accessContext,
    );
    const common = {
      environmentVersionId,
      memoryVersionIds: Object.freeze([
        ...input.document.spec.memory_version_ids,
      ]),
      description: input.document.metadata.description ?? null,
      inputSchema: input.document.spec.input_schema,
    };

    if (input.document.spec.kind === 'single_worker') {
      const workerVersionId = await this.materializeWorker(
        input.document.spec,
        input.accessContext,
      );
      return Object.freeze({
        kind: 'single_worker' as const,
        workerVersionId,
        ...common,
      });
    }

    const leadVersionId = await this.materializeWorker(
      input.document.spec.lead,
      input.accessContext,
    );
    const members: TeamSpec['roster'][number][] = [];
    for (const member of input.document.spec.members) {
      members.push({
        name: member.name,
        workerVersionId: await this.materializeWorker(
          member,
          input.accessContext,
        ),
      });
    }
    const teamVersionId = await this.materializeInternalTeam({
      owner: input.owner,
      definitionId: input.definitionId,
      versionId: input.versionId,
      authorFingerprint: input.authorFingerprint,
      name: input.document.metadata.name,
      description: input.document.metadata.description ?? null,
      spec: {
        lead: {
          name: input.document.spec.lead.name,
          workerVersionId: leadVersionId,
        },
        roster: members,
        environmentVersionId,
      },
    });
    return Object.freeze({
      kind: 'collaboration' as const,
      teamVersionId,
      ...common,
    });
  }

  private async materializeWorker(
    binding: ProductWorkParticipantBinding | SingleWorkerBinding,
    accessContext: AccessContext,
  ): Promise<string> {
    if (binding.worker_version_id) return binding.worker_version_id;
    const source = binding.worker?.source;
    if (!source || !this.options.workerRegistry)
      throw new ProductWorkDefinitionReferenceError(
        '$.spec.worker',
        'Inline Worker materialization is unavailable.',
      );
    const digest = sha256Hex(source);
    const imported = await importWorker(this.options.workerRegistry, {
      accessContext,
      idempotencyKey: `work-inline-worker-import:${digest}`,
      source,
    });
    if (imported.version.status === 'published') return imported.version.id;
    const published = await publishWorkerVersion(this.options.workerRegistry, {
      accessContext,
      idempotencyKey: `work-inline-worker-publish:${digest}`,
      versionId: imported.version.id,
    });
    return published.id;
  }

  private async materializeEnvironment(
    binding: EnvironmentBinding,
    accessContext: AccessContext,
  ): Promise<string> {
    if (binding.environment_version_id) return binding.environment_version_id;
    const source = binding.environment?.source;
    if (!source || !this.options.environmentRegistry)
      throw new ProductWorkDefinitionReferenceError(
        '$.spec.environment',
        'Inline Environment materialization is unavailable.',
      );
    const digest = sha256Hex(source);
    const imported = await importEnvironment(this.options.environmentRegistry, {
      accessContext,
      idempotencyKey: `work-inline-environment-import:${digest}`,
      source,
    });
    if (imported.version.status === 'published') return imported.version.id;
    const published = await publishEnvironmentVersion(
      this.options.environmentRegistry,
      {
        accessContext,
        idempotencyKey: `work-inline-environment-publish:${digest}`,
        versionId: imported.version.id,
      },
    );
    return published.id;
  }

  private async materializeInternalTeam(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly definitionId: string;
    readonly versionId: string;
    readonly authorFingerprint: string;
    readonly name: string;
    readonly description: string | null;
    readonly spec: TeamSpec;
  }): Promise<string> {
    const teamDefinitionId = stableProductUuid(
      `work-definition-team\0${input.definitionId}`,
    );
    const teamVersionId = stableProductUuid(
      `work-definition-team-version\0${input.versionId}`,
    );
    const existing =
      await this.options.invokables.findTeamVersionById(teamVersionId);
    if (existing) {
      assertInternalTeam(existing, input.owner, teamDefinitionId, input.spec);
      if (existing.status === 'published') return existing.id;
    }

    const clock = () => this.now();
    const definition = createTeamDefinition({
      ...input.owner,
      id: teamDefinitionId,
      name: `work-${input.name}`,
      description: 'Internal execution binding for Product Work Definition.',
      now: clock,
    });
    const draft = createDraftTeamVersion({
      ...input.owner,
      id: teamVersionId,
      definitionId: teamDefinitionId,
      name: input.name,
      description: input.description,
      spec: input.spec,
      now: clock,
    });
    const imported = this.options.invokables.importTeamVersionAtomically
      ? await this.options.invokables.importTeamVersionAtomically({
          definition,
          version: draft,
          idempotencyKey: `product-work-team-import:${input.definitionId}:${input.authorFingerprint}`,
          requestFingerprint: input.authorFingerprint,
        })
      : (await this.options.invokables.saveTeamDefinition(definition),
        await this.options.invokables.saveTeamVersion(draft),
        { kind: 'created' as const, definition, version: draft });
    if (imported.version.status === 'published') return imported.version.id;

    const published = publishTeamVersion(imported.version, clock);
    if (this.options.invokables.publishTeamVersionAtomically)
      await this.options.invokables.publishTeamVersionAtomically({
        version: published,
        idempotencyKey: `product-work-team-publish:${input.definitionId}:${input.authorFingerprint}`,
        requestFingerprint: input.authorFingerprint,
      });
    else await this.options.invokables.saveTeamVersion(published);
    return published.id;
  }
}

export class ProductWorkDefinitionReferenceError extends Error {
  public readonly code = 'invalid_reference';
  public constructor(
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductWorkDefinitionReferenceError';
  }
}

export function stableProductUuid(seed: string): string {
  const hex = createHash('sha256')
    .update(seed, 'utf8')
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

type SingleWorkerBinding = Extract<
  ProductWorkDefinitionDocument['spec'],
  { readonly kind: 'single_worker' }
>;
type EnvironmentBinding = Pick<
  ProductWorkDefinitionDocument['spec'],
  'environment_version_id' | 'environment'
>;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertInternalTeam(
  version: TeamVersion,
  owner: WorkDefinitionSourceOwner,
  definitionId: string,
  spec: TeamSpec,
): void {
  if (
    version.definitionId !== definitionId ||
    version.tenantId !== owner.tenantId ||
    version.workspaceId !== owner.workspaceId ||
    version.principalType !== owner.principalType ||
    version.principalId !== owner.principalId ||
    JSON.stringify(version.spec) !== JSON.stringify(spec)
  )
    throw new Error('Internal Product Work Team binding conflict.');
}
