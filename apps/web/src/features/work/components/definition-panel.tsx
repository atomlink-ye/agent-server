import { t } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { stringify } from 'yaml';
import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

import {
  humanize,
  workTabHref,
} from '@/features/work/components/work-presentation';
import { ApiTransportError } from '@/api/transport';
import {
  type DefinitionDiagnostics,
  type DefinitionPlan as Plan,
  workDefinitionClient,
} from '@/features/work/clients/work-definition-client';
import { workRunClient } from '@/features/work/clients/work-run-client';
import {
  isPermanentRunFailure,
  workRunFailureMessage,
} from '@/features/work/clients/errors';
import './definition-panel.css';

type AuthoringState =
  | 'idle'
  | 'validating'
  | 'valid'
  | 'applying'
  | 'applied'
  | 'running'
  | 'error';

export function DefinitionPanel({
  workId,
  workDefinitionId,
  currentWorkVersionId,
  selectedVersionId,
  version,
  editable,
  originConversationId = null,
}: {
  readonly workId: string;
  readonly workDefinitionId: string;
  readonly currentWorkVersionId: string;
  readonly selectedVersionId: string;
  readonly version: ProductWorkDefinitionVersionResponse | null;
  readonly editable: boolean;
  readonly originConversationId?: string | null;
}) {
  const normalizedSource = useMemo(
    () => (version ? stringify(version.source) : ''),
    [version],
  );
  const [source, setSource] = useState(normalizedSource);
  const [state, setState] = useState<AuthoringState>('idle');
  // A Run that cannot start in this deployment cannot be started from here
  // either. This surface offers the same action as the Work detail page, so it
  // owes the user the same answer instead of a Run button that keeps failing.
  const [runBlocked, setRunBlocked] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DefinitionDiagnostics>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setSource(normalizedSource);
    setState('idle');
    setDiagnostics([]);
    setPlan(null);
    setStatusMessage(null);
  }, [normalizedSource, selectedVersionId]);

  if (!version)
    return (
      <section
        className="work-capability-unavailable"
        data-testid="definition-unavailable"
      >
        <p className="work-shell-kicker">{t('work.tab.definition')}</p>
        <h2>{t('definition.unavailable')}</h2>
        <p>{t('definition.versionRefIntro')}</p>
        <code className="work-definition-ref">{selectedVersionId}</code>
      </section>
    );

  const metadata = asRecord(version.source.metadata);
  const spec = asRecord(version.source.spec);
  const name = stringValue(metadata?.name) ?? t('definition.fallback');
  const description = stringValue(metadata?.description);
  const kind = stringValue(spec?.kind) ?? 'not_captured';
  const environment = resourceBinding(
    spec,
    'environment_version_id',
    'environment',
  );
  const participants = participantsFromSource(kind, spec);
  const isCurrentVersion = selectedVersionId === currentWorkVersionId;

  async function validateAndPlan(): Promise<Plan | null> {
    setState('validating');
    setDiagnostics([]);
    setPlan(null);
    setStatusMessage(null);
    try {
      await workDefinitionClient.validate(source);
    } catch (error) {
      const nextDiagnostics = diagnosticsFrom(
        error instanceof ApiTransportError ? error.payload : undefined,
      );
      setDiagnostics(nextDiagnostics);
      setStatusMessage(
        nextDiagnostics.length
          ? t('work.start.fixDiagnostics')
          : t('work.start.validationFailed'),
      );
      setState('error');
      return null;
    }
    let planned;
    try {
      planned = await workDefinitionClient.plan(source);
    } catch (error) {
      const nextDiagnostics = diagnosticsFrom(
        error instanceof ApiTransportError ? error.payload : undefined,
      );
      setDiagnostics(nextDiagnostics);
      setStatusMessage(t('definition.planFailed'));
      setState('error');
      return null;
    }
    setPlan(planned);
    setState('valid');
    setStatusMessage(t('work.start.valid'));
    return planned;
  }

  async function applyDefinition() {
    const resolvedPlan = await validateAndPlan();
    if (!resolvedPlan) return;
    setState('applying');
    let applied;
    try {
      applied = await workDefinitionClient.apply(source);
    } catch (error) {
      setDiagnostics(
        diagnosticsFrom(
          error instanceof ApiTransportError ? error.payload : undefined,
        ),
      );
      setState('error');
      setStatusMessage(t('work.start.applyFailed'));
      return;
    }
    if (applied.definitionId !== workDefinitionId) {
      setState('error');
      setStatusMessage(t('definition.lineageMismatch'));
      return;
    }
    try {
      await workDefinitionClient.pinVersion(workId, applied.versionId);
    } catch {
      setState('error');
      setStatusMessage(t('definition.pinFailed'));
      return;
    }
    setState('applied');
    setStatusMessage(t('definition.applied'));
    window.location.assign(
      workTabHref(workId, 'definition', undefined, originConversationId),
    );
  }

  async function runCurrentVersion() {
    if (!isCurrentVersion) return;
    setState('running');
    setStatusMessage(null);
    try {
      const workRunId = (await workRunClient.start(workId)).work_run.id;
      window.location.assign(
        workTabHref(workId, 'overview', workRunId, originConversationId),
      );
    } catch (reason) {
      setState('error');
      setRunBlocked(isPermanentRunFailure(reason));
      setStatusMessage(workRunFailureMessage(reason));
    }
  }

  return (
    <section className="work-definition" data-testid="definition-viewer">
      <div className="work-section-heading work-definition__heading">
        <div>
          <p className="work-shell-kicker">{t('work.tab.definition')}</p>
          <h2>{name}</h2>
          <p>
            {editable ? t('definition.editHint') : t('definition.historyHint')}
          </p>
        </div>
        <span className="work-definition__version-chip">
          {isCurrentVersion
            ? t('definition.currentVersion')
            : t('definition.historicalVersion')}
        </span>
      </div>

      {editable ? (
        <div
          className="work-definition__authoring"
          data-testid="definition-authoring"
        >
          <div className="work-definition__editor-column">
            <div className="work-definition__editor-heading">
              <div>
                <h3>{t('definition.yaml')}</h3>
                <p>{t('definition.yamlHint')}</p>
              </div>
              <span>
                {t('definition.characters', {
                  count: source.length.toLocaleString(),
                })}
              </span>
            </div>
            <textarea
              aria-label={t('definition.sourceLabel')}
              className="work-definition__source"
              data-testid="definition-source-editor"
              onChange={(event) => {
                setSource(event.target.value);
                setState('idle');
                setPlan(null);
                setDiagnostics([]);
                setStatusMessage(null);
              }}
              spellCheck={false}
              value={source}
            />
            <div className="work-definition__actions">
              <button
                disabled={
                  state === 'validating' ||
                  state === 'applying' ||
                  state === 'running'
                }
                onClick={() => void validateAndPlan()}
                type="button"
              >
                {state === 'validating'
                  ? t('definition.validating')
                  : t('definition.validate')}
              </button>
              <button
                className="work-definition__primary-action"
                disabled={
                  state === 'validating' ||
                  state === 'applying' ||
                  state === 'running'
                }
                onClick={() => void applyDefinition()}
                type="button"
              >
                {state === 'applying'
                  ? t('definition.applying')
                  : t('definition.apply')}
              </button>
              <button
                disabled={
                  !isCurrentVersion ||
                  state === 'running' ||
                  state === 'applying' ||
                  runBlocked
                }
                onClick={() => void runCurrentVersion()}
                type="button"
              >
                {state === 'running'
                  ? t('work.run.starting')
                  : runBlocked
                    ? t('work.run.cantStart')
                    : t('definition.runCurrent')}
              </button>
            </div>
            {statusMessage ? (
              <p
                aria-live="polite"
                className={`work-definition__status work-definition__status--${state}`}
                data-testid="definition-authoring-status"
              >
                {statusMessage}
              </p>
            ) : null}
            {diagnostics.length ? (
              <ul
                className="work-definition__diagnostics"
                data-testid="definition-diagnostics"
              >
                {diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.path}:${diagnostic.code}:${index}`}>
                    <code>{diagnostic.path}</code>
                    <strong>{diagnostic.code}</strong>
                    <span>{diagnostic.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <DefinitionPlanPreview
            fallbackKind={kind}
            plan={plan}
            participants={participants}
          />
        </div>
      ) : null}

      <dl className="work-definition__facts">
        <Fact label={t('definition.status')} value={humanize(version.status)} />
        <Fact label={t('definition.composition')} value={humanize(kind)} />
        <Fact label={t('definition.versionRef')} value={version.id} code />
        <Fact
          label={t('definition.fingerprint')}
          value={version.fingerprint}
          code
        />
        <Fact
          label={t('definition.manifest')}
          value={
            version.resolved.resource_manifest_fingerprint ??
            t('trace.notCaptured')
          }
          code={version.resolved.resource_manifest_fingerprint !== null}
        />
        <Fact
          label={t('tasks.descriptionLabel')}
          value={description ?? t('definition.noDescription')}
        />
        <Fact
          label={t('definition.environment')}
          value={environment.label}
          code={environment.code}
        />
      </dl>
      {!editable ? (
        <div className="work-definition__agents">
          <h3>{t('authoring.participants')}</h3>
          <ParticipantList participants={participants} />
        </div>
      ) : null}
    </section>
  );
}

function DefinitionPlanPreview({
  fallbackKind,
  plan,
  participants,
}: {
  readonly fallbackKind: string;
  readonly plan: Plan | null;
  readonly participants: readonly ParticipantView[];
}) {
  const previewParticipants =
    plan?.resolved.participants ??
    participants.map((participant) => ({
      name: participant.name,
      role: participant.role,
      source: participant.versionId
        ? ('referenced' as const)
        : ('inline' as const),
      workerVersionId: participant.versionId,
      skills: [] as readonly string[],
      tools: [] as readonly string[],
    }));
  return (
    <aside
      className="work-definition__preview"
      aria-label={t('definition.preview')}
    >
      <p className="work-shell-kicker">{t('definition.structuredPreview')}</p>
      <h3>{humanize(plan?.resolved.kind ?? fallbackKind)}</h3>
      <p>
        {plan ? t('definition.previewResolved') : t('definition.previewHint')}
      </p>
      <h4>{t('trace.sessions.workerFilter')}</h4>
      <ul>
        {previewParticipants.map((participant) => (
          <li key={`${participant.role}:${participant.name}`}>
            <strong>{participant.name}</strong>
            <span>
              {humanize(participant.role)} · {humanize(participant.source)}
            </span>
            {participant.workerVersionId ? (
              <code>{participant.workerVersionId}</code>
            ) : null}
          </li>
        ))}
      </ul>
      {plan ? (
        <>
          <h4>{t('definition.environment')}</h4>
          <p>
            {plan.resolved.environment.environmentVersionId ??
              t('definition.environmentSource', {
                source: humanize(plan.resolved.environment.source),
              })}
          </p>
          <h4>{t('definition.runtime')}</h4>
          <p>
            {plan.resolved.requiredRuntimeCapabilities.length
              ? plan.resolved.requiredRuntimeCapabilities.join(' · ')
              : t('definition.noRuntime')}
          </p>
          <h4>{t('authoring.platform')}</h4>
          <p>
            {plan.resolved.platformCapabilities.length
              ? plan.resolved.platformCapabilities.join(' · ')
              : t('definition.noPlatform')}
          </p>
          <h4>{t('definition.memory')}</h4>
          <p>
            {t('definition.bindings', {
              count: plan.resolved.memoryVersionIds.length,
            })}
          </p>
        </>
      ) : null}
    </aside>
  );
}

function ParticipantList({
  participants,
}: {
  readonly participants: readonly ParticipantView[];
}) {
  return participants.length > 0 ? (
    <ul>
      {participants.map((participant) => (
        <li key={`${participant.role}:${participant.name}`}>
          <strong>
            {participant.name} · {humanize(participant.role)}
          </strong>
          {participant.versionId ? (
            <code>{participant.versionId}</code>
          ) : (
            <span>{t('definition.inlineWorker')}</span>
          )}
        </li>
      ))}
    </ul>
  ) : (
    <p>{t('definition.noParticipants')}</p>
  );
}

function Fact({
  label,
  value,
  code = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly code?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

type ParticipantView = {
  readonly name: string;
  readonly role: 'primary' | 'lead' | 'member';
  readonly versionId: string | null;
};

function participantsFromSource(
  kind: string,
  spec: Readonly<Record<string, unknown>> | null,
): readonly ParticipantView[] {
  if (!spec) return [];
  if (kind === 'single_worker')
    return [
      {
        name: t('definition.primaryWorker'),
        role: 'primary',
        versionId: stringValue(spec.worker_version_id),
      },
    ];
  if (kind !== 'collaboration') return [];

  const lead = asRecord(spec.lead);
  const members = Array.isArray(spec.members) ? spec.members : [];
  const result: ParticipantView[] = [];
  if (lead)
    result.push({
      name: stringValue(lead.name) ?? t('authoring.lead'),
      role: 'lead',
      versionId: stringValue(lead.worker_version_id),
    });
  for (const item of members) {
    const member = asRecord(item);
    if (!member) continue;
    result.push({
      name: stringValue(member.name) ?? t('definition.member'),
      role: 'member',
      versionId: stringValue(member.worker_version_id),
    });
  }
  return result;
}

function resourceBinding(
  spec: Readonly<Record<string, unknown>> | null,
  versionKey: string,
  inlineKey: string,
): { readonly label: string; readonly code: boolean } {
  if (!spec) return { label: t('trace.notCaptured'), code: false };
  const versionId = stringValue(spec[versionKey]);
  if (versionId) return { label: versionId, code: true };
  if (asRecord(spec[inlineKey]))
    return { label: t('definition.inlineResource'), code: false };
  return { label: t('trace.notCaptured'), code: false };
}

export function diagnosticsFrom(value: unknown): DefinitionDiagnostics {
  const record = asRecord(value);
  if (!Array.isArray(record?.diagnostics)) return [];
  return record.diagnostics.flatMap((item) => {
    const diagnostic = asRecord(item);
    return typeof diagnostic?.path === 'string' &&
      typeof diagnostic.code === 'string' &&
      typeof diagnostic.message === 'string'
      ? [
          {
            path: diagnostic.path,
            code: diagnostic.code,
            message: diagnostic.message,
          },
        ]
      : [];
  });
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
