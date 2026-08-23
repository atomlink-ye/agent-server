import { useState } from 'react';

import { workRunClient } from '../clients/work-run-client';
import { workTabHref } from './work-presentation';

export function RunTrigger({
  workId,
  originConversationId,
}: {
  readonly workId: string;
  readonly originConversationId?: string | null;
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  async function handleRun() {
    setState('starting');
    setErrorDetail(null);
    try {
      const runId = (await workRunClient.start(workId)).work_run.id;
      window.location.assign(
        workTabHref(workId, 'overview', runId, originConversationId),
      );
    } catch (error) {
      setErrorDetail(
        error instanceof Error ? error.message : 'Please try again.',
      );
      setState('error');
    }
  }

  return (
    <div className="work-run-trigger">
      <button
        disabled={state === 'starting'}
        onClick={() => void handleRun()}
        type="button"
      >
        {state === 'starting'
          ? 'Starting…'
          : state === 'error'
            ? 'Error — Retry'
            : 'Start Run'}
      </button>
      {state === 'error' ? (
        <p>
          Failed to start Run
          {errorDetail ? `: ${errorDetail}` : '. Please try again.'}
        </p>
      ) : null}
    </div>
  );
}
