import type { Coworker } from '../agents/contracts';
import { COWORKER_ROLE_FALLBACK, runtimeStatusLabel } from './format';

/**
 * The mention/assignee directory for Tasks and Boards.
 *
 * Cumora reads one `participants` store that already knows every human and
 * agent in the workspace. This product has no human roster endpoint — only
 * the Coworker roster (`/api/agents`) — so a human becomes addressable the
 * moment their principal id appears in the data the surface already loaded
 * (a WorkItem author/assignee, a comment author). That keeps the directory
 * honest: it never claims a participant the workspace has not shown us.
 */
export type ParticipantKind = 'agent' | 'human';

export interface Participant {
  readonly id: string;
  readonly name: string;
  readonly kind: ParticipantKind;
  /** Secondary line in the picker — role/status for an agent, else null. */
  readonly detail: string | null;
  /** False for a Coworker that cannot currently be reached. */
  readonly active: boolean;
}

export function buildParticipantDirectory(input: {
  readonly agents: readonly Coworker[];
  readonly principalIds: readonly (string | null | undefined)[];
}): readonly Participant[] {
  const byId = new Map<string, Participant>();
  for (const agent of input.agents) {
    byId.set(agent.id, {
      id: agent.id,
      name: agent.displayName,
      kind: 'agent',
      detail: [
        agent.roleLabel ?? COWORKER_ROLE_FALLBACK,
        runtimeStatusLabel(agent.runtimeStatus),
      ].join(' · '),
      active: agent.runtimeStatus !== 'unavailable',
    });
  }
  for (const principalId of input.principalIds) {
    const id = principalId?.trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      name: id,
      kind: 'human',
      detail: null,
      active: true,
    });
  }
  return [...byId.values()].sort(compareParticipants);
}

function compareParticipants(left: Participant, right: Participant): number {
  if (left.kind !== right.kind) return left.kind === 'human' ? -1 : 1;
  return left.name.localeCompare(right.name);
}

export function findParticipant(
  directory: readonly Participant[],
  id: string | null | undefined,
): Participant | null {
  if (!id) return null;
  return directory.find((participant) => participant.id === id) ?? null;
}

/** The display name when the participant is known, else the raw id. */
export function participantLabel(
  directory: readonly Participant[],
  id: string,
): string {
  return findParticipant(directory, id)?.name ?? id;
}

/**
 * Cumora shows a generated avatar image per participant. This product has no
 * avatar asset, so the chip falls back to initials — the same information
 * density without inventing an image pipeline.
 */
export function participantInitials(name: string): string {
  const words = name
    .split(/[\s._:-]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]!.charAt(0)}${words[words.length - 1]!.charAt(0)}`.toUpperCase();
}

/** Candidates offered while typing `@`, filtered by the typed query. */
export function matchParticipants(
  directory: readonly Participant[],
  query: string,
  limit = 6,
): readonly Participant[] {
  const needle = query.trim().toLowerCase();
  const candidates = directory.filter((participant) => participant.active);
  if (!needle) return candidates.slice(0, limit);
  return candidates
    .filter(
      (participant) =>
        participant.id.toLowerCase().includes(needle) ||
        participant.name.toLowerCase().includes(needle),
    )
    .slice(0, limit);
}
