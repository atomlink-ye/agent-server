import type {
  ProductWorkRun,
  WorkRunListResponse,
  WorkRunSummary,
} from '@atomlink-ye/agent-server/product-contract';
import {
  ProductRunTraceResponseSchema,
  ProductSessionTranscriptsResponseSchema,
  ProductWorkRunResponseSchema,
  StartWorkRunResponseSchema,
  WorkRunListResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';

import { apiTransport } from '../../../api/transport';
import {
  parseProduct,
  productMutationError,
  readProductJson,
  ProductReadError,
} from './errors';

export type StartWorkRunResponse = {
  readonly work_run: WorkRunSummary;
};

export type RoleSummary = {
  readonly label: {
    readonly name: string;
    readonly role: string;
    readonly status: string;
  };
  readonly summary: {
    readonly entry_count: number;
    readonly last_meaningful: { readonly action: string | null } | null;
  };
};

export type AnchoredRun = Extract<
  ProductWorkRun,
  { projection_status: 'internally_anchored' }
>;

export class WorkRunClient {
  async list(workId: string): Promise<WorkRunListResponse> {
    const body = parseProduct(
      WorkRunListResponseSchema,
      await readProductJson(`/api/works/${encodeURIComponent(workId)}/runs`, {
        method: 'GET',
        cache: 'no-store',
      }),
    );
    if (body.work_runs.some((run) => run.work_id !== workId)) {
      throw new ProductReadError(
        'The Product WorkRun response did not match the requested Work.',
        502,
      );
    }
    return body;
  }

  async get(workId: string, runId: string): Promise<ProductWorkRun> {
    const body = parseProduct(
      ProductWorkRunResponseSchema,
      await readProductJson(
        `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}`,
        { method: 'GET', cache: 'no-store' },
      ),
    );
    if (
      body.projection_status === 'internally_anchored' &&
      (body.work?.id !== workId || body.work_run?.id !== runId)
    ) {
      throw new ProductReadError(
        'The Product Run response did not match the requested Work.',
        502,
      );
    }
    return body;
  }

  async trace(workId: string, runId: string) {
    const body = parseProduct(
      ProductRunTraceResponseSchema,
      await readProductJson(
        `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/trace`,
        { method: 'GET', cache: 'no-store' },
      ),
    );
    if (
      body.projection_status === 'internally_anchored' &&
      (body.work?.id !== workId || body.work_run?.id !== runId)
    ) {
      throw new ProductReadError(
        'The Product Trace response did not match the requested Run.',
        502,
      );
    }
    return body;
  }

  async sessionTranscripts(
    workId: string,
    runId: string,
  ): Promise<readonly RoleSummary[]> {
    const body = parseProduct(
      ProductSessionTranscriptsResponseSchema,
      await readProductJson(
        `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/session-transcripts`,
        { method: 'GET', cache: 'no-store' },
      ),
    );
    if (body.work_id !== workId || body.work_run_id !== runId) {
      throw new ProductReadError(
        'The session transcript response did not match the requested Run.',
        502,
      );
    }
    return body.sessions.map((session) => ({
      label: session.label,
      summary: {
        entry_count: session.summary.entry_count,
        last_meaningful: session.summary.last_meaningful
          ? { action: session.summary.last_meaningful.action }
          : null,
      },
    }));
  }

  async start(workId: string): Promise<StartWorkRunResponse> {
    try {
      return parseProduct(
        StartWorkRunResponseSchema,
        await apiTransport.request(
          `/api/works/${encodeURIComponent(workId)}/runs`,
          {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ trigger_kind: 'manual' }),
          },
        ),
      );
    } catch (error) {
      return productMutationError(error);
    }
  }
}

export const workRunClient = new WorkRunClient();
