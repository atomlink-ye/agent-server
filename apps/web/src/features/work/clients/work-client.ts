import type {
  WorkListResponse,
  WorkResponse,
} from '@atomlink-ye/agent-server/product-contract';
import {
  CreateWorkResponseSchema,
  GetWorkResponseSchema,
  WorkListResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';
import {
  PostWorkChatMessageResponseSchema,
  RetryWorkChatMessageResponseSchema,
  WorkChatMessagesResponseSchema,
  type WorkChatMessagesResponse,
  ConfirmWorkPreparationResponseSchema,
  type WorkPreparationResponse,
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

  async chat(
    workId: string,
    workRunId?: string,
  ): Promise<WorkChatMessagesResponse> {
    return parseProduct(
      WorkChatMessagesResponseSchema,
      await readProductJson(chatPath(workId, workRunId), {
        method: 'GET',
        cache: 'no-store',
      }),
    );
  }

  async postChat(
    workId: string,
    body: string,
    clientRequestId: string = crypto.randomUUID(),
    workRunId?: string,
  ): Promise<WorkChatMessagesResponse['messages'][number]> {
    try {
      const response = parseProduct(
        PostWorkChatMessageResponseSchema,
        await apiTransport.request(chatPath(workId, workRunId), {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body, client_request_id: clientRequestId }),
        }),
      );
      return response.message;
    } catch (error) {
      return productMutationError(error);
    }
  }

  async retryChat(
    workId: string,
    messageId: string,
    workRunId?: string,
  ): Promise<WorkChatMessagesResponse['messages'][number]> {
    const response = parseProduct(
      RetryWorkChatMessageResponseSchema,
      await apiTransport.request(
        `${chatPath(workId, workRunId)}/${encodeURIComponent(messageId)}/retry`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      ),
    );
    return response.message;
  }

  async confirmPreparation(
    workId: string,
    preparationId: string,
    revision: number,
    clientRequestId = crypto.randomUUID(),
  ): Promise<WorkPreparationResponse> {
    try {
      const response = parseProduct(
        ConfirmWorkPreparationResponseSchema,
        await apiTransport.request(
          `/api/works/${encodeURIComponent(workId)}/preparation/confirm`,
          {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              preparation_id: preparationId,
              expected_revision: revision,
              client_request_id: clientRequestId,
            }),
          },
        ),
      );
      return response.preparation;
    } catch (error) {
      return productMutationError(error);
    }
  }
}

export const workClient = new WorkClient();

function chatPath(workId: string, workRunId?: string): string {
  return `/api/works/${encodeURIComponent(workId)}${workRunId ? `/runs/${encodeURIComponent(workRunId)}` : ''}/chat`;
}
