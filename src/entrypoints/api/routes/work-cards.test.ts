import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  ChatWorkCardNotFoundError,
  type ChatWorkCardProjection,
  type ChatWorkCard,
} from '../../../application/product-projection/chat-work-card-projection.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import { registerWorkCardRoutes } from './work-cards.js';

const workId = '00000000-0000-4000-8000-000000000001';

const config = {
  serviceAccounts: [
    {
      serviceAccountId: 'svc-a',
      token: 'token-a',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      policyVersion: 'policy-a',
      disabled: false,
    },
  ],
} as unknown as AppConfig;

describe('Work Chat card route', () => {
  it('returns only the safe ChatWorkCardProjection fields', async () => {
    const card: ChatWorkCard = {
      workId,
      workRef: workId,
      title: 'Example Work',
      productState: 'complete',
      problemKind: null,
      attentionReason: null,
      resultSummary: 'Done',
      resultCaptureStatus: 'present',
    };
    const getByWorkId = vi.fn<ChatWorkCardProjection['getByWorkId']>();
    getByWorkId.mockResolvedValue(card);
    const app = createApp(getByWorkId);

    const response = await app.request(`/api/v1/works/${workId}/chat-card`, {
      headers: { authorization: 'Bearer token-a' },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(card);
    expect(JSON.stringify(body)).not.toMatch(
      /taskId|task_id|runId|run_id|provider_session|session_id/,
    );
  });

  it('does not expose a Work from tenant/workspace B to service account A', async () => {
    const getByWorkId = vi.fn<ChatWorkCardProjection['getByWorkId']>();
    getByWorkId.mockRejectedValue(new ChatWorkCardNotFoundError());
    const app = createApp(getByWorkId);

    const response = await app.request(`/api/v1/works/${workId}/chat-card`, {
      headers: { authorization: 'Bearer token-a' },
    });

    expect(response.status).toBe(404);
    expect(getByWorkId).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      workId,
    });
  });
});

function createApp(
  getByWorkId: ChatWorkCardProjection['getByWorkId'],
): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  registerWorkCardRoutes(app, {
    config,
    chatWorkCard: { getByWorkId },
  });
  return app;
}
