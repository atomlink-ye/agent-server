import { describe, expect, it } from 'vitest';

import { AgenticTeamProjectResponseSchema } from '../../../contracts/teams.js';
import { toAgenticTeamProjectResponse } from './team-runs.js';

const ids = {
  rootTask: '00000000-0000-4000-8000-000000000101',
  teamRun: '00000000-0000-4000-8000-000000000102',
  teamVersion: '00000000-0000-4000-8000-000000000103',
  member: '00000000-0000-4000-8000-000000000104',
  task: '00000000-0000-4000-8000-000000000105',
  run: '00000000-0000-4000-8000-000000000106',
  work: '00000000-0000-4000-8000-000000000107',
  attempt1: '00000000-0000-4000-8000-000000000108',
  attempt2: '00000000-0000-4000-8000-000000000109',
};
const timestamp = '2026-08-07T00:00:00.000Z';

describe('agentic team project route contract', () => {
  it('accepts the complete snake_case projection including revision, stop reason, descriptions, attempts, and turn runtime', () => {
    const response = {
      stuck: false,
      decision_capture_status: 'not_captured',
      project: {
        root_task_id: ids.rootTask,
        team_run_id: ids.teamRun,
        team_version_id: ids.teamVersion,
        status: 'failed',
        phase: 'done',
        final_text: null,
        revision: 42,
        stop_reason: 'lead_turn_limit',
        completion_approval_required: false,
        completion_decisions: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      work_items: [
        {
          work_ref: 'work-1',
          subject: 'Implement typed detail',
          description: 'Preserve provider semantics through persistence.',
          status: 'accepted',
          assignee_name: 'fixer',
          dependency_refs: [],
          attempts: [
            {
              attempt_no: 1,
              status: 'failed',
              feedback_summary: 'Please add provider projection.',
              result_summary: 'Missing provider field',
            },
            {
              attempt_no: 2,
              status: 'completed',
              feedback_summary: null,
              result_summary: 'Provider projection added',
            },
          ],
          latest_attempt: {
            attempt_no: 2,
            status: 'completed',
            feedback_summary: null,
            result_summary: 'Provider projection added',
          },
        },
      ],
      gates: {
        finish_ready: true,
        all_work_accepted: true,
        no_active_attempts: true,
        all_members_idle: true,
      },
      direct_messages: [],
      sessions: [
        {
          team_member_run_id: ids.member,
          name: 'fixer',
          role: 'member',
          status: 'idle',
          turns: [
            {
              task_id: ids.task,
              run_id: ids.run,
              sequence: 1,
              kind: 'work_attempt',
              activation: null,
              status: 'completed',
              context: 'Implement typed detail',
              result_text: 'done',
              work_item_id: ids.work,
              attempt_id: ids.attempt2,
              attempt_no: 2,
              provider: 'actual-provider',
              model: 'actual/model',
              created_at: timestamp,
              updated_at: timestamp,
            },
          ],
        },
      ],
    };

    expect(() =>
      AgenticTeamProjectResponseSchema.parse(response),
    ).not.toThrow();
    expect(AgenticTeamProjectResponseSchema.parse(response)).toMatchObject({
      project: { revision: 42, stop_reason: 'lead_turn_limit' },
      work_items: [
        {
          description: 'Preserve provider semantics through persistence.',
          attempts: expect.arrayContaining([
            expect.objectContaining({ attempt_no: 1 }),
          ]),
        },
      ],
      sessions: [
        {
          turns: [
            expect.objectContaining({
              provider: 'actual-provider',
              model: 'actual/model',
            }),
          ],
        },
      ],
    });
  });

  it('maps the camelCase projection through the public route mapper without dropping S4 fields', () => {
    const projection = {
      stuck: false,
      decisionCapture: { status: 'not_captured' as const },
      project: {
        rootTaskId: ids.rootTask,
        teamRunId: ids.teamRun,
        teamVersionId: ids.teamVersion,
        status: 'failed' as const,
        phase: 'done' as const,
        finalText: null,
        revision: 42,
        stopReason: 'lead_turn_limit',
        completionApprovalRequired: false,
        completionDecisions: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      workItems: [
        {
          workRef: 'work-1',
          subject: 'Implement typed detail',
          description: 'Preserve provider semantics through persistence.',
          status: 'accepted',
          assigneeName: 'fixer',
          dependencyRefs: [],
          attempts: [
            {
              attemptNo: 1,
              status: 'failed',
              feedbackSummary: 'Please add provider projection.',
              resultSummary: 'Missing provider field',
            },
            {
              attemptNo: 2,
              status: 'completed',
              feedbackSummary: null,
              resultSummary: 'Provider projection added',
            },
          ],
          latestAttempt: {
            attemptNo: 2,
            status: 'completed',
            feedbackSummary: null,
            resultSummary: 'Provider projection added',
          },
        },
      ],
      gates: {
        finishReady: true,
        allWorkAccepted: true,
        noActiveAttempts: true,
        allMembersIdle: true,
      },
      directMessages: [],
      sessions: [
        {
          teamMemberRunId: ids.member,
          name: 'fixer',
          role: 'member' as const,
          status: 'idle' as const,
          turns: [
            {
              taskId: ids.task,
              runId: ids.run,
              sequence: 1,
              kind: 'work_attempt' as const,
              activation: null,
              status: 'completed' as const,
              context: 'Implement typed detail',
              resultText: 'done',
              workItemId: ids.work,
              attemptId: ids.attempt2,
              attemptNo: 2,
              provider: 'actual-provider',
              model: 'actual/model',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        },
      ],
    };

    const response = toAgenticTeamProjectResponse(projection as never);
    expect(response).toMatchObject({
      stuck: false,
      decision_capture_status: 'not_captured',
      project: { revision: 42, stop_reason: 'lead_turn_limit' },
      work_items: [
        expect.objectContaining({
          description: 'Preserve provider semantics through persistence.',
          attempts: expect.arrayContaining([
            expect.objectContaining({ attempt_no: 1 }),
          ]),
        }),
      ],
      sessions: [
        {
          turns: [
            expect.objectContaining({
              provider: 'actual-provider',
              model: 'actual/model',
            }),
          ],
        },
      ],
    });
    expect('decisions' in response).toBe(false);
  });

  it('distinguishes reported none from unavailable decision capture', () => {
    const unavailable = toAgenticTeamProjectResponse(null);
    expect(unavailable).toMatchObject({
      decision_capture_status: 'not_captured',
    });
    expect('decisions' in unavailable).toBe(false);

    const reportedNone = {
      ...unavailable,
      decision_capture_status: 'reported' as const,
      decisions: [],
    };
    expect(() =>
      AgenticTeamProjectResponseSchema.parse(reportedNone),
    ).not.toThrow();
    expect(() =>
      AgenticTeamProjectResponseSchema.parse({
        ...unavailable,
        decisions: [],
      }),
    ).toThrow();
  });
});
