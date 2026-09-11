import { t, type MessageKey } from './index';

const keys: Readonly<Record<string, MessageKey>> = {
  running: 'value.running',
  completed: 'value.completed',
  succeeded: 'value.succeeded',
  failed: 'value.failed',
  cancelled: 'value.cancelled',
  queued: 'value.queued',
  pending: 'value.pending',
  active: 'value.active',
  idle: 'value.idle',
  starting: 'value.starting',
  needs_you: 'value.needs_you',
  complete: 'value.complete',
  problem: 'value.problem',
  not_captured: 'value.not_captured',
  not_present: 'value.not_present',
  present: 'value.present',
  redacted: 'value.redacted',
  published: 'value.published',
  draft: 'value.draft',
  single_worker: 'value.single_worker',
  collaboration: 'value.collaboration',
  lead: 'value.lead',
  member: 'value.member',
  primary: 'value.primary',
  referenced: 'value.referenced',
  inline: 'value.inline',
  waiting: 'value.waiting',
  accepted: 'value.accepted',
  rejected: 'value.rejected',
  in_progress: 'value.in_progress',
  planned: 'value.planned',
  dispatched: 'value.dispatched',
  confirmed: 'value.confirmed',
};

/** Localize known projection values without changing their wire identity. */
export function capturedValue(value: string): string {
  const key = keys[value];
  return key ? t(key) : value.replaceAll('_', ' ');
}
