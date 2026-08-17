import { describe, expect, it } from 'vitest';

import {
  AGENT_SERVER_COLLABORATION_TOOL_REFS,
  collaborationToolRefsForRole,
} from '../../domain/collaboration/canonical-collaboration-tools.js';
import type { TeamToolContext } from '../teams/team-tool-context.js';
import {
  CollaborationPolicy,
  CollaborationPolicyError,
} from './collaboration-policy.js';

const policy = new CollaborationPolicy();

function context(role: 'lead' | 'member') {
  return {
    member: { role },
  } as Pick<TeamToolContext, 'member'>;
}

function taskContext(
  role: 'lead' | 'member',
  teamTaskKind: 'lead_turn' | 'work_attempt' | 'direct_message',
  attemptStatus: 'queued' | 'running' | 'completed' | 'failed' | null = null,
) {
  return {
    member: { role },
    task: { teamTaskKind },
    attempt: attemptStatus ? { status: attemptStatus } : null,
  } as Pick<TeamToolContext, 'member' | 'task' | 'attempt'>;
}

describe('CollaborationPolicy', () => {
  it('treats role as a capability preset rather than a domain state machine', () => {
    expect(policy.capabilities(context('lead'))).toEqual(
      expect.arrayContaining([
        'board.create',
        'board.assign',
        'board.review',
        'mailbox.send',
        'run.finalize',
      ]),
    );
    expect(policy.capabilities(context('member'))).toEqual(
      expect.arrayContaining([
        'board.claim',
        'board.checkpoint',
        'board.block',
        'board.submit',
        'mailbox.send',
        'mailbox.ack',
      ]),
    );
  });

  it('derives runtime tool grants from the same role capability definition', () => {
    expect(collaborationToolRefsForRole('lead')).toEqual(
      expect.arrayContaining([
        AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate,
        AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAssign,
        AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept,
        AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
        AGENT_SERVER_COLLABORATION_TOOL_REFS.finish,
      ]),
    );
    expect(collaborationToolRefsForRole('member')).toEqual(
      expect.arrayContaining([
        AGENT_SERVER_COLLABORATION_TOOL_REFS.boardClaim,
        AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCheckpoint,
        AGENT_SERVER_COLLABORATION_TOOL_REFS.boardBlock,
        AGENT_SERVER_COLLABORATION_TOOL_REFS.boardSubmit,
      ]),
    );
    expect(collaborationToolRefsForRole('member')).not.toContain(
      AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAssign,
    );
  });

  it('does not let mailbox authority imply assignment or review authority', () => {
    expect(() =>
      policy.require(context('member'), 'mailbox.send'),
    ).not.toThrow();
    expect(() => policy.require(context('member'), 'board.assign')).toThrow(
      CollaborationPolicyError,
    );
    expect(() => policy.require(context('member'), 'board.review')).toThrow(
      CollaborationPolicyError,
    );
  });

  it('binds lead mutations to lead turns and member mutations to member work turns', () => {
    expect(() =>
      policy.requireLeadCommand(
        taskContext('lead', 'direct_message'),
        'collaboration_finish',
      ),
    ).not.toThrow();
    expect(() =>
      policy.requireLeadCommand(
        taskContext('lead', 'direct_message'),
        'board_accept',
      ),
    ).toThrow(CollaborationPolicyError);
    expect(() =>
      policy.requireLeadCommand(
        taskContext('lead', 'lead_turn'),
        'board_accept',
      ),
    ).not.toThrow();
    expect(() =>
      policy.requireForTask(
        taskContext('member', 'direct_message'),
        'board.submit',
      ),
    ).toThrow(CollaborationPolicyError);
    expect(() =>
      policy.requireForTask(
        taskContext('member', 'work_attempt', 'queued'),
        'board.submit',
      ),
    ).toThrow(CollaborationPolicyError);
    expect(() =>
      policy.requireForTask(
        taskContext('member', 'work_attempt', 'running'),
        'board.submit',
      ),
    ).not.toThrow();
  });

  it('keeps completed work attempts read-only for mailbox mutations', () => {
    const completed = taskContext('member', 'work_attempt', 'completed');
    expect(() =>
      policy.requireForTask(completed, 'mailbox.read'),
    ).not.toThrow();
    expect(() => policy.requireForTask(completed, 'mailbox.send')).toThrow(
      CollaborationPolicyError,
    );
    expect(() => policy.requireForTask(completed, 'mailbox.ack')).toThrow(
      CollaborationPolicyError,
    );
  });
});
