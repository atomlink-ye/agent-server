import type {
  WorkListResponse,
  WorkResponse,
} from '@atomlink-ye/agent-server/product-contract';
import {
  CreateWorkResponseSchema,
  GetWorkResponseSchema,
  WorkListResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';

import { apiTransport } from '../../../api/transport';
import {
  parseProduct,
  productMutationError,
  readProductJson,
  ProductReadError,
} from './errors';

export type CreateWorkResponse = {
  readonly work: WorkResponse;
};

export type CreateWorkInput = {
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly title: string;
};

export class WorkClient {
  async list(): Promise<WorkListResponse> {
    return parseProduct(
      WorkListResponseSchema,
      await readProductJson('/api/works', { method: 'GET', cache: 'no-store' }),
    );
  }

  async get(workId: string): Promise<WorkResponse> {
    const body = parseProduct(
      GetWorkResponseSchema,
      await readProductJson(`/api/works/${encodeURIComponent(workId)}`, {
        method: 'GET',
        cache: 'no-store',
      }),
    );
    if (body.work.id !== workId) {
      throw new ProductReadError(
        'The Product Work response did not match the requested Work.',
        502,
      );
    }
    return body.work;
  }

  async create(input: CreateWorkInput): Promise<CreateWorkResponse> {
    try {
      return parseProduct(
        CreateWorkResponseSchema,
        await apiTransport.request('/api/works', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            definition_id: input.definitionId,
            definition_version_id: input.definitionVersionId,
            title: input.title,
          }),
        }),
      );
    } catch (error) {
      return productMutationError(error);
    }
  }
}

export const workClient = new WorkClient();
