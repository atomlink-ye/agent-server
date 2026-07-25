import type { ChannelIngress } from '../../domain/channels/channel-event.js';
import type { ProcessChannelIngress } from './process-channel-ingress.js';
import type { ApplyMemoryReviewCommand } from './apply-memory-review-command.js';
import type { ApplyMemoryReviewControl } from './apply-memory-review-control.js';

export class ProcessLarkIngress {
  public constructor(
    private readonly messages: Pick<ProcessChannelIngress, 'execute'>,
    private readonly commands: Pick<ApplyMemoryReviewCommand, 'execute'>,
    private readonly controls: Pick<ApplyMemoryReviewControl, 'execute'>,
  ) {}

  public execute(ingress: ChannelIngress) {
    if (ingress.kind === 'card_action') return this.controls.execute(ingress);
    return ingress.kind === 'command'
      ? this.commands.execute(ingress)
      : this.messages.execute(ingress);
  }
}
