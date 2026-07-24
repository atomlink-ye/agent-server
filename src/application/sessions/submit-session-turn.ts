import type {
  SessionRepository,
  SubmitSessionTurnInput,
  UserMessage,
} from '../ports/session-repository.js';

export class SubmitSessionTurn {
  public constructor(
    private readonly sessions: Pick<SessionRepository, 'postMessage'>,
  ) {}

  public async execute(input: SubmitSessionTurnInput): Promise<UserMessage> {
    const { sessionId, text, idempotencyKey, owner, origin } = input;
    const canonicalOrigin = canonicalizeOrigin(origin);
    const {
      tenantId,
      workspaceId,
      principalType,
      principalId,
      policySnapshotVersion,
    } = owner;
    const ownerSnapshot = Object.freeze({
      tenantId,
      workspaceId,
      principalType,
      principalId,
      policySnapshotVersion,
    });
    const forwardedInput = Object.freeze({
      sessionId,
      text,
      idempotencyKey,
      owner: ownerSnapshot,
      origin: canonicalOrigin,
    });
    return this.sessions.postMessage(forwardedInput);
  }
}

function canonicalizeOrigin(
  origin: SubmitSessionTurnInput['origin'],
): SubmitSessionTurnInput['origin'] {
  let channel: unknown;
  let selectedValue: unknown;

  try {
    const originReference = origin as unknown as Record<string, unknown>;
    channel = originReference.channel;
    if (channel === 'api') {
      selectedValue = originReference.requestId;
    } else if (channel === 'lark') {
      selectedValue = originReference.ingressEventId;
    }
  } catch {
    throw new Error('Session turn origin must be supported and non-empty');
  }

  if (
    channel === 'api' &&
    typeof selectedValue === 'string' &&
    selectedValue.trim().length > 0
  ) {
    return Object.freeze({ channel: 'api', requestId: selectedValue });
  }

  if (
    channel === 'lark' &&
    typeof selectedValue === 'string' &&
    selectedValue.trim().length > 0
  ) {
    return Object.freeze({ channel: 'lark', ingressEventId: selectedValue });
  }

  throw new Error('Session turn origin must be supported and non-empty');
}
