import { randomUUID } from 'node:crypto';

import {
  CreateWorkResponseSchema,
  StartWorkRunResponseSchema,
} from '../../contracts/product-work-commands.js';
import {
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
} from '../../contracts/product-projection/index.js';
import {
  GetProductWorkDefinitionVersionResponseSchema,
  WorkDefinitionApplyResponseSchema,
  WorkDefinitionPlanResponseSchema,
  WorkDefinitionValidateFailureSchema,
  WorkDefinitionValidateSuccessSchema,
} from '../../contracts/product-work-definitions.js';

export interface ProductDeveloperClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

export interface RunDefinitionInput {
  readonly source: string;
  readonly title: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey?: string;
  readonly triggerRef?: string;
}

/**
 * Intentionally thin MVE helper. Server resource APIs remain the source of truth;
 * this client only composes the canonical Definition -> Work -> Run journey.
 */
export class ProductDeveloperClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly request: typeof fetch;

  public constructor(options: ProductDeveloperClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.request = options.fetch ?? fetch;
  }

  public async validateDefinition(source: string) {
    const response = await this.json('/api/v1/work-definitions:validate', {
      method: 'POST',
      body: { source },
    });
    const valid = WorkDefinitionValidateSuccessSchema.safeParse(response);
    if (valid.success) return valid.data;
    return WorkDefinitionValidateFailureSchema.parse(response);
  }

  public async planDefinition(source: string) {
    return WorkDefinitionPlanResponseSchema.parse(
      await this.json('/api/v1/work-definitions:plan', {
        method: 'POST',
        body: { source },
      }),
    );
  }

  public async applyDefinition(source: string, idempotencyKey: string) {
    return WorkDefinitionApplyResponseSchema.parse(
      await this.json('/api/v1/work-definitions:apply', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: { source },
      }),
    );
  }

  public async getDefinitionVersion(versionId: string) {
    return GetProductWorkDefinitionVersionResponseSchema.parse(
      await this.json(`/api/v1/work-definition-versions/${versionId}`),
    ).version;
  }

  public async createWork(input: {
    readonly definitionId: string;
    readonly definitionVersionId: string;
    readonly title: string;
  }) {
    return CreateWorkResponseSchema.parse(
      await this.json('/api/v1/works', {
        method: 'POST',
        body: {
          definition_id: input.definitionId,
          definition_version_id: input.definitionVersionId,
          title: input.title,
        },
      }),
    );
  }

  public async createWorkFromDefinitionVersion(input: {
    readonly definitionVersionId: string;
    readonly title: string;
  }) {
    const version = await this.getDefinitionVersion(input.definitionVersionId);
    return this.createWork({
      definitionId: version.definition_id,
      definitionVersionId: version.id,
      title: input.title,
    });
  }

  public async startWorkRun(input: {
    readonly workId: string;
    readonly input?: Readonly<Record<string, unknown>>;
    readonly triggerRef?: string;
  }) {
    return StartWorkRunResponseSchema.parse(
      await this.json(`/api/v1/works/${input.workId}/runs`, {
        method: 'POST',
        body: {
          trigger_kind: 'manual',
          ...(input.triggerRef ? { trigger_ref: input.triggerRef } : {}),
          ...(input.input === undefined ? {} : { input: input.input }),
        },
      }),
    );
  }

  public async getWorkRun(workId: string, workRunId: string) {
    return ProductWorkRunResponseSchema.parse(
      await this.json(`/api/v1/works/${workId}/runs/${workRunId}`),
    );
  }

  public async getRunTrace(workId: string, workRunId: string) {
    return ProductRunTraceResponseSchema.parse(
      await this.json(`/api/v1/works/${workId}/runs/${workRunId}/trace`),
    );
  }

  public async runDefinition(input: RunDefinitionInput) {
    const idempotencyKey = input.idempotencyKey ?? `definition-${randomUUID()}`;
    const applied = await this.applyDefinition(input.source, idempotencyKey);
    const created = await this.createWork({
      definitionId: applied.definition.id,
      definitionVersionId: applied.version.id,
      title: input.title,
    });
    const started = await this.startWorkRun({
      workId: created.work.id,
      ...(input.input === undefined ? {} : { input: input.input }),
      ...(input.triggerRef === undefined
        ? {}
        : { triggerRef: input.triggerRef }),
    });
    return {
      definition: applied.definition,
      version: applied.version,
      work: created.work,
      workRun: started.work_run,
      executionReceipt: started.execution_receipt,
    };
  }

  public async waitForWorkRun(input: {
    readonly workId: string;
    readonly workRunId: string;
    readonly pollMs?: number;
    readonly timeoutMs?: number;
  }) {
    const pollMs = input.pollMs ?? 500;
    const timeoutMs = input.timeoutMs ?? 10 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const run = await this.getWorkRun(input.workId, input.workRunId);
      if (
        'projection_status' in run &&
        run.projection_status === 'internally_anchored' &&
        run.work_run.product_state !== 'running'
      )
        return run;
      if (Date.now() >= deadline)
        throw new ProductDeveloperClientError(
          408,
          'wait_timeout',
          'Timed out waiting for the WorkRun to leave running state.',
        );
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  private async json(
    path: string,
    options: {
      readonly method?: 'GET' | 'POST';
      readonly headers?: Readonly<Record<string, string>>;
      readonly body?: unknown;
    } = {},
  ): Promise<unknown> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/json',
        ...(options.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      const error = errorFrom(value);
      throw new ProductDeveloperClientError(
        response.status,
        error.code,
        error.message,
        error.path,
      );
    }
    return value;
  }
}

export class ProductDeveloperClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = 'ProductDeveloperClientError';
  }
}

function errorFrom(value: unknown): {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
} {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const body = value as Record<string, unknown>;
    const error = body.error;
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const item = error as Record<string, unknown>;
      if (typeof item.code === 'string' && typeof item.message === 'string')
        return {
          code: item.code,
          message: item.message,
          ...(typeof item.path === 'string' ? { path: item.path } : {}),
        };
    }
    const diagnostics = body.diagnostics;
    if (Array.isArray(diagnostics) && diagnostics[0]) {
      const first = diagnostics[0] as Record<string, unknown>;
      return {
        code:
          typeof first.code === 'string' ? first.code : 'invalid_definition',
        message:
          typeof first.message === 'string'
            ? first.message
            : 'The Work Definition is invalid.',
        ...(typeof first.path === 'string' ? { path: first.path } : {}),
      };
    }
  }
  return {
    code: 'request_failed',
    message: 'Agent Server rejected the request.',
  };
}
