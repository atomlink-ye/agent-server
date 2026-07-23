import { createHash, randomUUID } from 'node:crypto';
import type { FileStore } from '../ports/file-store.js';
import type { ServiceAccountAccessContext } from '../control-plane/access-context.js';
import type { WorkspaceMemoryEntry } from '../../domain/workspace-memory/memory-proposal.js';

export interface ManagedMemoryDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly Row[] }>;
}

export interface ManagedMemoryEntry {
  readonly entryId: string;
  readonly proposalId: string;
  readonly content: string;
  readonly category: string;
  readonly acceptedAt: string;
  readonly sourceTaskId: string | null;
  readonly sourceSessionId: string | null;
  readonly sourceMessageId: string | null;
  readonly sourceRunId: string | null;
  readonly sourceAgentVersionId: string | null;
  readonly sourceCandidateIndex: number | null;
}
export interface ManagedMemorySnapshot {
  readonly snapshotId: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly manifestHash: string;
  readonly projectionStatus: string;
  readonly createdAt: string;
  readonly entries: readonly ManagedMemoryEntry[];
}

export class ManagedMemory {
  public constructor(
    private readonly db: ManagedMemoryDatabase,
    private readonly fileStore: FileStore,
  ) {}

  public async acceptEntry(
    entry: WorkspaceMemoryEntry,
  ): Promise<ManagedMemorySnapshot> {
    const existing = await this.db.query<{ entry_id: string }>(
      'SELECT entry_id FROM workspace_memory_owned_entries WHERE proposal_id = $1',
      [entry.proposalId],
    );
    if (!existing.rows?.length)
      await this.db.query(
        `INSERT INTO workspace_memory_owned_entries (entry_id, proposal_id, tenant_id, workspace_id, content, content_hash, category, source_task_id, source_session_id, source_message_id, source_run_id, source_agent_version_id, source_candidate_index, proposer_snapshot, reviewer_snapshot, accepted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          entry.id,
          entry.proposalId,
          entry.tenantId,
          entry.workspaceId,
          entry.content,
          hash(entry.content),
          entry.category,
          entry.sourceTaskId,
          entry.sourceSessionId,
          entry.sourceMessageId ?? null,
          entry.sourceRunId ?? null,
          entry.sourceAgentVersionId ?? null,
          entry.sourceCandidateIndex ?? null,
          JSON.stringify(entry.proposerSnapshot),
          JSON.stringify(entry.reviewerSnapshot),
          entry.acceptedAt,
        ],
      );
    return this.rebuild({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
    });
  }

  public async listEntries(scope: {
    tenantId: string;
    workspaceId: string;
  }): Promise<readonly ManagedMemoryEntry[]> {
    const result = await this.db.query<any>(
      'SELECT entry_id, proposal_id, content, category, accepted_at, source_task_id, source_session_id, source_message_id, source_run_id, source_agent_version_id, source_candidate_index FROM workspace_memory_owned_entries WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY accepted_at ASC, entry_id ASC',
      [scope.tenantId, scope.workspaceId],
    );
    return (result.rows ?? []).map((row) => ({
      entryId: row.entry_id,
      proposalId: row.proposal_id,
      content: row.content,
      category: row.category,
      acceptedAt: new Date(row.accepted_at).toISOString(),
      sourceTaskId: row.source_task_id,
      sourceSessionId: row.source_session_id,
      sourceMessageId: row.source_message_id,
      sourceRunId: row.source_run_id,
      sourceAgentVersionId: row.source_agent_version_id,
      sourceCandidateIndex: row.source_candidate_index,
    }));
  }

  public async listSnapshots(scope: {
    tenantId: string;
    workspaceId: string;
  }): Promise<readonly ManagedMemorySnapshot[]> {
    const result = await this.db.query<any>(
      'SELECT snapshot_id, workspace_id, version, content_hash, manifest_hash, projection_status, created_at FROM workspace_memory_snapshots WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY version DESC',
      [scope.tenantId, scope.workspaceId],
    );
    return (result.rows ?? []).map(snapshotRow);
  }

  public async getSnapshot(
    scope: { tenantId: string; workspaceId: string },
    snapshotId: string,
  ): Promise<ManagedMemorySnapshot | null> {
    const result = await this.db.query<any>(
      'SELECT snapshot_id, workspace_id, version, content_hash, manifest_hash, projection_status, created_at FROM workspace_memory_snapshots WHERE tenant_id=$1 AND workspace_id=$2 AND snapshot_id=$3',
      [scope.tenantId, scope.workspaceId, snapshotId],
    );
    return result.rows?.[0] ? snapshotRow(result.rows[0]) : null;
  }

  public async rebuild(scope: {
    tenantId: string;
    workspaceId: string;
  }): Promise<ManagedMemorySnapshot> {
    const entries = await this.listEntries(scope);
    const memory = render(entries);
    const contentHash = hash(memory);
    const next = await this.db.query<{ version: number }>(
      'SELECT COALESCE(MAX(version),0)+1 AS version FROM workspace_memory_snapshots WHERE tenant_id=$1 AND workspace_id=$2',
      [scope.tenantId, scope.workspaceId],
    );
    const version = Number(next.rows?.[0]?.version ?? 1);
    const snapshotId = randomUUID();
    const manifest = JSON.stringify({
      format: 1,
      workspace_id: scope.workspaceId,
      version,
      content_hash: contentHash,
      entries,
    });
    const manifestHash = hash(manifest);
    await this.db.query(
      'INSERT INTO workspace_memory_snapshots (snapshot_id, tenant_id, workspace_id, version, content_hash, manifest_hash, projection_status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())',
      [
        snapshotId,
        scope.tenantId,
        scope.workspaceId,
        version,
        contentHash,
        manifestHash,
        'pending',
      ],
    );
    try {
      await this.fileStore.publish({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        snapshotId,
        memory,
        manifest,
        contentHash,
      });
      await this.db.query(
        'UPDATE workspace_memory_snapshots SET projection_status=$2 WHERE snapshot_id=$1',
        [snapshotId, 'ready'],
      );
    } catch (error) {
      await this.db.query(
        'UPDATE workspace_memory_snapshots SET projection_status=$2 WHERE snapshot_id=$1',
        [snapshotId, 'failed'],
      );
      throw error;
    }
    return {
      snapshotId,
      workspaceId: scope.workspaceId,
      version,
      contentHash,
      manifestHash,
      projectionStatus: 'ready',
      createdAt: new Date().toISOString(),
      entries,
    };
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function render(entries: readonly ManagedMemoryEntry[]): string {
  return entries
    .map((entry) => `## ${entry.category}\n\n${entry.content}\n`)
    .join('\n');
}
function snapshotRow(row: any): ManagedMemorySnapshot {
  return {
    snapshotId: row.snapshot_id,
    workspaceId: row.workspace_id,
    version: Number(row.version),
    contentHash: row.content_hash,
    manifestHash: row.manifest_hash,
    projectionStatus: row.projection_status,
    createdAt: new Date(row.created_at).toISOString(),
    entries: row.entries ?? [],
  };
}
export function managedScope(accessContext: ServiceAccountAccessContext) {
  return {
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
  };
}
