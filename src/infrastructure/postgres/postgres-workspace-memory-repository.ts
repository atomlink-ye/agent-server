import type {
  ReviewMemoryProposalRepositoryInput,
  ReviewMemoryProposalRepositoryResult,
  WorkspaceMemoryRepository,
  WorkspaceMemoryRepositoryOwnerScope,
} from '../../application/ports/workspace-memory-repository.js';
import {
  createWorkspaceMemoryEntryFromAcceptedProposal,
  rehydrateMemoryProposal,
  rehydrateWorkspaceMemoryEntry,
  reviewMemoryProposal,
  type MemoryProposal,
  type MemoryProposalSnapshot,
  type WorkspaceMemoryActorSnapshot,
  type WorkspaceMemoryEntry,
  type WorkspaceMemoryEntrySnapshot,
} from '../../domain/workspace-memory/memory-proposal.js';
import { memoryReviewDecisionFingerprint } from '../../domain/workspace-memory/memory-review-fingerprint.js';

interface PostgresQueryResult<Row> {
  readonly rows?: readonly Row[];
  readonly rowCount?: number | null;
}

interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
}

interface PostgresConnectable {
  connect(): Promise<PostgresTransactionalClient>;
}

interface PostgresTransactionalClient extends PostgresQueryable {
  release?(): void;
}

interface MemoryProposalRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly original_content: string;
  readonly original_category: string;
  readonly source_task_id: string | null;
  readonly source_session_id: string | null;
  readonly source_message_id: string | null;
  readonly source_run_id: string | null;
  readonly source_agent_version_id: string | null;
  readonly source_candidate_index: number | null;
  readonly proposer_snapshot: WorkspaceMemoryActorSnapshot | string;
  readonly status: MemoryProposal['status'];
  readonly review_outcome: MemoryProposal['reviewOutcome'];
  readonly reviewed_content: string | null;
  readonly reviewer_snapshot: WorkspaceMemoryActorSnapshot | string | null;
  readonly reviewed_at: string | Date | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly review_controller_ingress_id?: string | null;
  readonly review_decision_sha256?: string | null;
}

interface WorkspaceMemoryEntryRow {
  readonly id: string;
  readonly proposal_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly content: string;
  readonly category: string;
  readonly source_task_id: string | null;
  readonly source_session_id: string | null;
  readonly source_message_id: string | null;
  readonly source_run_id: string | null;
  readonly source_agent_version_id: string | null;
  readonly source_candidate_index: number | null;
  readonly proposer_snapshot: WorkspaceMemoryActorSnapshot | string;
  readonly reviewer_snapshot: WorkspaceMemoryActorSnapshot | string;
  readonly review_outcome: WorkspaceMemoryEntry['reviewOutcome'];
  readonly accepted_at: string | Date;
}

export class PostgresWorkspaceMemoryRepository implements WorkspaceMemoryRepository {
  public constructor(
    private readonly database: PostgresQueryable | PostgresConnectable,
  ) {}

  public async createProposal(
    proposal: MemoryProposal,
  ): Promise<MemoryProposal> {
    await this.queryable.query(
      `
        INSERT INTO workspace_memory_proposals (
          id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          original_content,
          original_category,
          source_message_id, source_run_id, source_agent_version_id, source_candidate_index,
          source_task_id,
          source_session_id,
          proposer_snapshot,
          status,
          review_outcome,
          reviewed_content,
          reviewer_snapshot,
          reviewed_at,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )
      `,
      proposalValues(proposal),
    );

    return proposal;
  }

