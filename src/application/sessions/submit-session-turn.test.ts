import { describe, expect, it } from 'vitest';

import type {
  SessionRepository,
  SubmitSessionTurnInput,
  UserMessage,
} from '../ports/session-repository.js';
import { SubmitSessionTurn } from './submit-session-turn.js';

const owner = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'service_account' as const,
  principalId: 'principal-1',
  policySnapshotVersion: 'policy-1',
};

function message(): UserMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    generation: 0,
    sequence: 1,
    role: 'user',
    text: 'remember this',
    taskId: 'task-1',
    runId: 'run-1',
    status: 'queued',
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}

describe('SubmitSessionTurn', () => {
  it('forwards an API origin to the session repository', async () => {
    const repository = recordingRepository();
    const useCase = new SubmitSessionTurn(repository);

    const result = await useCase.execute({
      sessionId: 'session-1',
      text: 'remember this',
      idempotencyKey: 'message-1',
      owner,
      origin: { channel: 'api', requestId: 'request-1' },
    });

    expect(repository.input).toMatchObject({
      origin: { channel: 'api', requestId: 'request-1' },
    });
    expect(result.taskId).toBe('task-1');
  });

  it('forwards a Lark origin to the session repository', async () => {
    const repository = recordingRepository();
    const useCase = new SubmitSessionTurn(repository);

    await useCase.execute({
      sessionId: 'session-1',
      text: 'remember this',
      idempotencyKey: 'message-1',
      owner,
      origin: { channel: 'lark', ingressEventId: 'ingress-1' },
    });

    expect(repository.input?.origin).toEqual({
      channel: 'lark',
      ingressEventId: 'ingress-1',
    });
  });

  it('preserves the repository not-found behavior for a missing Session', async () => {
    const repository: Pick<SessionRepository, 'postMessage'> = {
      postMessage: async () => {
        throw new Error('not_found');
      },
    };

    await expect(
      new SubmitSessionTurn(repository).execute({
        sessionId: 'missing-session',
        text: 'remember this',
        idempotencyKey: 'message-1',
        owner,
        origin: { channel: 'api', requestId: 'request-1' },
      }),
    ).rejects.toThrow('not_found');
  });

  it('rejects caller-created unsupported origin objects', async () => {
    const repository = recordingRepository();

    await expect(
      new SubmitSessionTurn(repository).execute({
        sessionId: 'session-1',
        text: 'remember this',
        idempotencyKey: 'message-1',
        owner,
        origin: { channel: 'email', requestId: 'request-1' },
      } as unknown as SubmitSessionTurnInput),
    ).rejects.toThrow(/origin/i);
  });

  it('forwards a fresh immutable origin and input snapshot', async () => {
    const repository = recordingRepository();
    const origin = { channel: 'lark' as const, ingressEventId: 'ingress-1' };

    await new SubmitSessionTurn(repository).execute({
      sessionId: 'session-1',
      text: 'remember this',
      idempotencyKey: 'message-1',
      owner,
      origin,
    });
    origin.ingressEventId = 'mutated-after-submit';

    expect(repository.input).not.toBeUndefined();
    expect(repository.input).not.toBe(origin);
    expect(Object.isFrozen(repository.input)).toBe(true);
    expect(repository.input?.origin).not.toBe(origin);
    expect(repository.input?.origin).toEqual({
      channel: 'lark',
      ingressEventId: 'ingress-1',
    });
  });

  it('isolates the forwarded authoritative owner snapshot from caller mutation', async () => {
    const repository = recordingRepository();
    const mutableOwner = { ...owner };

    await new SubmitSessionTurn(repository).execute({
      sessionId: 'session-1',
      text: 'remember this',
      idempotencyKey: 'message-1',
      owner: mutableOwner,
      origin: { channel: 'api', requestId: 'request-1' },
    });
    mutableOwner.workspaceId = 'mutated-workspace';

    expect(repository.input).not.toBeUndefined();
    expect(repository.input?.owner).not.toBe(mutableOwner);
    expect(Object.isFrozen(repository.input?.owner)).toBe(true);
    expect(repository.input?.owner.workspaceId).toBe('workspace-1');
  });

  it('does not reread getter-backed origin values after validation', async () => {
    const repository = recordingRepository();
    let ingressReads = 0;
    const origin = new Proxy(
      { channel: 'lark' as const, ingressEventId: 'ingress-1' },
      {
        get(target, property) {
          if (property === 'channel') return target.channel;
          if (property === 'ingressEventId') {
            ingressReads += 1;
            return ingressReads === 1 ? target.ingressEventId : '';
          }
          return Reflect.get(target, property);
        },
      },
    );

    await new SubmitSessionTurn(repository).execute({
      sessionId: 'session-1',
      text: 'remember this',
      idempotencyKey: 'message-1',
      owner,
      origin,
    });

    expect(ingressReads).toBe(1);
    expect(repository.input?.origin).toEqual({
      channel: 'lark',
      ingressEventId: 'ingress-1',
    });
  });

  it('fails safely when an origin getter throws', async () => {
    const repository = recordingRepository();
    const origin = new Proxy(
      {},
      {
        get() {
          throw new Error('origin getter failure');
        },
      },
    );

    await expect(
      new SubmitSessionTurn(repository).execute({
        sessionId: 'session-1',
        text: 'remember this',
        idempotencyKey: 'message-1',
        owner,
        origin,
      } as unknown as SubmitSessionTurnInput),
    ).rejects.toThrow('supported and non-empty');
  });
});

function recordingRepository(): Pick<SessionRepository, 'postMessage'> & {
  input?: SubmitSessionTurnInput;
} {
  const repository: Pick<SessionRepository, 'postMessage'> & {
    input?: SubmitSessionTurnInput;
  } = {
    postMessage: async (input) => {
      repository.input = input;
      return message();
    },
  };
  return repository;
}
