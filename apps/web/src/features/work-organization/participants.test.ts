import { describe, expect, it } from 'vitest';

import type { Coworker, CoworkerRuntimeStatus } from '../agents/contracts';
import {
  buildParticipantDirectory,
  findParticipant,
  matchParticipants,
  participantInitials,
  participantLabel,
} from './participants';

function coworker(
  id: string,
  displayName: string,
  runtimeStatus: CoworkerRuntimeStatus = 'available',
  roleLabel: string | null = 'Analyst',
): Coworker {
  return {
    id,
    displayName,
    roleLabel,
    summary: null,
    activeAgentVersionId: `${id}-v1`,
    runtimeStatus,
  };
}

describe('buildParticipantDirectory', () => {
  it('lists Coworkers as agents with a role/status detail line', () => {
    const directory = buildParticipantDirectory({
      agents: [coworker('ari', 'Ari Analyst')],
      principalIds: [],
    });
    expect(directory).toEqual([
      {
        id: 'ari',
        name: 'Ari Analyst',
        kind: 'agent',
        detail: 'Analyst · 可用',
        active: true,
      },
    ]);
  });

  it('falls back to the generic Coworker role when the roster has none', () => {
    const [participant] = buildParticipantDirectory({
      agents: [coworker('ari', 'Ari', 'available', null)],
      principalIds: [],
    });
    expect(participant?.detail).toBe('AI 同事 · 可用');
  });

  it('marks an unavailable Coworker inactive', () => {
    const [participant] = buildParticipantDirectory({
      agents: [coworker('ari', 'Ari', 'unavailable')],
      principalIds: [],
    });
    expect(participant?.active).toBe(false);
  });

  it('keeps a draining Coworker addressable', () => {
    const [participant] = buildParticipantDirectory({
      agents: [coworker('ari', 'Ari', 'draining')],
      principalIds: [],
    });
    expect(participant?.active).toBe(true);
  });

  it('adds a human for every principal id the surface has seen', () => {
    const directory = buildParticipantDirectory({
      agents: [],
      principalIds: ['user-1', 'user-2'],
    });
    expect(directory.map((participant) => participant.id)).toEqual([
      'user-1',
      'user-2',
    ]);
    expect(directory[0]).toMatchObject({
      kind: 'human',
      name: 'user-1',
      detail: null,
    });
  });

  it('skips blank and missing principal ids', () => {
    expect(
      buildParticipantDirectory({
        agents: [],
        principalIds: [null, undefined, '', '   '],
      }),
    ).toEqual([]);
  });

  it('de-duplicates a principal id repeated across the loaded data', () => {
    const directory = buildParticipantDirectory({
      agents: [],
      principalIds: ['user-1', 'user-1'],
    });
    expect(directory).toHaveLength(1);
  });

  it('does not shadow a Coworker with a principal id of the same value', () => {
    const directory = buildParticipantDirectory({
      agents: [coworker('ari', 'Ari Analyst')],
      principalIds: ['ari'],
    });
    expect(directory).toHaveLength(1);
    expect(directory[0]?.kind).toBe('agent');
  });

  it('orders humans before agents, each alphabetically', () => {
    const directory = buildParticipantDirectory({
      agents: [coworker('z', 'Zed'), coworker('a', 'Ada')],
      principalIds: ['user-b', 'user-a'],
    });
    expect(directory.map((participant) => participant.name)).toEqual([
      'user-a',
      'user-b',
      'Ada',
      'Zed',
    ]);
  });
});

describe('findParticipant / participantLabel', () => {
  const directory = buildParticipantDirectory({
    agents: [coworker('ari', 'Ari Analyst')],
    principalIds: [],
  });

  it('resolves a known id', () => {
    expect(findParticipant(directory, 'ari')?.name).toBe('Ari Analyst');
    expect(participantLabel(directory, 'ari')).toBe('Ari Analyst');
  });

  it('answers null for a missing or absent id', () => {
    expect(findParticipant(directory, 'nobody')).toBeNull();
    expect(findParticipant(directory, null)).toBeNull();
  });

  it('shows the raw id when the participant is unknown', () => {
    expect(participantLabel(directory, 'nobody')).toBe('nobody');
  });
});

describe('participantInitials', () => {
  it('takes the first and last word initials', () => {
    expect(participantInitials('Ari Analyst')).toBe('AA');
    expect(participantInitials('Bo Van Der Chen')).toBe('BC');
  });

  it('takes two letters from a single word', () => {
    expect(participantInitials('ari')).toBe('AR');
  });

  it('splits on the separators an id uses', () => {
    expect(participantInitials('ari-analyst')).toBe('AA');
    expect(participantInitials('principal:bo.chen')).toBe('PC');
  });

  it('answers a placeholder for an unusable name', () => {
    expect(participantInitials('   ')).toBe('?');
  });
});

describe('matchParticipants', () => {
  const directory = buildParticipantDirectory({
    agents: [
      coworker('ari-analyst', 'Ari Analyst'),
      coworker('bo-builder', 'Bo Builder'),
      coworker('offline', 'Offline One', 'unavailable'),
    ],
    principalIds: ['user-ari'],
  });

  it('offers every active participant for an empty query', () => {
    expect(matchParticipants(directory, '').map((p) => p.id)).toEqual([
      'user-ari',
      'ari-analyst',
      'bo-builder',
    ]);
  });

  it('matches on display name and on id', () => {
    expect(matchParticipants(directory, 'builder').map((p) => p.id)).toEqual([
      'bo-builder',
    ]);
    expect(matchParticipants(directory, 'user-').map((p) => p.id)).toEqual([
      'user-ari',
    ]);
  });

  it('matches case-insensitively', () => {
    expect(matchParticipants(directory, 'ARI').map((p) => p.id)).toEqual([
      'user-ari',
      'ari-analyst',
    ]);
  });

  it('never offers an unreachable Coworker', () => {
    expect(matchParticipants(directory, 'offline')).toEqual([]);
  });

  it('caps the candidate list', () => {
    expect(matchParticipants(directory, '', 2)).toHaveLength(2);
  });
});
