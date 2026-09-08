import { useEffect, useState } from 'react';

import {
  loadCoworkerProfile,
  loadCoworkers,
} from '../../agents/agents-gateway';

export type ObserveRosterAgent = {
  readonly id: string;
  readonly name: string;
  /** Work Definition ids this Coworker has explicitly published as a
   * Capability. This is a Coworker-to-Work relationship, not a trace actor. */
  readonly workDefinitionIds: ReadonlySet<string>;
};

export type ObserveRosterQuery = {
  readonly status: 'loading' | 'ready' | 'error';
  readonly agents: readonly ObserveRosterAgent[];
};

/**
 * Loads the Coworker roster separately from session transcripts. The two
 * identities intentionally stay separate: roster membership selects Works by
 * their published Capability association, while transcript labels describe
 * only the Worker identities that actually emitted a trace.
 */
export function useObserveRoster(): ObserveRosterQuery {
  const [state, setState] = useState<ObserveRosterQuery>({
    status: 'loading',
    agents: [],
  });

  useEffect(() => {
    let active = true;
    void loadCoworkers()
      .then(async (coworkers) => {
        const profiles = await Promise.all(
          coworkers.map(async (coworker) => ({
            coworker,
            profile: await loadCoworkerProfile(coworker.id),
          })),
        );
        if (!active) return;
        setState({
          status: 'ready',
          agents: profiles
            .map(({ coworker, profile }) => ({
              id: coworker.id,
              name: coworker.displayName,
              workDefinitionIds: new Set(
                profile.workCatalog.map(
                  (capability) => capability.definitionId,
                ),
              ),
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        });
      })
      .catch(() => {
        if (active) setState({ status: 'error', agents: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
