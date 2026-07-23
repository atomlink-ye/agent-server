import type { Hono } from 'hono';
import { z } from 'zod';

import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  CreateMemoryProposal,
  SourceTaskNotFoundError,
} from '../../../application/memory/create-memory-proposal.js';
import type { ListMemoryProposals } from '../../../application/memory/list-memory-proposals.js';
import type { ListMemoryEntries } from '../../../application/memory/list-memory-entries.js';
import {
  MemoryProposalAlreadyReviewedError,
  MemoryProposalNotFoundError,
  type ReviewMemoryProposal,
} from '../../../application/memory/review-memory-proposal.js';
import type { MemoryProposal } from '../../../domain/workspace-memory/memory-proposal.js';
import type { WorkspaceMemoryEntry } from '../../../domain/workspace-memory/memory-proposal.js';
import { HttpError } from '../../../contracts/http.js';
import {
  CreateMemoryProposalRequestSchema,
  type CreateMemoryProposalResponse,
  type ListMemoryEntriesResponse,
  type ListMemoryProposalsResponse,
  MAX_WORKSPACE_MEMORY_REQUEST_BYTES,
  type MemoryProposalResponse,
  ReviewMemoryProposalRequestSchema,
  type ReviewMemoryProposalResponse,
  type WorkspaceMemoryEntryResponse,
} from '../../../contracts/workspace-memory.js';
import type { AppConfig } from '../../../shared/config.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { ManagedMemory } from '../../../application/memory/managed-memory.js';
import { managedScope } from '../../../application/memory/managed-memory.js';

interface WorkspaceMemoryRouteDependencies {
  readonly config: AppConfig;
  readonly createMemoryProposal: CreateMemoryProposal;
  readonly listMemoryProposals: ListMemoryProposals;
  readonly reviewMemoryProposal: ReviewMemoryProposal;
  readonly listMemoryEntries: ListMemoryEntries;
  readonly managedMemory?: ManagedMemory;
}

const PROPOSALS_PATH = '/api/v1/workspace-memory/proposals';
const ENTRIES_PATH = '/api/v1/workspace-memory/entries';
const WORKSPACE_MEMORY_CHILD_PATH = '/api/v1/workspace-memory/*';

export function registerWorkspaceMemoryRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: WorkspaceMemoryRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );

  app.use(
    WORKSPACE_MEMORY_CHILD_PATH,
    requireServiceAccountAccess(authenticator),
  );

  app.post(PROPOSALS_PATH, async (context) => {
    const input = CreateMemoryProposalRequestSchema.safeParse(
      await readBoundedJson(context.req.raw),
    );
    if (!input.success) {
      throw new HttpError(
        400,
        'invalid_request',
        'Non-empty content and category are required and no unknown fields are allowed.',
      );
    }

    try {
      const proposal = await dependencies.createMemoryProposal.execute({
        content: input.data.content,
        category: input.data.category,
        ...(input.data.source_task_id !== undefined
          ? { sourceTaskId: input.data.source_task_id }
          : {}),
        ...(input.data.source_session_id !== undefined
          ? { sourceSessionId: input.data.source_session_id }
          : {}),
        accessContext: getAuthenticatedAccessContext(context),
      });

      const response: CreateMemoryProposalResponse = {
        proposal: toProposalResponse(proposal),
        links: {
          self: `${PROPOSALS_PATH}/${proposal.id}`,
        },
      };
      return context.json(response, 201);
    } catch (error) {
      if (error instanceof SourceTaskNotFoundError) {
        throw new HttpError(404, error.code, error.message);
      }

      throw error;
    }
  });

  app.get(PROPOSALS_PATH, async (context) => {
    const proposals = await dependencies.listMemoryProposals.execute(
      getAuthenticatedAccessContext(context),
    );
    const response: ListMemoryProposalsResponse = {
      proposals: proposals.map(toProposalResponse),
    };
    return context.json(response, 200);
  });

  app.get(`${PROPOSALS_PATH}/:proposalId`, async (context) => {
    const id = z.uuid().safeParse(context.req.param('proposalId'));
    if (!id.success)
      throw new HttpError(
        400,
        'invalid_request',
        'proposal_id must be a valid UUID.',
      );
    const proposal = await dependencies.reviewMemoryProposal.findForAccess(
      id.data,
      getAuthenticatedAccessContext(context),
    );
    if (!proposal)
      throw new HttpError(
        404,
        'memory_proposal_not_found',
        'The requested memory proposal does not exist.',
      );
    return context.json({ proposal: toProposalResponse(proposal) }, 200);
  });

  app.post(`${PROPOSALS_PATH}/:proposalId/review`, async (context) => {
    const proposalId = z.uuid().safeParse(context.req.param('proposalId'));
    if (!proposalId.success) {
      throw new HttpError(
        400,
        'invalid_request',
        'proposal_id must be a valid UUID.',
      );
    }

    const input = ReviewMemoryProposalRequestSchema.safeParse(
      await readBoundedJson(context.req.raw),
    );
    if (!input.success) {
      throw new HttpError(
        400,
        'invalid_request',
        'Review action must be accept, edit_and_accept, or reject with valid content only when editing.',
      );
    }

    try {
      const result = await dependencies.reviewMemoryProposal.execute({
        proposalId: proposalId.data,
        action: input.data.action,
        ...('content' in input.data ? { content: input.data.content } : {}),
        accessContext: getAuthenticatedAccessContext(context),
      });

      const response: ReviewMemoryProposalResponse = {
        proposal: toProposalResponse(result.proposal),
        entry: result.entry ? toEntryResponse(result.entry) : null,
      };
      if (result.entry && dependencies.managedMemory)
        await dependencies.managedMemory.acceptEntry(result.entry);
      return context.json(response, 200);
    } catch (error) {
      if (error instanceof MemoryProposalNotFoundError) {
        throw new HttpError(404, error.code, error.message);
      }
      if (error instanceof MemoryProposalAlreadyReviewedError) {
        throw new HttpError(409, error.code, error.message);
      }

      throw error;
    }
  });

  app.get(ENTRIES_PATH, async (context) => {
    const entries = await dependencies.listMemoryEntries.execute(
      getAuthenticatedAccessContext(context),
    );
    const response: ListMemoryEntriesResponse = {
      entries: entries.map(toEntryResponse),
    };
    return context.json(response, 200);
  });

  app.get('/api/v1/workspaces/:workspaceId/memory/entries', async (context) => {
    const access = getAuthenticatedAccessContext(context);
    if (
      context.req.param('workspaceId') !== access.workspaceId ||
      !dependencies.managedMemory
    )
      throw new HttpError(
        404,
        'not_found',
        'The requested resource does not exist.',
      );
    return context.json(
      {
        entries: await dependencies.managedMemory.listEntries(
          managedScope(access),
        ),
      },
      200,
    );
  });
  app.get(
    '/api/v1/workspaces/:workspaceId/memory/snapshots',
    async (context) => {
      const access = getAuthenticatedAccessContext(context);
      if (
        context.req.param('workspaceId') !== access.workspaceId ||
        !dependencies.managedMemory
      )
        throw new HttpError(
          404,
          'not_found',
          'The requested resource does not exist.',
        );
      return context.json(
        {
          snapshots: await dependencies.managedMemory.listSnapshots(
            managedScope(access),
          ),
        },
        200,
      );
    },
  );
  app.get(
    '/api/v1/workspaces/:workspaceId/memory/snapshots/:snapshotId',
    async (context) => {
      const access = getAuthenticatedAccessContext(context);
      if (
        context.req.param('workspaceId') !== access.workspaceId ||
        !dependencies.managedMemory
      )
        throw new HttpError(
          404,
          'not_found',
          'The requested resource does not exist.',
        );
      const snapshot = await dependencies.managedMemory.getSnapshot(
        managedScope(access),
        context.req.param('snapshotId'),
      );
      if (!snapshot)
        throw new HttpError(
          404,
          'not_found',
          'The requested resource does not exist.',
        );
      return context.json({ snapshot }, 200);
    },
  );
  app.post(
    '/api/v1/workspaces/:workspaceId/memory/snapshots:rebuild',
    async (context) => {
      const access = getAuthenticatedAccessContext(context);
      if (
        context.req.param('workspaceId') !== access.workspaceId ||
        !dependencies.managedMemory
      )
        throw new HttpError(
          404,
          'not_found',
          'The requested resource does not exist.',
        );
      return context.json(
        {
          snapshot: await dependencies.managedMemory.rebuild(
            managedScope(access),
          ),
        },
        201,
      );
    },
  );
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number.parseInt(
    request.headers.get('content-length') ?? '0',
    10,
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_WORKSPACE_MEMORY_REQUEST_BYTES
  ) {
    throw new HttpError(
      413,
      'request_too_large',
      'The request body exceeds 64 KiB.',
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_WORKSPACE_MEMORY_REQUEST_BYTES) {
    throw new HttpError(
      413,
      'request_too_large',
      'The request body exceeds 64 KiB.',
    );
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes) || '{}') as unknown;
  } catch {
    throw new HttpError(
      400,
      'invalid_json',
      'The request body is not valid JSON.',
    );
  }
}

function toProposalResponse(proposal: MemoryProposal): MemoryProposalResponse {
  return {
    proposal_id: proposal.id,
    content: proposal.originalContent,
    category: proposal.originalCategory,
    source_task_id: proposal.sourceTaskId,
    source_session_id: proposal.sourceSessionId,
    status: proposal.status,
    review_outcome: proposal.reviewOutcome,
    reviewed_content: proposal.reviewedContent,
    reviewed_at: proposal.reviewedAt,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
  };
}

function toEntryResponse(
  entry: WorkspaceMemoryEntry,
): WorkspaceMemoryEntryResponse {
  return {
    entry_id: entry.id,
    proposal_id: entry.proposalId,
    content: entry.content,
    category: entry.category,
    source_task_id: entry.sourceTaskId,
    source_session_id: entry.sourceSessionId,
    review_outcome: entry.reviewOutcome,
    accepted_at: entry.acceptedAt,
  };
}
