import { useState } from 'react';
import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

import { workRunClient } from '../clients/work-run-client';
import {
  isPermanentRunFailure,
  workRunFailureMessage,
} from '../clients/errors';
import { workTabHref } from './work-presentation';
import { useRunAvailability } from '../queries/use-run-availability';

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
  definitionVersion,
}: {
  readonly workId: string;
  readonly originConversationId?: string | null;
  readonly definitionVersion?: ProductWorkDefinitionVersionResponse | null;
}) {
  const [state, setState] = useState<RunTriggerState>({ kind: 'idle' });
  const availability = useRunAvailability(definitionVersion ?? null);

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
    availability.status === 'loading' ||
    availability.status === 'unavailable' ||
    (availability.status === 'ready' &&
      availability.missingCapability !== null) ||
    state.kind === 'starting' ||
    (state.kind === 'error' && state.permanent);
  const blockedByCapability =
    availability.status === 'ready' && availability.missingCapability !== null;
  const hasUnavailableReason =
    blockedByCapability || availability.status === 'unavailable';
  const reasonId = `run-unavailable-${workId}`;
  const friendlyCapability = availability.missingCapability
    ? ({
        external_workspace: 'External workspace',
        reusable_session: 'Reusable session',
        platform_mcp: 'Platform tools',
      }[availability.missingCapability] ??
      availability.missingCapability.replaceAll('_', ' '))
    : null;

  return (
    <div className="work-run-trigger">
      <button
        disabled={disabled}
        aria-describedby={hasUnavailableReason ? reasonId : undefined}
        onClick={() => void handleRun()}
        type="button"
      >
        {availability.status === 'loading'
          ? 'Checking availability…'
          : blockedByCapability || availability.status === 'unavailable'
            ? 'Can’t start Run'
            : state.kind === 'starting'
              ? 'Starting…'
              : state.kind === 'error'
                ? state.permanent
                  ? 'Can’t start Run'
                  : 'Error — Retry'
                : 'Start Run'}
      </button>
      {availability.status === 'loading' ? (
        <p role="status">Checking whether this Work can run here…</p>
      ) : null}
      {availability.status === 'error' ? (
        <div className="work-run-availability-error">
          <p role="alert">We couldn’t check whether this Work can run here.</p>
          <button type="button" onClick={availability.retry}>
            Retry availability check
          </button>
        </div>
      ) : null}
      {blockedByCapability && friendlyCapability ? (
        <section className="work-run-unavailable" role="status">
          <p className="work-run-unavailable__eyebrow">Run unavailable</p>
          <h2>This Work can’t run in this deployment.</h2>
          <p id={reasonId}>
            It requires {friendlyCapability}, which isn’t available here.
          </p>
        </section>
      ) : null}
      {availability.status === 'unavailable' ? (
        <p id={reasonId} role="status">
          Work management is not available in this environment.
        </p>
      ) : null}
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
    </div>
  );
}
