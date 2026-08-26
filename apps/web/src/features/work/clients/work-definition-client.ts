import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';
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
