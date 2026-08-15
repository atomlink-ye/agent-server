import type { CollaborationCapability } from './collaboration.js';

export type CollaborationRole = 'lead' | 'member';

export const COLLABORATION_LIMITS = Object.freeze({
  maxLeadTurns: 8,
  maxWorkItems: 4,
  maxAttemptsPerItem: 2,
  maxDependenciesPerWorkItem: 4,
  maxMessagesPerActivation: 8,
});

const ROLE_CAPABILITIES = Object.freeze<
  Record<CollaborationRole, readonly CollaborationCapability[]>
>({
  lead: Object.freeze([
    'board.read',
    'board.create',
    'board.assign',
    'board.review',
    'board.cancel',
    'mailbox.read',
    'mailbox.send',
    'mailbox.ack',
    'run.finalize',
  ]),
  member: Object.freeze([
    'board.read',
    'board.claim',
    'board.checkpoint',
    'board.block',
    'board.submit',
    'mailbox.read',
    'mailbox.send',
    'mailbox.ack',
  ]),
});

export function collaborationCapabilitiesForRole(
  role: CollaborationRole,
): readonly CollaborationCapability[] {
  return ROLE_CAPABILITIES[role];
}
