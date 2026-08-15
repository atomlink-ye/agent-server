import { describe, expect, it } from 'vitest';

import type { TeamToolContext } from '../teams/team-tool-context.js';
import { CollaborationPolicy, CollaborationPolicyError } from './collaboration-policy.js';

const policy = new CollaborationPolicy();

function context(role: 'lead' | 'member') {
  return {
    member: { role },
  } as Pick<TeamToolContext, 'member'>;
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

  it('does not let mailbox authority imply assignment or review authority', () => {
    expect(() => policy.require(context('member'), 'mailbox.send')).not.toThrow();
    expect(() => policy.require(context('member'), 'board.assign')).toThrow(
      CollaborationPolicyError,
    );
    expect(() => policy.require(context('member'), 'board.review')).toThrow(
      CollaborationPolicyError,
    );
  });
});