  public async createProposalsBatch(
    proposals: readonly MemoryProposal[],
  ): Promise<readonly MemoryProposal[]> {
    const client = await this.acquireClient();
    await client.query('BEGIN');
    try {
      const materialized: MemoryProposal[] = [];
      for (const proposal of proposals) {
        const replayable =
          proposal.sourceRunId !== null &&
          proposal.sourceRunId !== undefined &&
          proposal.sourceCandidateIndex !== null &&
          proposal.sourceCandidateIndex !== undefined;
        await client.query<MemoryProposalRow>(
          `INSERT INTO workspace_memory_proposals (id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_message_id, source_run_id, source_agent_version_id, source_candidate_index, source_task_id, source_session_id, proposer_snapshot, status, review_outcome, reviewed_content, reviewer_snapshot, reviewed_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT (source_run_id, source_candidate_index) WHERE source_run_id IS NOT NULL AND source_candidate_index IS NOT NULL DO NOTHING`,
          proposalValues(proposal),
        );
        if (!replayable) {
          materialized.push(proposal);
          continue;
        }
        const existing = await selectProposalByReplayKey(
          client,
          proposal.sourceRunId!,
          proposal.sourceCandidateIndex!,
        );
        if (existing) materialized.push(existing);
        else materialized.push(proposal);
      }
      await client.query('COMMIT');
      return materialized;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  public async findProposalByIdForOwner(
    proposalId: string,
    ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  ): Promise<MemoryProposal | null> {
    const result = await this.queryable.query<MemoryProposalRow>(
      `${MEMORY_PROPOSAL_SELECT_SQL}
        WHERE id = $1
          AND tenant_id = $2
          AND workspace_id = $3
          AND principal_type = $4
          AND principal_id = $5
          AND (source_run_id IS NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.id = source_run_id AND r.status = 'succeeded'))
      `,
      [
        proposalId,
        ownerScope.tenantId,
        ownerScope.workspaceId,
        ownerScope.principalType,
        ownerScope.principalId,
      ],
    );

    const row = result.rows?.[0];
    return row ? mapProposalRow(row) : null;
  }

  public async findProposalByIdForActor(
    proposalId: string,
    actorScope: {
      tenantId: string;
      principalType: string;
      principalId: string;
    },
  ): Promise<MemoryProposal | null> {
    const result = await this.queryable.query<MemoryProposalRow>(
      `${MEMORY_PROPOSAL_SELECT_SQL}
        WHERE id = $1
          AND tenant_id = $2
          AND principal_type = $3
          AND principal_id = $4
          AND (source_run_id IS NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.id = source_run_id AND r.status = 'succeeded'))
      `,
      [
        proposalId,
        actorScope.tenantId,
        actorScope.principalType,
        actorScope.principalId,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapProposalRow(row) : null;
  }

  public async listProposalsByOwnerScope(
    ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  ): Promise<readonly MemoryProposal[]> {
    const result = await this.queryable.query<MemoryProposalRow>(
      `${MEMORY_PROPOSAL_SELECT_SQL}
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND principal_type = $3
          AND principal_id = $4
          AND (source_run_id IS NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.id = source_run_id AND r.status = 'succeeded'))
        ORDER BY created_at DESC, internal_order DESC
      `,
      [
        ownerScope.tenantId,
        ownerScope.workspaceId,
        ownerScope.principalType,
        ownerScope.principalId,
      ],
    );

    return (result.rows ?? []).map(mapProposalRow);
  }

  public async listPendingProposalsBySourceRunForOwner(
    sourceRunId: string,
    ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  ): Promise<readonly MemoryProposal[]> {
    const result = await this.queryable.query<MemoryProposalRow>(
      `${MEMORY_PROPOSAL_SELECT_SQL}
        WHERE source_run_id = $1
          AND status = 'pending'
          AND tenant_id = $2
          AND workspace_id = $3
          AND principal_type = $4
          AND principal_id = $5
          AND EXISTS (SELECT 1 FROM runs r WHERE r.id = source_run_id AND r.status = 'succeeded')
        ORDER BY created_at, internal_order
      `,
      [
        sourceRunId,
        ownerScope.tenantId,
        ownerScope.workspaceId,
        ownerScope.principalType,
        ownerScope.principalId,
      ],
    );
    return (result.rows ?? []).map(mapProposalRow);
  }

  public async reviewProposal(
    input: ReviewMemoryProposalRepositoryInput,
  ): Promise<ReviewMemoryProposalRepositoryResult> {
    const client = await this.acquireClient();

    await client.query('BEGIN');

    try {
      const proposal = await selectProposalByIdForOwner(
        client,
        input.proposalId,
        input.ownerScope,
        true,
      );
      if (!proposal) {
        throw new Error('Workspace memory proposal not found for owner scope');
      }

      let controllerId: string | null = null;
      let decisionFingerprint: string | null = null;
      if (input.controller) {
        const controller = await client.query<{ kind: string }>(
          'SELECT kind FROM channel_ingress_events WHERE id = $1 FOR UPDATE',
          [input.controller.ingressId],
        );
        if (
          !controller.rows?.[0] ||
          !['card_action', 'command'].includes(controller.rows[0].kind)
        )
          throw new Error('review_controller_not_found');
        controllerId = input.controller.ingressId;
        decisionFingerprint = memoryReviewDecisionFingerprint({
          action: input.outcome,
          content: input.reviewedContent ?? null,
        });
        const controllerState = await client.query<{
          review_controller_ingress_id: string | null;
          review_decision_sha256: string | null;
        }>(
          'SELECT review_controller_ingress_id, review_decision_sha256 FROM workspace_memory_proposals WHERE id = $1 FOR UPDATE',
          [input.proposalId],
        );
        const state = controllerState.rows?.[0];
        if (proposal.status !== 'pending') {
          const exact =
            state?.review_controller_ingress_id === controllerId &&
            state.review_decision_sha256 === decisionFingerprint &&
            proposal.reviewOutcome === input.outcome &&
            proposal.reviewedContent === (input.reviewedContent ?? null);
          if (!exact) throw new Error('review_controller_conflict');
          if (proposal.status === 'rejected') {
            await client.query('COMMIT');
            return { proposal, entry: null, replayed: true };
          }
          const existingEntry = await client.query<WorkspaceMemoryEntryRow>(
            `${WORKSPACE_MEMORY_ENTRY_SELECT_SQL} WHERE proposal_id = $1 FOR SHARE`,
            [input.proposalId],
          );
          if (!existingEntry.rows?.[0])
            throw new Error('review_replay_missing_entry');
          await client.query('COMMIT');
          return {
            proposal,
            entry: mapEntryRow(existingEntry.rows[0]),
            replayed: true,
          };
        }
      }

      const reviewedProposal = reviewMemoryProposal(proposal, {
        outcome: input.outcome,
        reviewedContent: input.reviewedContent ?? null,
        reviewerSnapshot: input.reviewerSnapshot,
        ...(input.now ? { now: input.now } : {}),
      });

      await updateReviewedProposal(
        client,
        reviewedProposal,
        controllerId,
        decisionFingerprint,
      );

      const entry =
        reviewedProposal.status === 'accepted'
          ? createWorkspaceMemoryEntryFromAcceptedProposal(reviewedProposal, {
              ...(input.entryIdFactory ? { id: input.entryIdFactory() } : {}),
            })
          : null;

      if (entry) {
        await insertAcceptedEntry(client, entry);
      }

      await client.query('COMMIT');
      return { proposal: reviewedProposal, entry };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  public async listAcceptedEntriesByOwnerScope(
    ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  ): Promise<readonly WorkspaceMemoryEntry[]> {
    const result = await this.queryable.query<WorkspaceMemoryEntryRow>(
      `${WORKSPACE_MEMORY_ENTRY_SELECT_SQL}
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND principal_type = $3
          AND principal_id = $4
          AND (source_run_id IS NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.id = source_run_id AND r.status = 'succeeded'))
        ORDER BY accepted_at DESC, internal_order DESC
      `,
      [
        ownerScope.tenantId,
        ownerScope.workspaceId,
        ownerScope.principalType,
        ownerScope.principalId,
      ],
    );

    return (result.rows ?? []).map(mapEntryRow);
  }

  public async findAcceptedEntryByProposalForOwner(
    proposalId: string,
    ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  ): Promise<WorkspaceMemoryEntry | null> {
    const result = await this.queryable.query<WorkspaceMemoryEntryRow>(
      `${WORKSPACE_MEMORY_ENTRY_SELECT_SQL}
        WHERE proposal_id = $1
          AND tenant_id = $2
          AND workspace_id = $3
          AND principal_type = $4
          AND principal_id = $5
          AND (source_run_id IS NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.id = source_run_id AND r.status = 'succeeded'))
      `,
      [
        proposalId,
        ownerScope.tenantId,
        ownerScope.workspaceId,
        ownerScope.principalType,
        ownerScope.principalId,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapEntryRow(row) : null;
  }

  private get queryable(): PostgresQueryable {
    return this.database as PostgresQueryable;
  }

  private async acquireClient(): Promise<PostgresTransactionalClient> {
    if ('connect' in this.database) {
      return this.database.connect();
    }

    return this.database;
  }
}

const MEMORY_PROPOSAL_SELECT_SQL = `
  SELECT
    id,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    original_content,
    original_category,
    source_task_id,
    source_session_id,
    source_message_id,
    source_run_id,
    source_agent_version_id,
    source_candidate_index,
    proposer_snapshot,
    status,
    review_outcome,
    reviewed_content,
    reviewer_snapshot,
    reviewed_at,
    created_at,
    updated_at
  FROM workspace_memory_proposals
`;

const WORKSPACE_MEMORY_ENTRY_SELECT_SQL = `
  SELECT
    id,
    proposal_id,
    tenant_id,
    workspace_id,
    principal_type,
    principal_id,
    content,
    category,
    source_task_id,
    source_session_id,
    source_message_id,
    source_run_id,
    source_agent_version_id,
    source_candidate_index,
    proposer_snapshot,
    reviewer_snapshot,
    review_outcome,
    accepted_at
  FROM workspace_memory_entries
`;

async function selectProposalByIdForOwner(
  database: PostgresQueryable,
  proposalId: string,
  ownerScope: WorkspaceMemoryRepositoryOwnerScope,
  forUpdate: boolean,
): Promise<MemoryProposal | null> {
  const result = await database.query<MemoryProposalRow>(
    `${MEMORY_PROPOSAL_SELECT_SQL}
      WHERE id = $1
        AND tenant_id = $2
        AND workspace_id = $3
        AND principal_type = $4
        AND principal_id = $5
        AND (source_run_id IS NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.id = source_run_id AND r.status = 'succeeded'))
      ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [
      proposalId,
      ownerScope.tenantId,
      ownerScope.workspaceId,
      ownerScope.principalType,
      ownerScope.principalId,
    ],
  );

  const row = result.rows?.[0];
  return row ? mapProposalRow(row) : null;
}

async function selectProposalByReplayKey(
  database: PostgresQueryable,
  sourceRunId: string,
  sourceCandidateIndex: number,
): Promise<MemoryProposal | null> {
  const result = await database.query<MemoryProposalRow>(
    `${MEMORY_PROPOSAL_SELECT_SQL} WHERE source_run_id = $1 AND source_candidate_index = $2`,
    [sourceRunId, sourceCandidateIndex],
  );
  const row = result.rows?.[0];
  return row ? mapProposalRow(row) : null;
}

async function updateReviewedProposal(
  database: PostgresQueryable,
  proposal: MemoryProposal,
  controllerId: string | null = null,
  decisionFingerprint: string | null = null,
): Promise<void> {
  await database.query(
    `
      UPDATE workspace_memory_proposals
      SET
        status = $2,
        review_outcome = $3,
        reviewed_content = $4,
        reviewer_snapshot = $5,
        reviewed_at = $6,
        updated_at = $7,
        review_controller_ingress_id = $8,
        review_decision_sha256 = $9
      WHERE id = $1
    `,
    [
      proposal.id,
      proposal.status,
      proposal.reviewOutcome,
      proposal.reviewedContent,
      JSON.stringify(proposal.reviewerSnapshot),
      proposal.reviewedAt,
      proposal.updatedAt,
      controllerId,
      decisionFingerprint,
    ],
  );
}

async function insertAcceptedEntry(
  database: PostgresQueryable,
  entry: WorkspaceMemoryEntry,
): Promise<void> {
  await database.query(
    `
      INSERT INTO workspace_memory_entries (
        id,
        proposal_id,
        tenant_id,
        workspace_id,
        principal_type,
        principal_id,
        content,
        category,
        source_task_id,
        source_session_id,
        source_message_id,
        source_run_id,
        source_agent_version_id,
        source_candidate_index,
        proposer_snapshot,
        reviewer_snapshot,
        review_outcome,
        accepted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
    `,
    [
      entry.id,
      entry.proposalId,
      entry.tenantId,
      entry.workspaceId,
      entry.principalType,
      entry.principalId,
      entry.content,
      entry.category,
      entry.sourceTaskId,
      entry.sourceSessionId,
      entry.sourceMessageId ?? null,
      entry.sourceRunId ?? null,
      entry.sourceAgentVersionId ?? null,
      entry.sourceCandidateIndex ?? null,
      JSON.stringify(entry.proposerSnapshot),
      JSON.stringify(entry.reviewerSnapshot),
      entry.reviewOutcome,
      entry.acceptedAt,
    ],
  );
}

function proposalValues(proposal: MemoryProposal): readonly unknown[] {
  return [
    proposal.id,
    proposal.tenantId,
    proposal.workspaceId,
    proposal.principalType,
    proposal.principalId,
    proposal.originalContent,
    proposal.originalCategory,
    proposal.sourceMessageId ?? null,
    proposal.sourceRunId ?? null,
    proposal.sourceAgentVersionId ?? null,
    proposal.sourceCandidateIndex ?? null,
    proposal.sourceTaskId,
    proposal.sourceSessionId,
    JSON.stringify(proposal.proposerSnapshot),
    proposal.status,
    proposal.reviewOutcome,
    proposal.reviewedContent,
    proposal.reviewerSnapshot
      ? JSON.stringify(proposal.reviewerSnapshot)
      : null,
    proposal.reviewedAt,
    proposal.createdAt,
    proposal.updatedAt,
  ];
}

function mapProposalRow(row: MemoryProposalRow): MemoryProposal {
  const snapshot: MemoryProposalSnapshot = {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    originalContent: row.original_content,
    originalCategory: row.original_category,
    sourceTaskId: row.source_task_id,
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    sourceRunId: row.source_run_id,
    sourceAgentVersionId: row.source_agent_version_id,
    sourceCandidateIndex: row.source_candidate_index,
    proposerSnapshot: parseJson(row.proposer_snapshot),
    status: row.status,
    reviewOutcome: row.review_outcome,
    reviewedContent: row.reviewed_content,
    reviewerSnapshot: row.reviewer_snapshot
      ? parseJson(row.reviewer_snapshot)
      : null,
    reviewedAt: row.reviewed_at ? toIsoInstant(row.reviewed_at) : null,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
  };

  return rehydrateMemoryProposal(snapshot);
}

function mapEntryRow(row: WorkspaceMemoryEntryRow): WorkspaceMemoryEntry {
  const snapshot: WorkspaceMemoryEntrySnapshot = {
    id: row.id,
    proposalId: row.proposal_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    content: row.content,
    category: row.category,
    sourceTaskId: row.source_task_id,
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    sourceRunId: row.source_run_id,
    sourceAgentVersionId: row.source_agent_version_id,
    sourceCandidateIndex: row.source_candidate_index,
    proposerSnapshot: parseJson(row.proposer_snapshot),
    reviewerSnapshot: parseJson(row.reviewer_snapshot),
    reviewOutcome: row.review_outcome,
    acceptedAt: toIsoInstant(row.accepted_at),
  };

  return rehydrateWorkspaceMemoryEntry(snapshot);
}

function parseJson<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function toIsoInstant(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
