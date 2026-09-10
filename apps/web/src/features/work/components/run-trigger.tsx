import { useState } from 'react';
import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

import { workRunClient } from '../clients/work-run-client';
import {
  isPermanentRunFailure,
  workRunFailureMessage,
} from '../clients/errors';
import { workTabHref } from './work-presentation';
import { useRunAvailability } from '../queries/use-run-availability';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';
import { useT } from '../../../i18n';

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
  runState,
}: {
  readonly workId: string;
  readonly originConversationId?: string | null;
  readonly definitionVersion?: ProductWorkDefinitionVersionResponse | null;
  readonly runState?: WorkListItem['product_state'] | null;
}) {
  const t = useT();
  const [state, setState] = useState<RunTriggerState>({ kind: 'idle' });
  const availability = useRunAvailability(definitionVersion);

  if (runState === 'complete')
    return (
      <div className="work-run-trigger">
        <a className="work-run-trigger__result" href="#run-result">
          {t('work.run.readResult')}
        </a>
      </div>
    );

  if (runState === 'running' || runState === 'needs_you')
    return (
      <div className="work-run-trigger">
        <a className="work-run-trigger__result" href="#execution-record">
          {t('work.run.followProgress')}
        </a>
      </div>
    );

  async function handleRun() {
    setState({ kind: 'starting' });
    try {
      const runId = (await workRunClient.start(workId)).work_run.id;
      window.location.assign(
        workTabHref(workId, 'chat', runId, originConversationId),
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
  const missingCapability =
    availability.status === 'ready' ? availability.missingCapability : null;
  const friendlyCapability = missingCapability
    ? ({
        external_workspace: t('work.run.externalWorkspace'),
        reusable_session: t('work.run.reusableSession'),
        platform_mcp: t('work.run.platformTools'),
      }[missingCapability] ?? missingCapability.replaceAll('_', ' '))
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
          ? t('work.run.checkingAvailability')
          : blockedByCapability || availability.status === 'unavailable'
            ? t('work.run.cantStart')
            : state.kind === 'starting'
              ? t('work.run.starting')
              : state.kind === 'error'
                ? state.permanent
                  ? t('work.run.cantStart')
                  : t('work.run.errorRetry')
                : runState === 'problem'
                  ? t('work.run.retry')
                  : t('work.run.start')}
      </button>
      {availability.status === 'loading' ? (
        <p role="status">{t('work.run.checkingBody')}</p>
      ) : null}
      {availability.status === 'error' ? (
        <div className="work-run-availability-error">
          <p role="alert">{t('work.run.checkError')}</p>
          <button type="button" onClick={availability.retry}>
            {t('work.run.retryAvailability')}
          </button>
        </div>
      ) : null}
      {blockedByCapability && friendlyCapability ? (
        <section className="work-run-unavailable" role="status">
          <p className="work-run-unavailable__eyebrow">
            {t('work.run.unavailable')}
          </p>
          <h2>{t('work.run.unavailableTitle')}</h2>
          <p id={reasonId}>
            {t('work.run.requires', { capability: friendlyCapability })}
          </p>
        </section>
      ) : null}
      {availability.status === 'unavailable' ? (
        <p id={reasonId} role="status">
          {availability.reason === 'current_definition_missing'
            ? t('work.run.definitionMissing')
            : t('work.run.managementUnavailable')}
        </p>
      ) : null}
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
    </div>
  );
}
