import { describe, expect, it } from 'vitest';

import { GetProductSessionTranscripts } from './get-product-session-transcripts.js';
import type { AgentActivityStreamFact } from './session-transcript-facts-source.js';
import type { Work } from '../../domain/work/work.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import type { RunEvent, RunEventRepository } from '../ports/run-events.js';

const tenantId = 'tenant-a';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const workId = '22222222-2222-4222-8222-222222222222';
const workRunId = '33333333-3333-4333-8333-333333333333';
const rootTaskId = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
const at = '2026-08-24T00:00:00.000Z';

const work: Work = {
  id: workId,
  tenantId,
  workspaceId,
  definitionId: '66666666-6666-4666-8666-666666666666',
  currentDefinitionVersionId: '77777777-7777-4777-8777-777777777777',
  title: 'Solo agent coworker chat',
  origin: 'created',
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
};

const workRun: WorkRun = {
  id: workRunId,
  tenantId,
  workspaceId,
  workId,
  definitionVersionId: work.currentDefinitionVersionId,
  triggerKind: 'manual',
  triggerRef: 'chat',
  idempotencyKey: 'idem',
  rootTaskId,
  expiresAt: '2026-08-24T01:00:00.000Z',
  boundAt: at,
  createdAt: at,
  updatedAt: at,
};

// The stream shape a lone agent (no Team) now produces: no role, and a
// taskId source ref rather than a teamMemberRunId one.
const soloAgentStream: AgentActivityStreamFact = {
  name: 'Solo Agent',
  role: null,
  status: 'succeeded',
  statusBasis: 'agent_runs',
  sourceRefs: { taskId: rootTaskId },
  runs: [
    {
      runId,
      taskId: rootTaskId,
      rootTaskId,
      status: 'succeeded',
      provider: 'paseo',
      model: 'free-model',
      resultPresent: true,
      errorCode: null,
      actorId: null,
      workItemId: null,
      startedAt: at,
      endedAt: '2026-08-24T00:00:01.000Z',
      createdAt: at,
      updatedAt: '2026-08-24T00:00:01.000Z',
    },
  ],
};

function fakeRunEvents(
  events: readonly RunEvent[],
): Pick<RunEventRepository, 'list'> {
  return {
    async list(targetRunId, after) {
      if (targetRunId !== runId) return { events: [], nextCursor: null };
      const remaining = events.filter((event) => event.sequence > after);
      return { events: remaining, nextCursor: null };
    },
  };
}

