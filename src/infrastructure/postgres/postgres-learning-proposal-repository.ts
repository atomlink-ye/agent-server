import { MemoryPreconditionFailedError } from '../../application/ports/memory-api-repository.js';
import {
  LearningProposalNotFoundError,
  LearningProposalNotPendingError,
  type CreateLearningProposalInput,
  type LearningProposalOwnerScope,
  type LearningProposalRepository,
  type ReviewLearningProposalInput,
} from '../../application/ports/learning-proposal-repository.js';
import type {
  Memory,
  MemoryVersion,
} from '../../domain/memory-api/memory-api.js';
import {
  contentSizeBytes,
  sha256,
} from '../../domain/memory-api/memory-api.js';
import type { LearningProposal } from '../../domain/learning/learning-proposal.js';

interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly T[]; rowCount?: number | null }>;
}
interface Client extends Queryable {
  release?: () => void;
}
type Database = Queryable | (Queryable & { connect(): Promise<Client> });
type ProposalRow = Record<string, any>;
type MemoryRow = Record<string, any>;

export class PostgresLearningProposalRepository implements LearningProposalRepository {
  public constructor(private readonly database: Database) {}
  public async createProposal(
    proposal: CreateLearningProposalInput,
  ): Promise<LearningProposal | null> {
    const row = await this.database.query<ProposalRow>(
      `INSERT INTO learning_proposals (id,tenant_id,workspace_id,principal_type,principal_id,source_team_run_id,source_task_id,source_run_id,target_memory_store_id,target_memory_id,target_path,base_content_sha256,proposed_content,evidence_refs,status,accepted_memory_version_id,created_at,updated_at)
      SELECT $1,$2,$3,$4,$5,tr.id,t.id,r.id,m.memory_store_id,m.id,m.path,$12,$13,$14,'pending',NULL,$15,$15
      FROM team_runs tr JOIN tasks t ON t.id=$7 JOIN runs r ON r.id=$8
      JOIN memories m ON m.id=$10 JOIN memory_stores s ON s.id=m.memory_store_id
      WHERE tr.id=$6 AND t.id=$7 AND r.id=$8 AND t.root_task_id=tr.root_task_id AND r.task_id=t.id AND tr.tenant_id=$2 AND tr.workspace_id::uuid=$3 AND tr.principal_type=$4 AND tr.principal_id=$5
        AND t.tenant_id=$2 AND s.id=$9 AND s.tenant_id=$2 AND s.workspace_id=$3 AND s.principal_type=$4 AND s.principal_id=$5 AND m.path=$11
      RETURNING *`,
      [
        proposal.id,
        proposal.owner.tenantId,
        proposal.owner.workspaceId,
        proposal.owner.principalType,
        proposal.owner.principalId,
        proposal.sourceTeamRunId,
        proposal.sourceTaskId,
        proposal.sourceRunId,
        proposal.targetMemoryStoreId,
        proposal.targetMemoryId,
        proposal.targetPath,
        proposal.baseContentSha256,
        proposal.proposedContent,
        JSON.stringify(proposal.evidenceRefs),
        proposal.createdAt,
      ],
    );
    return row.rows?.[0] ? mapProposal(row.rows[0]) : null;
  }
  public async listProposals(
    owner: LearningProposalOwnerScope,
  ): Promise<readonly LearningProposal[]> {
    const result = await this.database.query<ProposalRow>(
      `${SELECT_SQL} WHERE tenant_id=$1 AND workspace_id=$2 AND principal_type=$3 AND principal_id=$4 ORDER BY created_at DESC, id DESC LIMIT 100`,
      [
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    return (result.rows ?? []).map(mapProposal);
  }
  public async getProposal(
    id: string,
    owner: LearningProposalOwnerScope,
  ): Promise<LearningProposal | null> {
    const result = await this.database.query<ProposalRow>(
      `${SELECT_SQL} WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5`,
      [
        id,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    return result.rows?.[0] ? mapProposal(result.rows[0]) : null;
  }
  public async acceptProposal(
    input: ReviewLearningProposalInput,
  ): Promise<{ proposal: LearningProposal; memory: Memory }> {
    const client = await this.client();
    await client.query('BEGIN');
    try {
      const proposalResult = await client.query<ProposalRow>(
        `${SELECT_SQL} WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5 FOR UPDATE`,
        [
          input.proposalId,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
        ],
      );
      const proposal = proposalResult.rows?.[0]
        ? mapProposal(proposalResult.rows[0])
        : null;
      if (!proposal)
        throw new LearningProposalNotFoundError(
          'The requested learning proposal does not exist.',
        );
      if (proposal.status !== 'pending')
        throw new LearningProposalNotPendingError(
          'The learning proposal is not pending.',
        );
      const memoryResult = await client.query<MemoryRow>(
        `${MEMORY_SQL} WHERE m.id=$1 AND m.memory_store_id=$2 AND m.path=$3 AND s.tenant_id=$4 AND s.workspace_id=$5 AND s.principal_type=$6 AND s.principal_id=$7 FOR UPDATE OF m, v`,
        [
          proposal.targetMemoryId,
          proposal.targetMemoryStoreId,
          proposal.targetPath,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
        ],
      );
      const current = memoryResult.rows?.[0];
      if (!current)
        throw new LearningProposalNotFoundError(
          'The requested learning proposal target does not exist.',
        );
      if (current.content_sha256 !== proposal.baseContentSha256)
        throw new MemoryPreconditionFailedError();
      const content = input.editedContent ?? proposal.proposedContent;
      let acceptedVersionId = current.memory_version_id;
      if (current.content_sha256 !== sha256(content)) {
        await client.query(
          `INSERT INTO memory_versions (id,memory_id,version,content,content_sha256,content_size_bytes,operation,previous_version_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,'modified',$7,$8)`,
          [
            input.versionId,
            current.memory_id,
            Number(current.version) + 1,
            content,
            sha256(content),
            contentSizeBytes(content),
            current.memory_version_id,
            input.now,
          ],
        );
        await client.query(
          'UPDATE memories SET current_version_id=$1, updated_at=$2 WHERE id=$3',
          [input.versionId, input.now, current.memory_id],
        );
        acceptedVersionId = input.versionId;
      }
      const update = await client.query(
        "UPDATE learning_proposals SET status='accepted', accepted_memory_version_id=$2, reviewed_at=$3, updated_at=$3 WHERE id=$1 AND status='pending'",
        [proposal.id, acceptedVersionId, input.now],
      );
      if (update.rowCount !== 1) throw new LearningProposalNotPendingError();
      const updatedProposal = await client.query<ProposalRow>(
        `${SELECT_SQL} WHERE id=$1`,
        [proposal.id],
      );
      const updatedMemory = await client.query<MemoryRow>(
        `${MEMORY_SQL} WHERE m.id=$1`,
        [current.memory_id],
      );
      await client.query('COMMIT');
      return {
        proposal: mapProposal(updatedProposal.rows![0]!),
        memory: mapMemory(updatedMemory.rows![0]!),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  }
  public async rejectProposal(input: {
    proposalId: string;
    owner: LearningProposalOwnerScope;
    now: string;
  }): Promise<LearningProposal> {
    const client = await this.client();
    await client.query('BEGIN');
    try {
      const result = await client.query<ProposalRow>(
        `${SELECT_SQL} WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5 FOR UPDATE`,
        [
          input.proposalId,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
        ],
      );
      const proposal = result.rows?.[0] ? mapProposal(result.rows[0]) : null;
      if (!proposal)
        throw new LearningProposalNotFoundError(
          'The requested learning proposal does not exist.',
        );
      if (proposal.status !== 'pending')
        throw new LearningProposalNotPendingError(
          'The learning proposal is not pending.',
        );
      const update = await client.query(
        "UPDATE learning_proposals SET status='rejected', reviewed_at=$2, updated_at=$2 WHERE id=$1 AND status='pending'",
        [proposal.id, input.now],
      );
      if (update.rowCount !== 1) throw new LearningProposalNotPendingError();
      const updated = await client.query<ProposalRow>(
        `${SELECT_SQL} WHERE id=$1`,
        [proposal.id],
      );
      await client.query('COMMIT');
      return mapProposal(updated.rows![0]!);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  }
  private async client(): Promise<Client> {
    return 'connect' in this.database ? this.database.connect() : this.database;
  }
}

const SELECT_SQL = `SELECT id,tenant_id,workspace_id,principal_type,principal_id,source_team_run_id,source_task_id,source_run_id,target_memory_store_id,target_memory_id,target_path,base_content_sha256,proposed_content,evidence_refs,status,accepted_memory_version_id,reviewed_at,created_at,updated_at FROM learning_proposals`;
const MEMORY_SQL = `SELECT m.id AS memory_id,m.memory_store_id,m.path,m.created_at AS memory_created_at,m.updated_at AS memory_updated_at,v.id AS memory_version_id,v.version,v.content,v.content_sha256,v.content_size_bytes,v.operation,v.previous_version_id,v.created_at AS version_created_at FROM memories m JOIN memory_versions v ON v.id=m.current_version_id AND v.memory_id=m.id JOIN memory_stores s ON s.id=m.memory_store_id`;
function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
function mapProposal(row: ProposalRow): LearningProposal {
  return {
    id: row.id,
    owner: {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalType: row.principal_type,
      principalId: row.principal_id,
    },
    sourceTeamRunId: row.source_team_run_id,
    sourceTaskId: row.source_task_id,
    sourceRunId: row.source_run_id,
    targetMemoryStoreId: row.target_memory_store_id,
    targetMemoryId: row.target_memory_id,
    targetPath: row.target_path,
    baseContentSha256: row.base_content_sha256,
    proposedContent: row.proposed_content,
    evidenceRefs:
      typeof row.evidence_refs === 'string'
        ? JSON.parse(row.evidence_refs)
        : row.evidence_refs,
    status: row.status,
    acceptedMemoryVersionId: row.accepted_memory_version_id,
    reviewedAt: row.reviewed_at ? iso(row.reviewed_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapMemory(row: MemoryRow): Memory {
  const current: MemoryVersion = {
    id: row.memory_version_id,
    memoryId: row.memory_id,
    version: Number(row.version),
    content: row.content,
    contentSha256: row.content_sha256,
    contentSizeBytes: Number(row.content_size_bytes),
    operation: row.operation,
    previousVersionId: row.previous_version_id,
    createdAt: iso(row.version_created_at),
  };
  return {
    id: row.memory_id,
    storeId: row.memory_store_id,
    path: row.path,
    current,
    createdAt: iso(row.memory_created_at),
    updatedAt: iso(row.memory_updated_at),
  };
}
