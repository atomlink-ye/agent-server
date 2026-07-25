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
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
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
  private transactionTail: Promise<void> = Promise.resolve();
  private readonly ownerFactory: () => string;
  public constructor(
    private readonly db: ManagedMemoryDatabase,
    private readonly fileStore: FileStore,
    ownerFactory: () => string = randomUUID,
  ) {
    this.ownerFactory = ownerFactory;
  }

  public async acceptEntry(
    entry: WorkspaceMemoryEntry,
  ): Promise<ManagedMemorySnapshot> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await this.acceptEntryOnce(entry);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !isProjectionContention(error) ||
          attempt === 9
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error('memory projection claim unavailable');
  }

  private async acceptEntryOnce(
    entry: WorkspaceMemoryEntry,
  ): Promise<ManagedMemorySnapshot> {
    const prepared = await this.prepareReceipt(entry);
    if (prepared.ready) return prepared.snapshot;
    try {
      await this.fileStore.publish(prepared.file);
      await this.fileStore.readVerified({
        tenantId: prepared.file.tenantId,
        workspaceId: prepared.file.workspaceId,
        snapshotId: prepared.file.snapshotId,
        expectedContentHash: prepared.file.contentHash,
      });
      await this.finishReceipt(
        prepared.snapshot.snapshotId,
        'ready',
        undefined,
        prepared.owner,
        prepared.attempt,
      );
    } catch (error) {
      await this.finishReceipt(
        prepared.snapshot.snapshotId,
        'failed',
        safeError(error),
        prepared.owner,
        prepared.attempt,
      );
      throw error;
    }
    return { ...prepared.snapshot, projectionStatus: 'ready' };
  }

  private async prepareReceipt(entry: WorkspaceMemoryEntry): Promise<{
    readonly snapshot: ManagedMemorySnapshot;
    readonly file: {
      tenantId: string;
      workspaceId: string;
      snapshotId: string;
      memory: string;
      manifest: string;
      contentHash: string;
    };
    readonly ready: boolean;
    readonly owner: string;
    readonly attempt: number;
  }> {
    return this.transaction(async (db) => {
      const owner = this.ownerFactory();
      const nextVersion = await ensureProjectionScope(
        db,
        entry.tenantId,
        entry.workspaceId,
      );
      const receipt = await db.query<any>(
        'SELECT * FROM workspace_memory_projection_receipts WHERE proposal_id=$1 FOR UPDATE',
        [entry.proposalId],
      );
      const canonical = await db.query<any>(
        'SELECT * FROM workspace_memory_entries WHERE id=$1 AND proposal_id=$2 AND tenant_id=$3 AND workspace_id=$4 AND principal_type=$5 AND principal_id=$6 FOR UPDATE',
        [
          entry.id,
          entry.proposalId,
          entry.tenantId,
          entry.workspaceId,
          entry.principalType,
          entry.principalId,
        ],
      );
      const canonicalRow = canonical.rows?.[0];
      if (!canonicalRow || !canonicalEntryMatches(canonicalRow, entry))
        throw new Error('memory projection canonical entry conflict');
      const proposal = await db.query<{ status: string }>(
        'SELECT status FROM workspace_memory_proposals WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5',
        [
          entry.proposalId,
          entry.tenantId,
          entry.workspaceId,
          entry.principalType,
          entry.principalId,
        ],
      );
      if (proposal.rows?.[0]?.status !== 'accepted')
        throw new Error('memory projection proposal is not accepted');
      if (!receipt.rows?.[0]) {
        await db.query(
          `INSERT INTO workspace_memory_owned_entries (entry_id, proposal_id, tenant_id, workspace_id, principal_type, principal_id, content, content_hash, category, source_task_id, source_session_id, source_message_id, source_run_id, source_agent_version_id, source_candidate_index, proposer_snapshot, reviewer_snapshot, accepted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (proposal_id) DO NOTHING`,
          [
            canonicalRow.id,
            canonicalRow.proposal_id,
            canonicalRow.tenant_id,
            canonicalRow.workspace_id,
            canonicalRow.principal_type,
            canonicalRow.principal_id,
            canonicalRow.content,
            hash(canonicalRow.content),
            canonicalRow.category,
            canonicalRow.source_task_id,
            canonicalRow.source_session_id,
            canonicalRow.source_message_id ?? null,
            canonicalRow.source_run_id ?? null,
            canonicalRow.source_agent_version_id ?? null,
            canonicalRow.source_candidate_index ?? null,
            JSON.stringify(canonicalRow.proposer_snapshot),
            JSON.stringify(canonicalRow.reviewer_snapshot),
            canonicalRow.accepted_at,
          ],
        );
      }
      const owned = await db.query<any>(
        'SELECT * FROM workspace_memory_owned_entries WHERE entry_id=$1 AND proposal_id=$2 AND tenant_id=$3 AND workspace_id=$4 AND principal_type=$5 AND principal_id=$6 FOR UPDATE',
        [
          entry.id,
          entry.proposalId,
          entry.tenantId,
          entry.workspaceId,
          entry.principalType,
          entry.principalId,
        ],
      );
      const ownedRow = owned.rows?.[0];
      if (!ownedRow || !canonicalEntryMatches(ownedRow, entry))
        throw new Error('memory projection owned entry conflict');
      const row = receipt.rows?.[0];
      let snapshotId: string;
      let version: number;
      if (row) {
        snapshotId = row.snapshot_id;
        const snapshot = await this.snapshotWithEntries(db, snapshotId);
        if (row.state === 'ready')
          return {
            snapshot,
            file: fileFor(snapshot, entry.tenantId),
            ready: true,
            owner,
            attempt: Number(row.attempt_count),
          };
        const leaseActive =
          row.state === 'publishing' &&
          row.lease_expires_at &&
          Date.parse(String(row.lease_expires_at)) > Date.now();
        if (leaseActive && row.lease_owner !== owner)
          throw new Error('memory projection claim unavailable');
        version = snapshot.version;
      } else {
        version = nextVersion;
        snapshotId = randomUUID();
        await db.query(
          'UPDATE workspace_memory_projection_scopes SET next_version=$3 WHERE tenant_id=$1 AND workspace_id=$2',
          [entry.tenantId, entry.workspaceId, version + 1],
        );
        const entries = await this.listEntriesWith(
          db,
          entry.tenantId,
          entry.workspaceId,
        );
        const memory = render(entries);
        const contentHash = hash(memory);
        const manifest = JSON.stringify({
          format: 1,
          workspace_id: entry.workspaceId,
          version,
          content_hash: contentHash,
          entries,
        });
        await db.query(
          "INSERT INTO workspace_memory_snapshots (snapshot_id,tenant_id,workspace_id,version,content_hash,manifest_hash,projection_status) VALUES ($1,$2,$3,$4,$5,$6,'pending')",
          [
            snapshotId,
            entry.tenantId,
            entry.workspaceId,
            version,
            contentHash,
            hash(manifest),
          ],
        );
        for (const [ordinal, member] of entries.entries())
          await db.query(
            'INSERT INTO workspace_memory_snapshot_entries (snapshot_id,tenant_id,workspace_id,principal_type,principal_id,entry_id,ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [
              snapshotId,
              entry.tenantId,
              entry.workspaceId,
              member.principalType,
              member.principalId,
              member.entryId,
              ordinal,
            ],
          );
        await db.query(
          "INSERT INTO workspace_memory_projection_receipts (proposal_id,entry_id,snapshot_id,tenant_id,workspace_id,principal_type,principal_id,state,lease_owner,lease_expires_at,attempt_count) VALUES ($1,$2,$3,$4,$5,$6,$7,'publishing',$8,now()+interval '5 minutes',1)",
          [
            entry.proposalId,
            entry.id,
            snapshotId,
            entry.tenantId,
            entry.workspaceId,
            entry.principalType,
            entry.principalId,
            owner,
          ],
        );
      }
      const attempt = row ? Number(row.attempt_count) + 1 : 1;
      if (row) {
        const claimed = await db.query<any>(
          "UPDATE workspace_memory_projection_receipts SET state='publishing', lease_owner=$2, lease_expires_at=now()+interval '5 minutes', attempt_count=$3, safe_error_code=NULL, updated_at=now() WHERE proposal_id=$1 AND (state IN ('pending','failed') OR (state='publishing' AND lease_expires_at <= now())) RETURNING proposal_id",
          [entry.proposalId, owner, attempt],
        );
        if (!claimed.rows?.[0])
          throw new Error('memory projection claim unavailable');
      }
      const snapshot = await this.snapshotWithEntries(db, snapshotId);
      return {
        snapshot,
        file: fileFor(snapshot, entry.tenantId),
        ready: false,
        owner,
        attempt,
      };
    });
  }

  private async finishReceipt(
    snapshotId: string,
    status: 'ready' | 'failed',
    error: string | undefined,
    owner: string,
    attempt: number,
  ): Promise<void> {
    await this.transaction(async (db) => {
      const updated = await db.query<any>(
        "UPDATE workspace_memory_projection_receipts SET state=$2, lease_owner=NULL, lease_expires_at=NULL, safe_error_code=$3, updated_at=now() WHERE snapshot_id=$1 AND state='publishing' AND lease_owner=$4 AND attempt_count=$5 RETURNING snapshot_id",
        [snapshotId, status, error ?? null, owner, attempt],
      );
      if (!updated.rows?.[0])
        throw new Error('memory projection lease fence failed');
      await db.query(
        "UPDATE workspace_memory_snapshots SET projection_status=$2 WHERE snapshot_id=$1 AND projection_status <> 'ready'",
        [snapshotId, status],
      );
    });
  }

  private async snapshotWithEntries(
    db: ManagedMemoryDatabase,
    snapshotId: string,
  ): Promise<ManagedMemorySnapshot> {
    const result = await db.query<any>(
      'SELECT snapshot_id,workspace_id,version,content_hash,manifest_hash,projection_status,created_at FROM workspace_memory_snapshots WHERE snapshot_id=$1 FOR UPDATE',
      [snapshotId],
    );
    if (!result.rows?.[0]) {
      const entries = await this.listEntriesWith(db, '', '');
      const memory = render(entries);
      return {
        snapshotId,
        workspaceId: entries[0] ? '' : '',
        version: 1,
        contentHash: hash(memory),
        manifestHash: hash(memory),
        projectionStatus: 'pending',
        createdAt: new Date().toISOString(),
        entries,
      };
    }
    const members = await db.query<any>(
      'SELECT e.* FROM workspace_memory_snapshot_entries m JOIN workspace_memory_owned_entries e ON e.entry_id=m.entry_id WHERE m.snapshot_id=$1 ORDER BY m.ordinal',
      [snapshotId],
    );
    return {
      ...snapshotRow(result.rows[0]),
      entries: (members.rows ?? []).map(managedEntryRow),
    };
  }

  private async listEntriesWith(
    db: ManagedMemoryDatabase,
    tenantId: string,
    workspaceId: string,
  ): Promise<readonly ManagedMemoryEntry[]> {
    const result = await db.query<any>(
      'SELECT entry_id, proposal_id, tenant_id, workspace_id, principal_type, principal_id, content, category, accepted_at, source_task_id, source_session_id, source_message_id, source_run_id, source_agent_version_id, source_candidate_index FROM workspace_memory_owned_entries WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY accepted_at ASC, entry_id ASC',
      [tenantId, workspaceId],
    );
    return (result.rows ?? []).map(managedEntryRow);
  }

  private async transaction<T>(
    work: (db: ManagedMemoryDatabase) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const connectable = this.db as ManagedMemoryDatabase & {
      connect?: () => Promise<ManagedMemoryDatabase & { release?: () => void }>;
    };
    const db = connectable.connect ? await connectable.connect() : this.db;
    await db.query('BEGIN');
    try {
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db !== this.db && (db as any).release?.();
      release();
    }
  }

  public async listEntries(scope: {
    tenantId: string;
    workspaceId: string;
  }): Promise<readonly ManagedMemoryEntry[]> {
    const result = await this.db.query<any>(
      'SELECT entry_id, proposal_id, tenant_id, workspace_id, principal_type, principal_id, content, category, accepted_at, source_task_id, source_session_id, source_message_id, source_run_id, source_agent_version_id, source_candidate_index FROM workspace_memory_owned_entries WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY accepted_at ASC, entry_id ASC',
      [scope.tenantId, scope.workspaceId],
    );
    return (result.rows ?? []).map((row) => ({
      entryId: row.entry_id,
      proposalId: row.proposal_id,
      tenantId: row.tenant_id ?? scope.tenantId,
      workspaceId: row.workspace_id ?? scope.workspaceId,
      principalType: row.principal_type ?? '',
      principalId: row.principal_id ?? '',
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
    const prepared = await this.transaction(async (db) => {
      const version = await ensureProjectionScope(
        db,
        scope.tenantId,
        scope.workspaceId,
      );
      const entries = await this.listEntriesWith(
        db,
        scope.tenantId,
        scope.workspaceId,
      );
      const memory = render(entries);
      const contentHash = hash(memory);
      const snapshotId = randomUUID();
      const manifest = JSON.stringify({
        format: 1,
        workspace_id: scope.workspaceId,
        version,
        content_hash: contentHash,
        entries,
      });
      const manifestHash = hash(manifest);
      await db.query(
        'UPDATE workspace_memory_projection_scopes SET next_version=$3 WHERE tenant_id=$1 AND workspace_id=$2',
        [scope.tenantId, scope.workspaceId, version + 1],
      );
      await db.query(
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
      for (const [ordinal, member] of entries.entries())
        await db.query(
          'INSERT INTO workspace_memory_snapshot_entries (snapshot_id,tenant_id,workspace_id,principal_type,principal_id,entry_id,ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            snapshotId,
            scope.tenantId,
            scope.workspaceId,
            member.principalType,
            member.principalId,
            member.entryId,
            ordinal,
          ],
        );
      return {
        snapshotId,
        version,
        entries,
        memory,
        contentHash,
        manifest,
        manifestHash,
      };
    });
    try {
      await this.fileStore.publish({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        snapshotId: prepared.snapshotId,
        memory: prepared.memory,
        manifest: prepared.manifest,
        contentHash: prepared.contentHash,
      });
      await this.fileStore.readVerified({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        snapshotId: prepared.snapshotId,
        expectedContentHash: prepared.contentHash,
      });
      const ready = await this.db.query<any>(
        "UPDATE workspace_memory_snapshots SET projection_status=$2 WHERE snapshot_id=$1 AND projection_status='pending' RETURNING snapshot_id",
        [prepared.snapshotId, 'ready'],
      );
      if (!ready.rows?.[0])
        throw new Error('memory projection snapshot completion fence failed');
    } catch (error) {
      const failed = await this.db.query<any>(
        "UPDATE workspace_memory_snapshots SET projection_status=$2 WHERE snapshot_id=$1 AND projection_status='pending' RETURNING snapshot_id",
        [prepared.snapshotId, 'failed'],
      );
      if (!failed.rows?.[0])
        throw new Error('memory projection snapshot completion fence failed');
      throw error;
    }
    return {
      snapshotId: prepared.snapshotId,
      workspaceId: scope.workspaceId,
      version: prepared.version,
      contentHash: prepared.contentHash,
      manifestHash: prepared.manifestHash,
      projectionStatus: 'ready',
      createdAt: new Date().toISOString(),
      entries: prepared.entries,
    };
  }

  private async allocateManualVersion(scope: {
    tenantId: string;
    workspaceId: string;
  }): Promise<number> {
    return this.transaction((db) =>
      ensureProjectionScope(db, scope.tenantId, scope.workspaceId),
    );
  }
}

function isProjectionContention(error: Error): boolean {
  return (
    error.message === 'memory projection claim unavailable' ||
    error.message.includes('workspace_memory_projection_incomplete_scope') ||
    ('code' in error && error.code === '23505')
  );
}

function managedEntryRow(row: any): ManagedMemoryEntry {
  return {
    entryId: row.entry_id,
    proposalId: row.proposal_id,
    tenantId: row.tenant_id ?? '',
    workspaceId: row.workspace_id ?? '',
    principalType: row.principal_type ?? '',
    principalId: row.principal_id ?? '',
    content: row.content,
    category: row.category,
    acceptedAt: new Date(row.accepted_at).toISOString(),
    sourceTaskId: row.source_task_id ?? null,
    sourceSessionId: row.source_session_id ?? null,
    sourceMessageId: row.source_message_id ?? null,
    sourceRunId: row.source_run_id ?? null,
    sourceAgentVersionId: row.source_agent_version_id ?? null,
    sourceCandidateIndex: row.source_candidate_index ?? null,
  };
}

async function ensureProjectionScope(
  db: ManagedMemoryDatabase,
  tenantId: string,
  workspaceId: string,
): Promise<number> {
  await db.query(
    'LOCK TABLE workspace_memory_snapshots IN SHARE ROW EXCLUSIVE MODE',
  );
  await db.query(
    'INSERT INTO workspace_memory_projection_scopes (tenant_id,workspace_id,next_version) VALUES ($1,$2,1) ON CONFLICT DO NOTHING',
    [tenantId, workspaceId],
  );
  const scope = await db.query<{ next_version: number }>(
    'SELECT next_version FROM workspace_memory_projection_scopes WHERE tenant_id=$1 AND workspace_id=$2 FOR UPDATE',
    [tenantId, workspaceId],
  );
  const maximum = await db.query<{ next_version: number }>(
    'SELECT COALESCE(MAX(version),0)+1 AS next_version FROM workspace_memory_snapshots WHERE tenant_id=$1 AND workspace_id=$2',
    [tenantId, workspaceId],
  );
  const version = Math.max(
    Number(scope.rows?.[0]?.next_version ?? 1),
    Number(maximum.rows?.[0]?.next_version ?? 1),
  );
  if (version !== Number(scope.rows?.[0]?.next_version ?? 1))
    await db.query(
      'UPDATE workspace_memory_projection_scopes SET next_version=$3 WHERE tenant_id=$1 AND workspace_id=$2',
      [tenantId, workspaceId, version],
    );
  return version;
}

function canonicalEntryMatches(row: any, entry: WorkspaceMemoryEntry): boolean {
  const same =
    (row.id ?? row.entry_id) === entry.id &&
    row.proposal_id === entry.proposalId &&
    row.tenant_id === entry.tenantId &&
    row.workspace_id === entry.workspaceId &&
    row.principal_type === entry.principalType &&
    row.principal_id === entry.principalId &&
    row.content === entry.content &&
    row.category === entry.category &&
    (row.source_task_id ?? null) === entry.sourceTaskId &&
    (row.source_session_id ?? null) === entry.sourceSessionId &&
    (row.source_message_id ?? null) === (entry.sourceMessageId ?? null) &&
    (row.source_run_id ?? null) === (entry.sourceRunId ?? null) &&
    (row.source_agent_version_id ?? null) ===
      (entry.sourceAgentVersionId ?? null) &&
    (row.source_candidate_index ?? null) ===
      (entry.sourceCandidateIndex ?? null) &&
    stableJson(
      typeof row.proposer_snapshot === 'string'
        ? JSON.parse(row.proposer_snapshot)
        : row.proposer_snapshot,
    ) === stableJson(entry.proposerSnapshot) &&
    stableJson(
      typeof row.reviewer_snapshot === 'string'
        ? JSON.parse(row.reviewer_snapshot)
        : row.reviewer_snapshot,
    ) === stableJson(entry.reviewerSnapshot) &&
    (row.review_outcome === undefined ||
      row.review_outcome === entry.reviewOutcome) &&
    new Date(row.accepted_at).toISOString() === entry.acceptedAt;
  return same;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function fileFor(snapshot: ManagedMemorySnapshot, tenantId: string) {
  const memory = render(snapshot.entries);
  const manifest = JSON.stringify({
    format: 1,
    workspace_id: snapshot.workspaceId,
    version: snapshot.version,
    content_hash: snapshot.contentHash,
    entries: snapshot.entries,
  });
  return {
    tenantId,
    workspaceId: snapshot.workspaceId,
    snapshotId: snapshot.snapshotId,
    memory,
    manifest,
    contentHash: snapshot.contentHash,
  };
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.name.slice(0, 256)
    : 'projection_failed';
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
