import type { ChannelIngress } from '../../domain/channels/channel-event.js';
import type { UserMessage } from '../ports/session-repository.js';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import { SubmitSessionTurn } from '../sessions/submit-session-turn.js';
import {
  ResolveLarkBinding,
  ownerFromLarkCanary,
} from './resolve-lark-binding.js';

export type CompleteChannelIngressInput = {
  readonly ingressId: string;
  readonly status: 'processed' | 'failed';
  readonly safeErrorCode?: string;
  readonly admittedSessionId?: string;
  readonly admittedTaskId?: string;
  readonly leaseOwner: string;
  readonly attemptNumber: number;
};

export interface ChannelIngressStatusPort {
  completeIngress(input: CompleteChannelIngressInput): Promise<void>;
}

export type ProcessChannelIngressResult =
  | {
      readonly accepted: true;
      readonly message: UserMessage;
      readonly sessionId: string;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
    };

export class ProcessChannelIngress {
  public constructor(
    private readonly resolver: ResolveLarkBinding,
    private readonly submitTurn: Pick<SubmitSessionTurn, 'execute'>,
    private readonly statuses: ChannelIngressStatusPort,
    private readonly config: LarkCanaryEnabledConfig,
  ) {}

  public async execute(
    ingress: ChannelIngress,
  ): Promise<ProcessChannelIngressResult> {
    if (!ingress.externalMessageId) {
      await this.statuses.completeIngress({
        ingressId: ingress.id,
        status: 'processed',
        safeErrorCode: 'missing_message_id',
        ...ingressFence(ingress),
      });
      return { accepted: false, reason: 'missing_message_id' };
    }
    const resolved = await this.resolver.execute(ingress);
    if (!resolved.accepted) {
      await this.statuses.completeIngress({
        ingressId: ingress.id,
        status: 'processed',
        safeErrorCode: resolved.reason,
        ...ingressFence(ingress),
      });
      return resolved;
    }
    if (ingress.text === undefined) {
      await this.statuses.completeIngress({
        ingressId: ingress.id,
        status: 'failed',
        safeErrorCode: 'missing_text',
        ...ingressFence(ingress),
      });
      return { accepted: false, reason: 'missing_text' };
    }

    try {
      const message = await this.submitTurn.execute({
        sessionId: resolved.sessionId,
        text: ingress.text,
        idempotencyKey: ingress.externalMessageId,
        owner: ownerFromLarkCanary(this.config),
        origin: { channel: 'lark', ingressEventId: ingress.id },
      });
      await this.statuses.completeIngress({
        ingressId: ingress.id,
        status: 'processed',
        admittedSessionId: message.sessionId,
        admittedTaskId: message.taskId,
        ...ingressFence(ingress),
      });
      return { accepted: true, message, sessionId: message.sessionId };
    } catch {
      await this.statuses.completeIngress({
        ingressId: ingress.id,
        status: 'failed',
        safeErrorCode: 'session_turn_failed',
        ...ingressFence(ingress),
      });
      return { accepted: false, reason: 'session_turn_failed' };
    }
  }
}

function ingressFence(ingress: ChannelIngress): {
  readonly leaseOwner: string;
  readonly attemptNumber: number;
} {
  if (!ingress.leaseOwner) throw new Error('claimed ingress lease is required');
  return {
    leaseOwner: ingress.leaseOwner,
    attemptNumber: ingress.attemptCount,
  };
}
