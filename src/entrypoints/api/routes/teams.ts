import type { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import type { InvokableRepository } from '../../../application/ports/invokable-repository.js';
import type { EnvironmentRegistry } from '../../../application/ports/environment-registry.js';
import { createTeamDefinition } from '../../../domain/invokables/team-definition.js';
import {
  createCollaborativeDraftTeamVersion,
  publishCollaborativeTeamVersion,
} from '../../../domain/invokables/team-version.js';
import {
  validateAndCanonicalizeTeamPackage,
  TeamPackageValidationError,
} from '../../../domain/teams/managed-team-package.js';
import { HttpError } from '../../../contracts/http.js';
import {
  TeamPackageRequestSchema,
  PublishTeamVersionRequestSchema,
  MAX_TEAM_REQUEST_BYTES,
  TeamDefinitionResponseSchema,
  TeamVersionResponseSchema,
  TeamVersionListResponseSchema,
} from '../../../contracts/teams.js';
import { readBoundedJson } from '../read-bounded-json.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';

export interface TeamRouteDependencies {
  readonly config: AppConfig;
  readonly invokableRepository: InvokableRepository;
  readonly environmentRegistry: EnvironmentRegistry;
}
export function registerTeamRoutes(
  app: Hono<ApiEnvironment>,
  d: TeamRouteDependencies,
): void {
  const auth = new ServiceAccountAuthenticator(d.config.serviceAccounts ?? []);
  for (const path of [
    '/api/v1/team-packages:validate',
    '/api/v1/teams:import',
    '/api/v1/teams/*',
    '/api/v1/team-versions/*',
  ])
    app.use(path, requireServiceAccountAccess(auth));
  app.post('/api/v1/team-packages:validate', async (c) => {
    const input = TeamPackageRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_TEAM_REQUEST_BYTES),
    );
    if (!input.success) throw invalid();
    try {
      const result = validateAndCanonicalizeTeamPackage(input.data.source);
      return c.json(
        {
          valid: true,
          fingerprint: result.fingerprint,
          metadata: { name: result.package.metadata.name },
        },
        200,
      );
    } catch (e) {
      if (e instanceof TeamPackageValidationError)
        throw new HttpError(400, 'invalid_team_package', e.message);
      if (e instanceof Error && e.message === 'idempotency_conflict')
        throw new HttpError(
          409,
          'idempotency_conflict',
          'The Idempotency-Key cannot be reused with a different request body.',
        );
      throw e;
    }
  });
  app.post('/api/v1/teams:import', async (c) => {
    const input = TeamPackageRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_TEAM_REQUEST_BYTES),
    );
    if (!input.success) throw invalid();
    const owner = getAuthenticatedAccessContext(c);
    const idempotencyKey = c.req.header('idempotency-key') ?? '';
    if (!idempotencyKey) throw invalid();
    const requestFingerprint = fingerprint(input.data.source);
    try {
      if (
        !d.invokableRepository.findTeamRegistryIdempotency ||
        !d.invokableRepository.recordTeamRegistryIdempotency
      )
        throw new Error('Team registry idempotency is unavailable.');
      const replay = await d.invokableRepository
        .findTeamRegistryIdempotency({
          operation: 'import',
          idempotencyKey,
          requestFingerprint,
          ownerScope: owner,
        })
        .catch(mapTeamRegistryError);
      if (replay.definitionId && replay.versionId) {
        const existingDefinition =
          await d.invokableRepository.findTeamDefinitionById(
            replay.definitionId,
          );
        const existingVersion = await d.invokableRepository.findTeamVersionById(
          replay.versionId,
        );
        if (
          existingDefinition &&
          existingVersion &&
          sameOwner(existingDefinition, owner) &&
          sameOwner(existingVersion, owner)
        )
          return c.json(
            {
              result: 'replayed',
              team: definitionResponse(existingDefinition),
              version: versionResponse(existingVersion),
            },
            201,
          );
      }
      const parsed = validateAndCanonicalizeTeamPackage(input.data.source);
      const definition = createTeamDefinition({
        ...owner,
        name: parsed.package.metadata.name,
      });
      const version = createCollaborativeDraftTeamVersion({
        ...owner,
        definitionId: definition.id,
        name: definition.name,
        collaborationSpec: {
          lead: parsed.package.spec.lead,
          roster: parsed.package.spec.roster,
          environmentVersionId: parsed.package.spec.environmentVersionId,
        },
        executionMode: parsed.package.spec.coordination.mode === 'agentic_mve' ? 'agentic_mve' : 'collaborative_mve',
      });
      const atomicImport = d.invokableRepository.importTeamVersionAtomically
        ? await d.invokableRepository.importTeamVersionAtomically({
            definition,
            version,
            idempotencyKey,
            requestFingerprint,
          })
        : (await d.invokableRepository.saveTeamDefinition(definition),
          await d.invokableRepository.saveTeamVersion(version),
          { kind: 'created' as const, definition, version });
      if (atomicImport.kind === 'replayed')
        return c.json(
          {
            result: 'replayed',
            team: definitionResponse(atomicImport.definition),
            version: versionResponse(atomicImport.version),
          },
          201,
        );
      const recorded =
        await d.invokableRepository.recordTeamRegistryIdempotency({
          operation: 'import',
          idempotencyKey,
          requestFingerprint,
          definitionId: definition.id,
          versionId: version.id,
          ownerScope: owner,
        });
      if (
        recorded.definitionId &&
        recorded.versionId &&
        recorded.versionId !== version.id
      ) {
        const existingDefinition =
          await d.invokableRepository.findTeamDefinitionById(
            recorded.definitionId,
          );
        const existingVersion = await d.invokableRepository.findTeamVersionById(
          recorded.versionId,
        );
        if (existingDefinition && existingVersion)
          return c.json(
            {
              result: 'replayed',
              team: definitionResponse(existingDefinition),
              version: versionResponse(existingVersion),
            },
            201,
          );
      }
      return c.json(
        {
          result: 'created',
          team: definitionResponse(definition),
          version: versionResponse(version),
        },
        201,
      );
    } catch (e) {
      if (e instanceof TeamPackageValidationError)
        throw new HttpError(400, 'invalid_team_package', e.message);
      if (e instanceof Error && e.message === 'idempotency_conflict')
        mapTeamRegistryError(e);
      throw e;
    }
  });
  app.get('/api/v1/teams/:teamId', async (c) => {
    const id = uuid(c.req.param('teamId'));
    const owner = getAuthenticatedAccessContext(c);
    const value = await d.invokableRepository.findTeamDefinitionById(id);
    if (!value || !sameOwner(value, owner))
      throw new HttpError(404, 'team_not_found', 'The team was not found.');
    return c.json(
      TeamDefinitionResponseSchema.parse(definitionResponse(value)),
      200,
    );
  });
  app.get('/api/v1/teams/:teamId/versions', async (c) => {
    const id = uuid(c.req.param('teamId'));
    const owner = getAuthenticatedAccessContext(c);
    const limit = Number(c.req.query('limit') ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid();
    if (!d.invokableRepository.listTeamVersionsByDefinitionId)
      throw new Error('Team version listing is unavailable.');
    const page = await d.invokableRepository.listTeamVersionsByDefinitionId(
      id,
      owner,
      limit,
      c.req.query('cursor'),
    );
    return c.json(
      TeamVersionListResponseSchema.parse({
        items: page.items.map(versionResponse),
        next_cursor: page.nextCursor,
      }),
      200,
    );
  });
  app.get('/api/v1/team-versions/:versionId', async (c) => {
    const id = uuid(c.req.param('versionId'));
    const owner = getAuthenticatedAccessContext(c);
    const value = await d.invokableRepository.findTeamVersionById(id);
    if (!value || !sameOwner(value, owner))
      throw new HttpError(404, 'team_not_found', 'The team was not found.');
    return c.json(TeamVersionResponseSchema.parse(versionResponse(value)), 200);
  });
  app.post('/api/v1/team-versions/:versionId:publish', async (c) => {
    const id = uuid(
      c.req.param('versionId') ??
        c.req.path.match(/\/team-versions\/([^:]+):publish$/)?.[1],
    );
    const input = PublishTeamVersionRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_TEAM_REQUEST_BYTES),
    );
    if (!input.success) throw invalid();
    const owner = getAuthenticatedAccessContext(c);
    const idempotencyKey = c.req.header('idempotency-key') ?? '';
    if (!idempotencyKey) throw invalid();
    const requestFingerprint = fingerprint(
      JSON.stringify({ versionId: id, body: input.data }),
    );
    if (
      !d.invokableRepository.findTeamRegistryIdempotency ||
      !d.invokableRepository.recordTeamRegistryIdempotency
    )
      throw new Error('Team registry idempotency is unavailable.');
    const replay = await d.invokableRepository
      .findTeamRegistryIdempotency({
        operation: 'publish',
        idempotencyKey,
        requestFingerprint,
        ownerScope: owner,
      })
      .catch(mapTeamRegistryError);
    if (replay.versionId) {
      const existing = await d.invokableRepository.findTeamVersionById(
        replay.versionId,
      );
      if (existing && sameOwner(existing, owner))
        return c.json(
          TeamVersionResponseSchema.parse(versionResponse(existing)),
          200,
        );
    }
    const version = await d.invokableRepository.findTeamVersionById(id);
    if (!version || !sameOwner(version, owner))
      throw new HttpError(404, 'team_not_found', 'The team was not found.');
    if (version.status === 'published') {
      await d.invokableRepository
        .recordTeamRegistryIdempotency({
          operation: 'publish',
          idempotencyKey,
          requestFingerprint,
          versionId: version.id,
          ownerScope: owner,
        })
        .catch(mapTeamRegistryError);
      return c.json(
        TeamVersionResponseSchema.parse(versionResponse(version)),
        200,
      );
    }
    if (
      version.executionMode !== 'collaborative_mve' ||
      !version.collaborationSpec
    )
      throw new HttpError(
        400,
        'invalid_team_package',
        'The team version is not collaborative.',
      );
    for (const ref of [
      version.collaborationSpec.lead.agentVersionId,
      ...version.collaborationSpec.roster.map((x) => x.agentVersionId),
    ]) {
      const agent = await d.invokableRepository.findPublishedAgentVersionById(
        ref,
        owner,
      );
      if (!agent)
        throw new HttpError(
          400,
          'invalid_team_package',
          'A referenced agent version is not published in this owner scope.',
        );
    }
    const environment = await d.environmentRegistry.findVersion(
      owner,
      version.collaborationSpec.environmentVersionId,
    );
    if (!environment || environment.status !== 'published')
      throw new HttpError(
        400,
        'invalid_team_package',
        'The referenced environment version is not published in this owner scope.',
      );
    const published = publishCollaborativeTeamVersion(version);
    if (d.invokableRepository.publishTeamVersionAtomically)
      await d.invokableRepository
        .publishTeamVersionAtomically({
          version: published,
          idempotencyKey,
          requestFingerprint,
        })
        .catch(mapTeamRegistryError);
    else await d.invokableRepository.saveTeamVersion(published);
    await d.invokableRepository
      .recordTeamRegistryIdempotency({
        operation: 'publish',
        idempotencyKey,
        requestFingerprint,
        versionId: published.id,
        ownerScope: owner,
      })
      .catch(mapTeamRegistryError);
    return c.json(
      TeamVersionResponseSchema.parse(versionResponse(published)),
      200,
    );
  });
}
function invalid() {
  return new HttpError(400, 'invalid_request', 'The request is invalid.');
}
function fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
function mapTeamRegistryError(error: unknown): never {
  if (error instanceof Error && error.message === 'idempotency_conflict')
    throw new HttpError(
      409,
      'idempotency_conflict',
      'The Idempotency-Key cannot be reused with a different request body.',
    );
  throw error;
}
function uuid(v: string | undefined): string {
  if (!v || !/^[0-9a-f-]{36}$/i.test(v)) throw invalid();
  return v;
}
function sameOwner(
  a: {
    tenantId: string;
    workspaceId: string;
    principalType: string;
    principalId: string;
  },
  b: {
    tenantId: string;
    workspaceId: string;
    principalType: string;
    principalId: string;
  },
) {
  return (
    a.tenantId === b.tenantId &&
    a.workspaceId === b.workspaceId &&
    a.principalType === b.principalType &&
    a.principalId === b.principalId
  );
}
function definitionResponse(v: any) {
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    links: {
      self: `/api/v1/teams/${v.id}`,
      versions: `/api/v1/teams/${v.id}/versions`,
    },
  };
}
function versionResponse(v: any) {
  return {
    id: v.id,
    definition_id: v.definitionId,
    status: v.status,
    name: v.name,
    description: v.description,
    execution_mode: v.executionMode,
    environment_version_id: v.environmentVersionId,
    collaboration_spec: v.collaborationSpec,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    published_at: v.publishedAt,
    links: {
      self: `/api/v1/team-versions/${v.id}`,
      definition: `/api/v1/teams/${v.definitionId}`,
    },
  };
}
