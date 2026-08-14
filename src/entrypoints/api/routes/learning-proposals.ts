import type { Hono } from 'hono';
import { z } from 'zod';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  AcceptLearningProposal,
  GetLearningProposal,
  ListLearningProposals,
  RejectLearningProposal,
} from '../../../application/learning/learning-proposals.js';
import {
  LearningProposalNotPendingError,
  LearningProposalNotFoundError,
} from '../../../application/ports/learning-proposal-repository.js';
import { MemoryPreconditionFailedError } from '../../../application/ports/memory-api-repository.js';
import type { LearningProposal } from '../../../domain/learning/learning-proposal.js';
import { HttpError } from '../../../contracts/http.js';
import {
  EditAndAcceptLearningProposalRequestSchema,
  MAX_LEARNING_PROPOSAL_ACTION_BYTES,
} from '../../../contracts/learning-proposals.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';

export interface LearningProposalRouteDependencies {
  readonly config: AppConfig;
  readonly listLearningProposals: ListLearningProposals;
  readonly getLearningProposal: GetLearningProposal;
  readonly acceptLearningProposal: AcceptLearningProposal;
  readonly rejectLearningProposal: RejectLearningProposal;
}
const BASE = '/api/v1/learning-proposals';

export function registerLearningProposalRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: LearningProposalRouteDependencies,
): void {
  const auth = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  app.use(BASE, requireServiceAccountAccess(auth));
  app.use(`${BASE}/*`, requireServiceAccountAccess(auth));
  app.get(BASE, async (c) => {
    const query = z
      .object({ workspace_id: z.uuid() })
      .strict()
      .safeParse(c.req.query());
    const access = getAuthenticatedAccessContext(c);
    if (!query.success) throw invalid();
    if (query.data.workspace_id !== access.workspaceId) throw notFound();
    return c.json(
      {
        learning_proposals: (
          await dependencies.listLearningProposals.execute(access)
        ).map(toResponse),
      },
      200,
    );
  });
  app.get(`${BASE}/:proposalId`, async (c) => {
    const id = uuid(c.req.param('proposalId'));
    const proposal = await dependencies.getLearningProposal.execute(
      id,
      getAuthenticatedAccessContext(c),
    );
    if (!proposal) throw notFound();
    return c.json({ learning_proposal: toResponse(proposal) }, 200);
  });
  app.post(`${BASE}/:proposalId/accept`, async (c) => {
    const id = uuid(c.req.param('proposalId'));
    const body = await readBoundedJson(
      c.req.raw,
      MAX_LEARNING_PROPOSAL_ACTION_BYTES,
    );
    if (!z.object({}).strict().safeParse(body).success) throw invalid();
    const access = getAuthenticatedAccessContext(c);
    if (!(await dependencies.getLearningProposal.execute(id, access)))
      throw notFound();
    try {
      const result = await dependencies.acceptLearningProposal.execute({
        proposalId: id,
        accessContext: access,
      });
      return c.json(
        {
          learning_proposal: toResponse(result.proposal),
        },
        200,
      );
    } catch (error) {
      throw mapReviewError(error);
    }
  });
  app.post(`${BASE}/:proposalId/edit-and-accept`, async (c) => {
    const id = uuid(c.req.param('proposalId'));
    const parsed = EditAndAcceptLearningProposalRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_LEARNING_PROPOSAL_ACTION_BYTES),
    );
    if (!parsed.success) throw invalid();
    try {
      const result = await dependencies.acceptLearningProposal.execute({
        proposalId: id,
        accessContext: getAuthenticatedAccessContext(c),
        editedContent: parsed.data.content,
      });
      return c.json(
        {
          learning_proposal: toResponse(result.proposal),
        },
        200,
      );
    } catch (error) {
      throw mapReviewError(error);
    }
  });
  app.post(`${BASE}/:proposalId/reject`, async (c) => {
    const id = uuid(c.req.param('proposalId'));
    const body = await readBoundedJson(
      c.req.raw,
      MAX_LEARNING_PROPOSAL_ACTION_BYTES,
    );
    if (!z.object({}).strict().safeParse(body).success) throw invalid();
    try {
      const proposal = await dependencies.rejectLearningProposal.execute({
        proposalId: id,
        accessContext: getAuthenticatedAccessContext(c),
      });
      return c.json({ learning_proposal: toResponse(proposal) }, 200);
    } catch (error) {
      throw mapReviewError(error);
    }
  });
}
function uuid(value: string): string {
  if (!z.uuid().safeParse(value).success)
    throw new HttpError(
      400,
      'invalid_request',
      'learning_proposal_id must be a valid UUID.',
    );
  return value;
}
function notFound(): HttpError {
  return new HttpError(
    404,
    'not_found',
    'The requested resource does not exist.',
  );
}
function invalid(): HttpError {
  return new HttpError(400, 'invalid_request', 'The request is invalid.');
}
function mapReviewError(error: unknown): HttpError | unknown {
  if (error instanceof LearningProposalNotFoundError) return notFound();
  if (error instanceof LearningProposalNotPendingError)
    return new HttpError(409, error.code, error.message);
  if (error instanceof MemoryPreconditionFailedError)
    return new HttpError(409, error.code, error.message);
  if (
    error instanceof Error &&
    error.message.includes('learning proposal content')
  )
    return invalid();
  return error;
}
function toResponse(p: LearningProposal) {
  return {
    learning_proposal_id: p.id,
    workspace_id: p.owner.workspaceId,
    source: {
      team_run_id: p.sourceTeamRunId,
      task_id: p.sourceTaskId,
      run_id: p.sourceRunId,
    },
    target: {
      memory_store_id: p.targetMemoryStoreId,
      memory_id: p.targetMemoryId,
      path: p.targetPath,
      base_content_sha256: p.baseContentSha256,
    },
    proposed_content: p.proposedContent,
    evidence_refs: p.evidenceRefs,
    status: p.status,
    accepted_memory_version_id: p.acceptedMemoryVersionId,
    reviewed_at: p.reviewedAt,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}
