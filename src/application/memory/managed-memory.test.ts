import { describe, expect, it } from 'vitest';
import { ManagedMemory } from './managed-memory.js';
import type { FileStoreSnapshot } from '../ports/file-store.js';

const entry = {
  id: '00000000-0000-4000-8000-000000000001',
  proposalId: '00000000-0000-4000-8000-000000000002',
  tenantId: 't',
  workspaceId: 'w',
  principalType: 'service_account',
  principalId: 'a',
  content: 'Use UTC.',
  category: 'rule',
  sourceTaskId: '00000000-0000-4000-8000-000000000003',
  sourceSessionId: 's',
  sourceMessageId: '00000000-0000-4000-8000-000000000004',
  sourceRunId: '00000000-0000-4000-8000-000000000005',
  sourceAgentVersionId: '00000000-0000-4000-8000-000000000006',
  sourceCandidateIndex: 2,
  proposerSnapshot: {
    principalType: 'service_account',
    principalId: 'a',
    policySnapshotVersion: 'p',
  },
  reviewerSnapshot: {
    principalType: 'service_account',
    principalId: 'a',
    policySnapshotVersion: 'p',
  },
  reviewOutcome: 'accept' as const,
  acceptedAt: '2026-01-01T00:00:00.000Z',
};

describe('ManagedMemory', () => {
  it('renders accepted entries and publishes only after verification', async () => {
    const rows: any[] = [];
    const published: FileStoreSnapshot[] = [];
    const db = {
      query: async (sql: string, values?: readonly unknown[]) => {
        if (sql.includes('SELECT entry_id FROM')) return { rows: [] };
        if (sql.includes('SELECT COALESCE')) return { rows: [{ version: 1 }] };
        if (sql.includes('INSERT INTO workspace_memory_owned_entries'))
          rows.push({
            entry_id: entry.id,
            proposal_id: entry.proposalId,
            content: entry.content,
            category: entry.category,
            accepted_at: entry.acceptedAt,
            source_task_id: entry.sourceTaskId,
            source_session_id: entry.sourceSessionId,
            source_message_id: entry.sourceMessageId,
            source_run_id: entry.sourceRunId,
            source_agent_version_id: entry.sourceAgentVersionId,
            source_candidate_index: entry.sourceCandidateIndex,
          });
        if (sql.includes('SELECT entry_id, proposal_id')) return { rows };
        return { rows: [] };
      },
    };
    const memory = new ManagedMemory(db, {
      publish: async (snapshot) => {
        published.push(snapshot);
      },
      readVerified: async () => 'Use UTC.',
    });
    const snapshot = await memory.acceptEntry(entry);
    expect(snapshot.projectionStatus).toBe('ready');
    expect(published[0]?.memory).toContain('Use UTC.');
    expect(published[0]?.manifest).toContain(entry.id);
    expect(published[0]?.manifest).toContain(entry.sourceRunId);
    expect(snapshot.entries).toMatchObject([
      {
        entryId: entry.id,
        proposalId: entry.proposalId,
        sourceMessageId: entry.sourceMessageId,
        sourceRunId: entry.sourceRunId,
        sourceAgentVersionId: entry.sourceAgentVersionId,
        sourceCandidateIndex: entry.sourceCandidateIndex,
      },
    ]);
  });
});
