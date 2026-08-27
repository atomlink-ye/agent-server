import { useState } from 'react';

import { workRunClient } from '../clients/work-run-client';
import {
  isPermanentRunFailure,
  workRunFailureMessage,
} from '../clients/errors';
import { workTabHref } from './work-presentation';

type RunTriggerState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'error';
      readonly permanent: boolean;
      readonly message: string;
    };

export function RunTrigger({
  workId,
  originConversationId,
}: {
  readonly workId: string;
  readonly originConversationId?: string | null;
}) {
  const [state, setState] = useState<RunTriggerState>({ kind: 'idle' });

  async function handleRun() {
    setState({ kind: 'starting' });
    try {
      const runId = (await workRunClient.start(workId)).work_run.id;
      window.location.assign(
        workTabHref(workId, 'overview', runId, originConversationId),
      );
    } catch (reason) {
      // A permanent failure (e.g. the Work requires a runtime capability
      // this deployment does not support) cannot be fixed by retrying, so
      // the control must not promise a Retry it can never honor.
      setState({
        kind: 'error',
        permanent: isPermanentRunFailure(reason),
        message: workRunFailureMessage(reason),
      });
    }
  }

  const disabled =
    state.kind === 'starting' || (state.kind === 'error' && state.permanent);

  return (
    <div className="work-run-trigger">
      <button
        disabled={disabled}
        onClick={() => void handleRun()}
        type="button"
      >
        {state.kind === 'starting'
          ? 'Starting…'
          : state.kind === 'error'
            ? state.permanent
              ? 'Can’t start Run'
              : 'Error — Retry'
            : 'Start Run'}
      </button>
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
    </div>
  );
}