describe('GetProductSessionTranscripts', () => {
  it('parses a role:null stream against the amended contract and keeps entry building unchanged', async () => {
    const events: readonly RunEvent[] = [
      {
        id: '88888888-8888-4888-8888-888888888888',
        runId,
        sequence: 1,
        type: 'started',
        payload: {},
        createdAt: at,
      },
      {
        id: '99999999-9999-4999-8999-999999999999',
        runId,
        sequence: 2,
        type: 'succeeded',
        payload: {},
        createdAt: '2026-08-24T00:00:01.000Z',
      },
    ];
    const projector = new GetProductSessionTranscripts(
      {
        findWorkById: async () => work,
        findWorkRunById: async () => workRun,
      },
      { listByRootTask: async () => [soloAgentStream] },
      fakeRunEvents(events),
    );

    const response = await projector.execute({
      tenantId,
      workspaceId,
      workId,
      workRunId,
    });

    expect(response.sessions).toHaveLength(1);
    const [session] = response.sessions;
    expect(session!.label).toEqual({
      name: 'Solo Agent',
      role: null,
      status: 'succeeded',
      status_basis: 'agent_runs',
      source_refs: { task_id: rootTaskId },
    });
    expect(session!.summary.entry_count).toBe(2);
    expect(session!.entries.map((entry) => entry.ordinal)).toEqual([1, 2]);
    expect(session!.entries.map((entry) => entry.kind)).toEqual([
      'lifecycle',
      'lifecycle',
    ]);
  });

  it('renders a Team member label with a role and a team_member_run_id source ref', async () => {
    const teamMemberStream: AgentActivityStreamFact = {
      name: 'lead',
      role: 'lead',
      status: 'active',
      statusBasis: 'team_member_run',
      sourceRefs: { teamMemberRunId: '00000000-0000-4000-8000-000000009999' },
      runs: [],
    };
    const projector = new GetProductSessionTranscripts(
      {
        findWorkById: async () => work,
        findWorkRunById: async () => workRun,
      },
      { listByRootTask: async () => [teamMemberStream] },
      fakeRunEvents([]),
    );

    const response = await projector.execute({
      tenantId,
      workspaceId,
      workId,
      workRunId,
    });

    expect(response.sessions).toHaveLength(1);
    expect(response.sessions[0]!.label).toEqual({
      name: 'lead',
      role: 'lead',
      status: 'active',
      status_basis: 'team_member_run',
      source_refs: {
        team_member_run_id: '00000000-0000-4000-8000-000000009999',
      },
    });
    expect(response.sessions[0]!.summary.entry_count).toBe(0);
  });

  it('clips a session once its entries exceed the byte budget and reports truncated: true', async () => {
    // Large enough that a few dozen of these entries blow the byte budget
    // long before MAX_SESSION_TRANSCRIPT_ENTRIES (2,000) would ever kick in
    // -- this isolates the byte-budget clip from the pre-existing
    // entry-count clip. Kept under the summary's last_meaningful.result cap
    // (12,000 chars) so the fixture itself stays contract-valid.
    const bigText = 'x'.repeat(10_000);
    const events: readonly RunEvent[] = Array.from(
      { length: 100 },
      (_, index) => ({
        id: `event-${index}`,
        runId,
        sequence: index + 1,
        type: 'output',
        payload: { kind: 'assistant_text', text: bigText },
        createdAt: new Date(Date.parse(at) + index * 1_000).toISOString(),
      }),
    );
    const projector = new GetProductSessionTranscripts(
      {
        findWorkById: async () => work,
        findWorkRunById: async () => workRun,
      },
      { listByRootTask: async () => [soloAgentStream] },
      fakeRunEvents(events),
    );

    const response = await projector.execute({
      tenantId,
      workspaceId,
      workId,
      workRunId,
    });

    const [session] = response.sessions;
    // All 100 events exist and none individually approaches the entry-count
    // cap, so stopping short of 100 can only be the byte budget clipping.
    expect(session!.entries.length).toBeGreaterThan(0);
    expect(session!.entries.length).toBeLessThan(100);
    expect(session!.summary.truncated).toBe(true);
    expect(session!.summary.entry_count).toBe(session!.entries.length);
    // The whole point of the byte budget: what is actually emitted stays
    // well under the browser BFF's 1 MiB forwarding cap, instead of being
    // built honestly and then discarded whole by the transport.
    const emittedBytes = Buffer.byteLength(JSON.stringify(session!.entries));
    expect(emittedBytes).toBeLessThanOrEqual(1024 * 1024);
  });

  it('budgets fairly across sessions: a 2,000-entry lead does not starve two 100-entry members', async () => {
    // teamMemberRunId is contract-bound to z.uuid(), so these double as both
    // the run identifier (opaque, no format requirement) and the source ref.
    const leadRunId = '55555555-5555-4555-8555-000000000001';
    const reviewerRunId = '55555555-5555-4555-8555-000000000002';
    const fixerRunId = '55555555-5555-4555-8555-000000000003';
    // Kept under the summary's last_meaningful.result cap (12,000 chars) so
    // the fixture itself stays contract-valid.
    const bigText = 'x'.repeat(10_000);
    const smallText = 'ok';

    function outputEvents(
      targetRunId: string,
      count: number,
      text: string,
    ): RunEvent[] {
      return Array.from({ length: count }, (_, index) => ({
        id: `${targetRunId}-${index}`,
        runId: targetRunId,
        sequence: index + 1,
        type: 'output',
        payload: { kind: 'assistant_text', text },
        createdAt: new Date(Date.parse(at) + index * 1_000).toISOString(),
      }));
    }

    function memberStream(
      name: string,
      targetRunId: string,
    ): AgentActivityStreamFact {
      return {
        name,
        role: name,
        status: 'succeeded',
        statusBasis: 'team_member_run',
        sourceRefs: { teamMemberRunId: targetRunId },
        runs: [
          {
            runId: targetRunId,
            taskId: rootTaskId,
            rootTaskId,
            status: 'succeeded',
            provider: 'paseo',
            model: 'free-model',
            resultPresent: true,
            errorCode: null,
            actorId: null,
            workItemId: null,
            startedAt: at,
            endedAt: at,
            createdAt: at,
            updatedAt: at,
          },
        ],
      };
    }

    const eventsByRun: Readonly<Record<string, readonly RunEvent[]>> = {
      [leadRunId]: outputEvents(leadRunId, 2_000, bigText),
      [reviewerRunId]: outputEvents(reviewerRunId, 100, smallText),
      [fixerRunId]: outputEvents(fixerRunId, 100, smallText),
    };

    const projector = new GetProductSessionTranscripts(
      {
        findWorkById: async () => work,
        findWorkRunById: async () => workRun,
      },
      {
        listByRootTask: async () => [
          memberStream('lead', leadRunId),
          memberStream('reviewer', reviewerRunId),
          memberStream('fixer', fixerRunId),
        ],
      },
      {
        async list(targetRunId, after) {
          const remaining = (eventsByRun[targetRunId] ?? []).filter(
            (event) => event.sequence > after,
          );
          return { events: remaining, nextCursor: null };
        },
      },
    );

    const response = await projector.execute({
      tenantId,
      workspaceId,
      workId,
      workRunId,
    });

    // The fairness requirement itself: none of the three sessions is missing
    // from the response just because one of them is huge.
    expect(response.sessions).toHaveLength(3);
    const [lead, reviewer, fixer] = response.sessions;
    expect(lead!.label.name).toBe('lead');
    expect(reviewer!.label.name).toBe('reviewer');
    expect(fixer!.label.name).toBe('fixer');

    // The runaway lead is clipped by its own share of the budget...
    expect(lead!.summary.truncated).toBe(true);
    expect(lead!.entries.length).toBeLessThan(2_000);
    // ...but that clip must never cost the quiet members their entries --
    // that is the fairness property, not merely "truncation works at all".
    expect(reviewer!.entries.length).toBe(100);
    expect(reviewer!.summary.truncated).toBe(false);
    expect(fixer!.entries.length).toBe(100);
    expect(fixer!.summary.truncated).toBe(false);
  });
});
