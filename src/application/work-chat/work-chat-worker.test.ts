import { describe, expect, it, vi } from 'vitest';
import {
  WorkChatWorker,
  parseLeadOutput,
  renderWorkChatInputSchemaPrompt,
} from './work-chat-worker.js';

describe('parseLeadOutput', () => {
  it('extracts the bounded preparation envelope', () => {
    expect(
      parseLeadOutput(
        JSON.stringify({
          reply: 'Need a topic.',
          candidate_input: { topic: 'alpha' },
          missing: [],
          ambiguities: [],
        }),
      ),
    ).toEqual({
      replyText: 'Need a topic.',
      candidateInput: { topic: 'alpha' },
      missing: [],
      ambiguities: [],
    });
  });

  it('falls back to safe text when the model claims readiness without an envelope', () => {
    expect(parseLeadOutput('Everything is ready.')).toEqual({
      replyText: 'Everything is ready.',
      candidateInput: {},
      missing: [],
      ambiguities: [],
    });
  });

  it('includes the current schema properties and required fields in the intake prompt', () => {
    const prompt = renderWorkChatInputSchemaPrompt({
      type: 'object',
      properties: {
        topic: { type: 'string', min_length: 1 },
        row_count: { type: 'integer', minimum: 1 },
      },
      required: ['topic'],
      additional_properties: false,
    });
    expect(prompt).toContain('topic');
    expect(prompt).toContain('row_count');
    expect(prompt).toContain('required');
    expect(prompt).toContain('additional_properties');
  });
});

it.each(['single_worker', 'collaboration'])(
  'uses the actual %s executor and isolates Run chat from intake',
  async (kind) => {
    const claim = {
      id: 'message',
      workId: 'work',
      workRunId: 'run-a' as string | undefined,
      tenantId: 'tenant',
      workspaceId: 'workspace',
      body: 'hello',
      leaseFence: 1,
    };
    const complete = vi.fn();
    const fail = vi.fn().mockResolvedValue(false);
    const observeLead = vi.fn();
    const getIntakeContext = vi.fn();
    const list = vi.fn().mockResolvedValue([]);
    const desired = vi.fn().mockResolvedValue({ session: { id: 'session' } });
    const resolvePublished = vi
      .fn()
      .mockResolvedValue({ instructions: 'Executor instructions' });
    const deps = {
      repository: {
        claimNext: vi.fn().mockResolvedValue(claim),
        list,
        complete,
        fail,
      },
      workIdentity: {
        findWorkById: vi.fn().mockResolvedValue({
          definitionId: 'definition',
          currentDefinitionVersionId: 'new-version',
        }),
        getWorkRun: vi.fn().mockResolvedValue({
          id: 'run-a',
          workId: 'work',
          definitionVersionId: 'pinned-version',
          rootTaskId: 'root',
        }),
      },
      definitions: {
        resolve: vi.fn().mockResolvedValue({
          kind,
          participants: [
            {
              role: kind === 'single_worker' ? 'primary' : 'lead',
              workerVersionId: 'definition-worker',
            },
          ],
        }),
      },
      tasks: {
        findByIdForOwner: vi.fn().mockResolvedValue({
          task: {
            id: 'root',
            invokableKind: kind === 'single_worker' ? 'worker' : 'team',
            invokableVersionId: 'actual-worker',
            status: 'succeeded',
          },
        }),
      },
      teams: {
        findTeamRunByRootTaskId: vi
          .fn()
          .mockResolvedValue({ id: 'team', status: 'succeeded' }),
        findMembersByTeamRunId: vi
          .fn()
          .mockResolvedValue([
            { role: 'lead', workerVersionId: 'actual-worker' },
          ]),
      },
      workers: { resolvePublished },
      desiredSpec: { execute: desired },
      turnExecutor: { execute: vi.fn().mockResolvedValue({ text: 'Reply' }) },
      runtimeTurns: { findById: vi.fn() },
      preparations: { observeLead, getIntakeContext },
    };
    const worker = new WorkChatWorker(deps as any, {
      workerId: 'worker',
      leaseMs: 60000,
      ownerPrincipalType: 'service_account',
      ownerPrincipalId: 'owner',
      config: { paseo: { provider: 'opencode', agentCwd: '/tmp' } } as any,
    });
    await worker.step();
    expect(fail).not.toHaveBeenCalled();
    expect(resolvePublished).toHaveBeenCalledWith(
      'actual-worker',
      expect.anything(),
      { resolveExtensions: true },
    );
    expect(desired).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'work_run_chat', id: 'run-a' },
        subject: { kind: 'worker', workerVersionId: 'actual-worker' },
      }),
    );
    expect(
      desired.mock.calls[0]?.[0].configuration.desiredSystemPrompt.text ??
        JSON.stringify(
          desired.mock.calls[0]?.[0].configuration.desiredSystemPrompt,
        ),
    ).not.toContain('temporary Lead');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ workRunId: 'run-a' }),
    );
    expect(observeLead).not.toHaveBeenCalled();
    expect(getIntakeContext).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
    claim.workRunId = 'run-b';
    deps.workIdentity.getWorkRun.mockResolvedValue({
      id: 'run-b',
      workId: 'work',
      definitionVersionId: 'pinned-version',
      rootTaskId: 'root',
    });
    await worker.step();
    expect(desired.mock.calls.map(([input]) => input.scope)).toEqual([
      { kind: 'work_run_chat', id: 'run-a' },
      { kind: 'work_run_chat', id: 'run-b' },
    ]);
    claim.workRunId = undefined;
    await worker.step();
    expect(desired).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: { kind: 'work_chat', id: 'work' },
        subject: { kind: 'worker', workerVersionId: 'definition-worker' },
      }),
    );
    expect(observeLead).toHaveBeenCalledTimes(1);
    expect(getIntakeContext).toHaveBeenCalledTimes(1);
    claim.workRunId = 'run-b';
    deps.workIdentity.getWorkRun.mockResolvedValue(null as any);
    await worker.step();
    expect(fail).toHaveBeenLastCalledWith(
      expect.objectContaining({ failureCode: 'work_run_not_found' }),
    );
    expect(desired).toHaveBeenCalledTimes(3);
  },
);
