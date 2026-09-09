import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';
import { stringify } from 'yaml';
import {
  GetProductWorkDefinitionVersionResponseSchema,
  UpdateWorkDefinitionVersionResponseSchema,
  WorkDefinitionApplyResponseSchema,
  WorkDefinitionPlanResponseSchema,
  WorkDefinitionValidateSuccessSchema,
} from '@atomlink-ye/agent-server/product-contract';

import { apiTransport } from '../../../api/transport';
import { parseProduct, readOptionalProductJson } from './errors';

export type DefinitionDiagnostics = readonly {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}[];

export interface DefinitionValidation {
  readonly fingerprint: string;
  readonly diagnostics: DefinitionDiagnostics;
}

export interface DefinitionPlan {
  readonly fingerprint: string;
  readonly resolved: {
    readonly kind: 'single_worker' | 'collaboration';
    readonly participants: readonly {
      readonly name: string;
      readonly role: 'primary' | 'lead' | 'member';
      readonly source: 'referenced' | 'inline';
      readonly workerVersionId: string | null;
      readonly skills: readonly string[];
      readonly tools: readonly string[];
    }[];
    readonly environment: {
      readonly source: 'referenced' | 'inline';
      readonly environmentVersionId: string | null;
    };
    readonly memoryVersionIds: readonly string[];
    readonly requiredRuntimeCapabilities: readonly string[];
    readonly platformCapabilities: readonly string[];
  };
}

export interface DefinitionApply {
  readonly definitionId: string;
  readonly versionId: string;
}

export interface WorkDefinitionCatalogEntry {
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly name: string;
  readonly description: string | null;
  readonly composition: 'single_worker' | 'collaboration';
  readonly roster: readonly { readonly name: string; readonly role: string }[];
  readonly availableTo: readonly {
    readonly agentDefinitionId: string;
    readonly definitionVersionId: string;
    readonly displayName: string;
    readonly roleLabel: string | null;
  }[];
}

export class WorkDefinitionClient {
  async validate(source: string): Promise<DefinitionValidation> {
    const body = parseProduct(
      WorkDefinitionValidateSuccessSchema,
      await apiTransport.request('/api/work-definitions/validate', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      }),
    );
    return {
      fingerprint: body.fingerprint,
      diagnostics: body.diagnostics,
    };
  }

  async plan(source: string): Promise<DefinitionPlan> {
    const body = parseProduct(
      WorkDefinitionPlanResponseSchema,
      await apiTransport.request('/api/work-definitions/plan', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      }),
    );
    return {
      fingerprint: body.fingerprint,
      resolved: {
        kind: body.resolved.kind,
        participants: body.resolved.participants.map((participant) => ({
          name: participant.name,
          role: participant.role,
          source: participant.source,
          workerVersionId: participant.worker_version_id,
          skills: participant.skills,
          tools: participant.tools,
        })),
        environment: {
          source: body.resolved.environment.source,
          environmentVersionId:
            body.resolved.environment.environment_version_id,
        },
        memoryVersionIds: body.resolved.memory_version_ids,
        requiredRuntimeCapabilities:
          body.resolved.required_runtime_capabilities,
        platformCapabilities: body.resolved.platform_capabilities,
      },
    };
  }

  async apply(source: string): Promise<DefinitionApply> {
    const body = parseProduct(
      WorkDefinitionApplyResponseSchema,
      await apiTransport.request('/api/work-definitions/apply', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ source }),
      }),
    );
    return { definitionId: body.definition.id, versionId: body.version.id };
  }

  async getVersion(
    versionId: string,
  ): Promise<ProductWorkDefinitionVersionResponse | null> {
    const value = await readOptionalProductJson(
      `/api/work-definition-versions/${encodeURIComponent(versionId)}`,
      { method: 'GET', cache: 'no-store' },
    );
    if (value === null) return null;
    return parseProduct(GetProductWorkDefinitionVersionResponseSchema, value)
      .version;
  }

  async listCatalog(): Promise<readonly WorkDefinitionCatalogEntry[]> {
    const root = record(
      await apiTransport.request('/api/work-definitions', {
        method: 'GET',
        cache: 'no-store',
      }),
    );
    const items = Array.isArray(root?.items) ? root.items : [];
    const entries = await Promise.all(
      items.map(async (item): Promise<WorkDefinitionCatalogEntry | null> => {
        const selector = record(item);
        const definitionId = text(selector?.definitionId);
        const versionId = text(selector?.currentPublishedVersionId);
        const [version, availability] = await Promise.all([
          this.getVersion(versionId),
          this.getAvailability(definitionId),
        ]);
        if (!version) return null;
        const source = record(version.source);
        const metadata = record(source?.metadata);
        const spec = record(source?.spec);
        let roster: WorkDefinitionCatalogEntry['roster'] = [];
        try {
          const plan = await this.plan(
            stringify(version.source, { lineWidth: 0 }),
          );
          roster = plan.resolved.participants.map((participant) => ({
            name: participant.name,
            role: participant.role,
          }));
        } catch {
          // A legacy source can remain visible in the catalog while its
          // optional planning projection is unavailable. Never invent a
          // roster for it.
        }
        return {
          definitionId,
          definitionVersionId: versionId,
          name: text(metadata?.name) || text(selector?.displayName),
          description: nullableText(metadata?.description),
          composition:
            spec?.kind === 'collaboration' ? 'collaboration' : 'single_worker',
          roster,
          availableTo: availability,
        };
      }),
    );
    return entries.filter(
      (entry): entry is WorkDefinitionCatalogEntry => entry !== null,
    );
  }

  async getAvailability(
    definitionId: string,
  ): Promise<WorkDefinitionCatalogEntry['availableTo']> {
    const root = record(
      await apiTransport.request(
        `/api/work-definitions/${encodeURIComponent(definitionId)}/agents`,
        { method: 'GET', cache: 'no-store' },
      ),
    );
    if (!Array.isArray(root?.agents)) return [];
    return root.agents.map((value) => {
      const agent = record(value);
      return {
        agentDefinitionId: text(agent?.agent_definition_id),
        definitionVersionId: text(agent?.definition_version_id),
        displayName: text(agent?.display_name),
        roleLabel: nullableText(agent?.role_label),
      };
    });
  }

  async bindAgent(
    definitionId: string,
    agentDefinitionId: string,
    definitionVersionId: string,
  ): Promise<void> {
    const response = await apiTransport.request(
      `/api/work-definitions/${encodeURIComponent(definitionId)}/agents/${encodeURIComponent(agentDefinitionId)}`,
      {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ definition_version_id: definitionVersionId }),
      },
    );
    const body = record(response);
    if (!body || body.associated !== true)
      throw new Error('The Work Definition could not be made available.');
  }

  async pinVersion(workId: string, definitionVersionId: string): Promise<void> {
    parseProduct(
      UpdateWorkDefinitionVersionResponseSchema,
      await apiTransport.request(
        `/api/works/${encodeURIComponent(workId)}/definition-version`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ definition_version_id: definitionVersionId }),
        },
      ),
    );
  }
}

export const workDefinitionClient = new WorkDefinitionClient();

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function nullableText(value: unknown): string | null {
  return value === null || value === undefined || value === ''
    ? null
    : text(value);
}
