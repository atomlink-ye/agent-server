import { useEffect, useState } from 'react';

import { workRunClient } from '../../work/clients/work-run-client';
import type { ObserveEntry } from './use-observe-entries';

export type AgentParticipation = ReadonlyMap<string, readonly string[]>;

// The Work list carries no durable Agent identity per Work, so the Agent
// filter is derived from the participant labels the existing
// session-transcripts endpoint already reports for each Work's latest Run,
// rather than a new backend aggregation.
export function useObserveAgentParticipation(
  entries: readonly ObserveEntry[],
): { readonly participation: AgentParticipation; readonly resolving: boolean } {
  const [participation, setParticipation] = useState<AgentParticipation>(
    new Map(),
  );
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const pending = entries.filter(
      (entry) =>
        entry.latest_run_summary !== null && !participation.has(entry.id),
    );
    if (pending.length === 0) return;
    let active = true;
    setResolving(true);
    void Promise.all(
      pending.map(async (entry) => {
        const runId = entry.latest_run_summary!.id;
        try {
          const sessions = await workRunClient.sessionTranscripts(
            entry.id,
            runId,
          );
          return [
            entry.id,
            sessions.map((session) => session.label.name),
          ] as const;
        } catch {
          return [entry.id, []] as const;
        }
      }),
    ).then((resolved) => {
      if (!active) return;
      setParticipation((current) => {
        const next = new Map(current);
        for (const [workId, names] of resolved) next.set(workId, names);
        return next;
      });
      setResolving(false);
    });
    return () => {
      active = false;
    };
  }, [entries, participation]);

  return { participation, resolving };
}
