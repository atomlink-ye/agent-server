import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';
import {
  GetProductWorkDefinitionVersionResponseSchema,
  UpdateWorkDefinitionVersionResponseSchema,
  WorkDefinitionApplyResponseSchema,
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
    readonly kind: 'single_agent' | 'collaboration';
    readonly participants: readonly {
      readonly name: string;
      readonly role: 'primary' | 'lead' | 'member';
      readonly source: 'referenced' | 'inline';
      readonly agent_version_id: string | null;
      readonly skills: readonly string[];
      readonly tools: readonly string[];
    }[];
    readonly environment: {
      readonly source: 'referenced' | 'inline';
      readonly environment_version_id: string | null;
    };
    readonly memory_version_ids: readonly string[];
    readonly required_runtime_capabilities: readonly string[];
    readonly platform_capabilities: readonly string[];
  };
}

export interface DefinitionApply {
  readonly definitionId: string;
  readonly versionId: string;
}

export class WorkDefinitionClient {
  async validate(source: string): Promise<DefinitionValidation> {
    return decodeDefinitionValidation(
      await apiTransport.request('/api/work-definitions/validate', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      }),
    );
  }

  async plan(source: string): Promise<DefinitionPlan> {
    return decodeDefinitionPlan(
      await apiTransport.request('/api/work-definitions/plan', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      }),
    );
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

function decodeDefinitionValidation(value: unknown): DefinitionValidation {
  const root = objectValue(value);
  const fingerprint = root?.fingerprint;
  if (typeof fingerprint !== 'string' || !fingerprint) {
    throw new Error('The Definition validation response was invalid.');
  }
  return {
    fingerprint,
    diagnostics: decodeDiagnostics(root?.diagnostics),
  };
}

function decodeDefinitionPlan(value: unknown): DefinitionPlan {
  const root = objectValue(value);
  const fingerprint = root?.fingerprint;
  const resolved = objectValue(root?.resolved);
  if (
    typeof fingerprint !== 'string' ||
    !fingerprint ||
    (resolved?.kind !== 'single_agent' && resolved?.kind !== 'collaboration') ||
    !Array.isArray(resolved.participants) ||
    !Array.isArray(resolved.memory_version_ids) ||
    !resolved.memory_version_ids.every(isString) ||
    !Array.isArray(resolved.required_runtime_capabilities) ||
    !resolved.required_runtime_capabilities.every(isString) ||
    !Array.isArray(resolved.platform_capabilities) ||
    !resolved.platform_capabilities.every(isString)
  ) {
    throw new Error('The Definition plan response was invalid.');
  }
  const environment = objectValue(resolved.environment);
  if (
    !environment ||
    (environment.source !== 'referenced' && environment.source !== 'inline') ||
    (environment.environment_version_id !== null &&
      typeof environment.environment_version_id !== 'string')
  ) {
    throw new Error('The Definition plan response was invalid.');
  }
  return {
    fingerprint,
    resolved: {
      kind: resolved.kind,
      participants: resolved.participants.map(decodeParticipant),
      environment: {
        source: environment.source,
        environment_version_id: environment.environment_version_id,
      },
      memory_version_ids: resolved.memory_version_ids,
      required_runtime_capabilities: resolved.required_runtime_capabilities,
      platform_capabilities: resolved.platform_capabilities,
    },
  };
}

function decodeDiagnostics(value: unknown): DefinitionDiagnostics {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new Error('The Definition diagnostics response was invalid.');
  return value.map((item) => {
    const diagnostic = objectValue(item);
    if (
      typeof diagnostic?.path !== 'string' ||
      typeof diagnostic.code !== 'string' ||
      typeof diagnostic.message !== 'string'
    ) {
      throw new Error('The Definition diagnostics response was invalid.');
    }
    return {
      path: diagnostic.path,
      code: diagnostic.code,
      message: diagnostic.message,
    };
  });
}

function decodeParticipant(
  value: unknown,
): DefinitionPlan['resolved']['participants'][number] {
  const participant = objectValue(value);
  if (
    !participant ||
    typeof participant.name !== 'string' ||
    (participant.role !== 'primary' &&
      participant.role !== 'lead' &&
      participant.role !== 'member') ||
    (participant.source !== 'referenced' && participant.source !== 'inline') ||
    (participant.agent_version_id !== null &&
      typeof participant.agent_version_id !== 'string') ||
    !Array.isArray(participant.skills) ||
    !participant.skills.every(isString) ||
    !Array.isArray(participant.tools) ||
    !participant.tools.every(isString)
  )
    throw new Error('The Definition plan response was invalid.');
  return {
    name: participant.name,
    role: participant.role,
    source: participant.source,
    agent_version_id: participant.agent_version_id,
    skills: participant.skills,
    tools: participant.tools,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
