import { describe, expect, it } from 'vitest';

import { ErrorResponseSchema } from '../../src/contracts/http.js';
import {
  CreateMemoryProposalResponseSchema,
  ListMemoryEntriesResponseSchema,
  ListMemoryProposalsResponseSchema,
  ReviewMemoryProposalResponseSchema,
} from '../../src/contracts/workspace-memory.js';
import { InvokeTaskResponseSchema } from '../../src/contracts/tasks.js';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  disabledServiceAccountToken,
  primaryServiceAccountToken,
  secondaryServiceAccountToken,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';

const authenticatedJsonHeaders = {
  authorization: `Bearer ${primaryServiceAccountToken}`,
  'content-type': 'application/json',
};

describe('workspace memory HTTP contracts', () => {
  it.each([
    [{}, 'missing'],
    [{ authorization: 'Basic nope' }, 'malformed'],
    [{ authorization: 'Bearer token-unknown' }, 'unknown'],
    [{ authorization: `Bearer ${disabledServiceAccountToken}` }, 'disabled'],
  ])(
    'returns the same public 401 for %s bearer auth failure',
    async (headers, _reason) => {
      const app = await createTestApp(new FakeAgentRuntime(), {
        startDispatcher: false,
      });

      const response = await app.request('/api/v1/workspace-memory/proposals', {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'x-request-id': 'req-memory-unauthorized',
        },
        body: JSON.stringify({
          content: 'Remember this.',
          category: 'general',
        }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(await response.json()).toEqual({
        error: {
          code: 'unauthorized',
          message: 'Authentication is required to access this resource.',
          request_id: 'req-memory-unauthorized',
        },
      });
    },
  );

  it('requires service account auth for future workspace-memory child routes', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });

    const response = await app.request(
      '/api/v1/workspace-memory/proposals/future-child',
      {
        headers: { 'x-request-id': 'req-memory-child-unauthorized' },
      },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toEqual({
      error: {
        code: 'unauthorized',
        message: 'Authentication is required to access this resource.',
        request_id: 'req-memory-child-unauthorized',
      },
    });
  });

  it('creates and lists owner-scoped proposals newest first', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });

    const first = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({ content: 'Remember first.', category: 'general' }),
    });
    const second = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        content: 'Remember second.',
        category: 'preference',
        source_session_id: 'session-2',
      }),
    });
    await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secondaryServiceAccountToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: 'Other owner.', category: 'general' }),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = CreateMemoryProposalResponseSchema.parse(
      await first.json(),
    );
    const secondBody = CreateMemoryProposalResponseSchema.parse(
      await second.json(),
    );

    const list = await app.request('/api/v1/workspace-memory/proposals', {
      headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
    });

    expect(list.status).toBe(200);
    const body = ListMemoryProposalsResponseSchema.parse(await list.json());
    expect(body.proposals.map((proposal) => proposal.proposal_id)).toEqual([
      secondBody.proposal.proposal_id,
      firstBody.proposal.proposal_id,
    ]);
    expect(body.proposals[0]).toMatchObject({
      content: 'Remember second.',
      category: 'preference',
      status: 'pending',
      source_task_id: null,
      source_session_id: 'session-2',
    });
  });

  it('accepts a visible source_task_id and rejects an unknown source_task_id', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const task = InvokeTaskResponseSchema.parse(
      await (
        await app.request('/api/v1/tasks:invoke', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            invokable: {
              kind: 'agent',
              version_id: defaultPublishedAgentVersionId,
            },
            input: { text: 'source task prompt' },
          }),
        })
      ).json(),
    );

    const created = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        content: 'Remember task output.',
        category: 'task',
        source_task_id: task.task_id,
      }),
    });
    expect(created.status).toBe(201);
    expect(
      CreateMemoryProposalResponseSchema.parse(await created.json()).proposal
        .source_task_id,
    ).toBe(task.task_id);

    const missing = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        content: 'Remember missing task.',
        category: 'task',
        source_task_id: '00000000-0000-4000-8000-000000000404',
      }),
    });

    expect(missing.status).toBe(404);
    expect(ErrorResponseSchema.parse(await missing.json()).error.code).toBe(
      'task_not_found',
    );
  });

  it('returns stable invalid_json and invalid_request errors', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });

    const invalidJson = await app.request(
      '/api/v1/workspace-memory/proposals',
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: '{',
      },
    );
    expect(invalidJson.status).toBe(400);
    expect(ErrorResponseSchema.parse(await invalidJson.json()).error.code).toBe(
      'invalid_json',
    );

    const invalidRequest = await app.request(
      '/api/v1/workspace-memory/proposals',
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ content: '', category: 'general', extra: true }),
      },
    );
    expect(invalidRequest.status).toBe(400);
    expect(
      ErrorResponseSchema.parse(await invalidRequest.json()).error.code,
    ).toBe('invalid_request');
  });

  it('returns request_too_large when proposal create body exceeds the limit', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const oversizedBody = JSON.stringify({
      content: 'x'.repeat(65 * 1024),
      category: 'general',
    });

    const response = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: oversizedBody,
    });

    expect(response.status).toBe(413);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'request_too_large',
    );
  });

  it('reviews proposals and lists accepted entries newest first for the authenticated owner', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });

    const accepted = CreateMemoryProposalResponseSchema.parse(
      await (
        await app.request('/api/v1/workspace-memory/proposals', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            content: 'Keep original.',
            category: 'general',
          }),
        })
      ).json(),
    );
    const edited = CreateMemoryProposalResponseSchema.parse(
      await (
        await app.request('/api/v1/workspace-memory/proposals', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            content: 'Draft memory.',
            category: 'preference',
          }),
        })
      ).json(),
    );
    const rejected = CreateMemoryProposalResponseSchema.parse(
      await (
        await app.request('/api/v1/workspace-memory/proposals', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            content: 'Do not keep.',
            category: 'general',
          }),
        })
      ).json(),
    );
    await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secondaryServiceAccountToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: 'Other owner.', category: 'general' }),
    });

    const acceptResponse = await app.request(
      `/api/v1/workspace-memory/proposals/${accepted.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ action: 'accept' }),
      },
    );
    expect(acceptResponse.status).toBe(200);
    const acceptBody = ReviewMemoryProposalResponseSchema.parse(
      await acceptResponse.json(),
    );
    expect(acceptBody.proposal.status).toBe('accepted');
    expect(acceptBody.entry).toMatchObject({
      proposal_id: accepted.proposal.proposal_id,
      content: 'Keep original.',
      category: 'general',
      review_outcome: 'accept',
    });

    const editResponse = await app.request(
      `/api/v1/workspace-memory/proposals/${edited.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          action: 'edit_and_accept',
          content: 'Final memory.',
        }),
      },
    );
    expect(editResponse.status).toBe(200);
    expect(
      ReviewMemoryProposalResponseSchema.parse(await editResponse.json()).entry,
    ).toMatchObject({
      proposal_id: edited.proposal.proposal_id,
      content: 'Final memory.',
      review_outcome: 'edit_and_accept',
    });

    const rejectResponse = await app.request(
      `/api/v1/workspace-memory/proposals/${rejected.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ action: 'reject' }),
      },
    );
    expect(rejectResponse.status).toBe(200);
    expect(
      ReviewMemoryProposalResponseSchema.parse(await rejectResponse.json())
        .entry,
    ).toBeNull();

    const entries = await app.request('/api/v1/workspace-memory/entries', {
      headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
    });

    expect(entries.status).toBe(200);
    const entriesBody = ListMemoryEntriesResponseSchema.parse(
      await entries.json(),
    );
    expect(entriesBody.entries.map((entry) => entry.proposal_id)).toEqual([
      edited.proposal.proposal_id,
      accepted.proposal.proposal_id,
    ]);
    expect(entriesBody.entries.map((entry) => entry.content)).toEqual([
      'Final memory.',
      'Keep original.',
    ]);
  });

  it('protects product workspace projections and completes the owner flow', async () => {
    const workspaceId = '00000000-0000-4000-8000-00000000f102';
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId,
    });
    const sourceTask = (await (
      await app.request('/api/v1/tasks:invoke', {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          invokable: {
            kind: 'agent',
            version_id: defaultPublishedAgentVersionId,
          },
          input: { text: 'projection source' },
          workspace_id: workspaceId,
        }),
      })
    ).json()) as { task_id: string };
    const proposal = CreateMemoryProposalResponseSchema.parse(
      await (
        await app.request('/api/v1/workspace-memory/proposals', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            content: 'Projection proof.',
            category: 'rule',
            source_task_id: sourceTask.task_id,
          }),
        })
      ).json(),
    );
    const review = await app.request(
      `/api/v1/workspace-memory/proposals/${proposal.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ action: 'accept' }),
      },
    );
    expect(review.status).toBe(200);

    const productProposals = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/proposals`,
      { headers: { authorization: `Bearer ${primaryServiceAccountToken}` } },
    );
    expect(productProposals.status).toBe(200);
    expect(
      ((await productProposals.json()) as { proposals: unknown[] }).proposals,
    ).toHaveLength(1);

    const entries = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/entries`,
      { headers: { authorization: `Bearer ${primaryServiceAccountToken}` } },
    );
    const snapshots = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/snapshots`,
      { headers: { authorization: `Bearer ${primaryServiceAccountToken}` } },
    );
    expect(entries.status).toBe(200);
    const entriesBody = (await entries.json()) as { entries: unknown[] };
    expect(entriesBody.entries).toHaveLength(1);
    expect(snapshots.status).toBe(200);
    const snapshotsBody = (await snapshots.json()) as {
      snapshots: Array<{
        snapshotId: string;
        projectionStatus: string;
        contentHash: string;
      }>;
    };
    const snapshot = snapshotsBody.snapshots[0]!;
    expect(snapshot.projectionStatus).toBe('ready');
    expect(JSON.stringify(snapshot)).not.toContain('/tmp/agent-server-test');

    const detail = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/snapshots/${snapshot.snapshotId}`,
      { headers: { authorization: `Bearer ${primaryServiceAccountToken}` } },
    );
    expect(detail.status).toBe(200);
    const rebuild = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/snapshots:rebuild`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
      },
    );
    expect(rebuild.status).toBe(201);
    const rebuildBody = (await rebuild.json()) as {
      snapshot: { contentHash: string };
    };
    expect(rebuildBody.snapshot.contentHash).toBe(snapshot.contentHash);

    const unauthenticated = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/entries`,
    );
    expect(unauthenticated.status).toBe(401);
    const foreign = await app.request(
      '/api/v1/workspaces/workspace_foreign/memory/entries',
      { headers: { authorization: `Bearer ${secondaryServiceAccountToken}` } },
    );
    expect(foreign.status).toBe(404);
    const foreignProposals = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/proposals`,
      { headers: { authorization: `Bearer ${secondaryServiceAccountToken}` } },
    );
    expect(foreignProposals.status).toBe(404);
  });

  it('lists proposals independently for two owned Product Workspaces and discloses neither to a foreign principal', async () => {
    const firstWorkspace = '00000000-0000-4000-8000-00000000f201';
    const secondWorkspace = '00000000-0000-4000-8000-00000000f202';
    const createOwnedProposal = async (
      workspaceId: string,
      content: string,
    ) => {
      const app = await createTestApp(new FakeAgentRuntime(), {
        startDispatcher: false,
        workspaceId,
      });
      const task = (await (
        await app.request('/api/v1/tasks:invoke', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            invokable: {
              kind: 'agent',
              version_id: defaultPublishedAgentVersionId,
            },
            input: { text: content },
            workspace_id: workspaceId,
          }),
        })
      ).json()) as { task_id: string };
      await app.request('/api/v1/workspace-memory/proposals', {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          content,
          category: 'workspace',
          source_task_id: task.task_id,
        }),
      });
      return app;
    };
    const firstApp = await createOwnedProposal(firstWorkspace, 'first only');
    const secondApp = await createOwnedProposal(secondWorkspace, 'second only');

    const firstList = await firstApp.request(
      `/api/v1/workspaces/${firstWorkspace}/memory/proposals`,
      { headers: { authorization: `Bearer ${primaryServiceAccountToken}` } },
    );
    const secondList = await secondApp.request(
      `/api/v1/workspaces/${secondWorkspace}/memory/proposals`,
      { headers: { authorization: `Bearer ${primaryServiceAccountToken}` } },
    );
    expect(
      (
        (await firstList.json()) as { proposals: Array<{ content: string }> }
      ).proposals.map((proposal) => proposal.content),
    ).toEqual(['first only']);
    expect(
      (
        (await secondList.json()) as { proposals: Array<{ content: string }> }
      ).proposals.map((proposal) => proposal.content),
    ).toEqual(['second only']);
    const foreign = await firstApp.request(
      `/api/v1/workspaces/${firstWorkspace}/memory/proposals`,
      { headers: { authorization: `Bearer ${secondaryServiceAccountToken}` } },
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain(firstWorkspace);
  });

  it('derives product workspace scope from a source task and hides it from a foreign principal', async () => {
    const workspaceId = '00000000-0000-4000-8000-00000000f101';
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId,
    });
    const taskResponse = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'product source' },
        workspace_id: workspaceId,
      }),
    });
    const task = (await taskResponse.json()) as { task_id: string };
    const proposalResponse = await app.request(
      '/api/v1/workspace-memory/proposals',
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          content: 'Product scoped fact.',
          category: 'fact',
          source_task_id: task.task_id,
        }),
      },
    );
    const proposal = CreateMemoryProposalResponseSchema.parse(
      await proposalResponse.json(),
    );
    const review = await app.request(
      `/api/v1/workspace-memory/proposals/${proposal.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ action: 'accept' }),
      },
    );
    expect(review.status).toBe(200);
    const primaryEntriesResponse = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/entries`,
      { headers: { authorization: `Bearer ${primaryServiceAccountToken}` } },
    );
    expect(
      primaryEntriesResponse.status,
      await primaryEntriesResponse.text(),
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/v1/workspace-memory/proposals/${proposal.proposal.proposal_id}`,
          {
            headers: {
              authorization: `Bearer ${secondaryServiceAccountToken}`,
            },
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/workspaces/${workspaceId}/memory/entries`, {
          headers: { authorization: `Bearer ${secondaryServiceAccountToken}` },
        })
      ).status,
    ).toBe(404);
  });

  it('retries an accepted review after projection failure and rejects conflicting replay', async () => {
    const workspaceId = '00000000-0000-4000-8000-00000000f103';
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId,
      projectionFailures: 1,
    });
    const taskResponse = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'retry source' },
        workspace_id: workspaceId,
      }),
    });
    const task = (await taskResponse.json()) as { task_id: string };
    const proposalResponse = await app.request(
      '/api/v1/workspace-memory/proposals',
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          content: 'Retryable fact.',
          category: 'fact',
          source_task_id: task.task_id,
        }),
      },
    );
    const proposal = CreateMemoryProposalResponseSchema.parse(
      await proposalResponse.json(),
    );
    const reviewPath = `/api/v1/workspace-memory/proposals/${proposal.proposal.proposal_id}/review`;
    expect(
      (
        await app.request(reviewPath, {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({ action: 'accept' }),
        })
      ).status,
    ).toBe(500);
    const retry = await app.request(reviewPath, {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({ action: 'accept' }),
    });
    expect(retry.status).toBe(200);
    const legacyEntries = ListMemoryEntriesResponseSchema.parse(
      await (
        await app.request('/api/v1/workspace-memory/entries', {
          headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
        })
      ).json(),
    );
    expect(legacyEntries.entries).toHaveLength(1);
    const ownedEntries = (await (
      await app.request(`/api/v1/workspaces/${workspaceId}/memory/entries`, {
        headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
      })
    ).json()) as { entries: unknown[] };
    expect(ownedEntries.entries).toHaveLength(1);
    expect(
      (
        await app.request(
          `/api/v1/workspaces/${workspaceId}/memory/snapshots`,
          {
            headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(reviewPath, {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            action: 'edit_and_accept',
            content: 'Conflicting replay.',
          }),
        })
      ).status,
    ).toBe(409);
  });

  it('returns stable review validation, not found, and already-reviewed errors', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const proposal = CreateMemoryProposalResponseSchema.parse(
      await (
        await app.request('/api/v1/workspace-memory/proposals', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            content: 'Review once.',
            category: 'general',
          }),
        })
      ).json(),
    );

    for (const body of [
      { action: 'edit_and_accept' },
      { action: 'accept', content: 'not allowed' },
      { action: 'reject', content: 'not allowed' },
    ]) {
      const invalid = await app.request(
        `/api/v1/workspace-memory/proposals/${proposal.proposal.proposal_id}/review`,
        {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify(body),
        },
      );
      expect(invalid.status).toBe(400);
      expect(ErrorResponseSchema.parse(await invalid.json()).error.code).toBe(
        'invalid_request',
      );
    }

    const crossOwner = await app.request(
      `/api/v1/workspace-memory/proposals/${proposal.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secondaryServiceAccountToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'accept' }),
      },
    );
    expect(crossOwner.status).toBe(404);
    expect(ErrorResponseSchema.parse(await crossOwner.json()).error.code).toBe(
      'memory_proposal_not_found',
    );

    const firstReview = await app.request(
      `/api/v1/workspace-memory/proposals/${proposal.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ action: 'accept' }),
      },
    );
    expect(firstReview.status).toBe(200);

    const secondReview = await app.request(
      `/api/v1/workspace-memory/proposals/${proposal.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ action: 'reject' }),
      },
    );
    expect(secondReview.status).toBe(409);
    expect(
      ErrorResponseSchema.parse(await secondReview.json()).error.code,
    ).toBe('memory_proposal_already_reviewed');
  });

  it('returns invalid_request for a malformed review proposal id', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });

    const response = await app.request(
      '/api/v1/workspace-memory/proposals/not-a-uuid/review',
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ action: 'accept' }),
      },
    );

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'invalid_request',
    );
  });
});
