import { useEffect, useState } from 'react';

import {
  loadSessionTranscripts,
  type SessionTranscriptsResponse,
} from '@/features/run-trace/run-trace-gateway';

export type ObserveRunTokensQuery =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly totalTokens: number | null }
  | { readonly status: 'unavailable' };

/**
 * Token usage is captured as a single 'usage' snapshot per Agent session,
 * emitted once when that session's runtime execution finalizes (see
 * PaseoObservationProjector#finalize) -- so summing every session's
 * snapshot across the Run is a total, not a double count.
 */
export function useObserveRunTokens(
  workId: string,
  runId: string,
): ObserveRunTokensQuery {
  const [state, setState] = useState<ObserveRunTokensQuery>({
    status: 'loading',
  });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    void loadSessionTranscripts(workId, runId)
      .then((data) => {
        if (active) setState({ status: 'ready', totalTokens: sumTokens(data) });
      })
      .catch(() => {
        if (active) setState({ status: 'unavailable' });
      });
    return () => {
      active = false;
    };
  }, [workId, runId]);

  return state;
}

function sumTokens(data: SessionTranscriptsResponse): number | null {
  let total = 0;
  let captured = false;
  for (const session of data.sessions) {
    for (const entry of session.entries) {
      if (entry.kind !== 'usage') continue;
      if (entry.input_tokens !== null) {
        total += entry.input_tokens;
        captured = true;
      }
      if (entry.output_tokens !== null) {
        total += entry.output_tokens;
        captured = true;
      }
    }
  }
  return captured ? total : null;
}
