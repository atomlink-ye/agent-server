'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

import { humanize, workTabHref } from '@/components/work/work-presentation';

type Diagnostic = {
  readonly path: string;
  readonly code: string;
  readonly message: string;
};

type Plan = {
  readonly fingerprint: string;
  readonly resolved: {
    readonly kind: 'single_agent' | 'collaboration';
    readonly participants: readonly {
      readonly name: string;
      readonly role: 'primary' | 'lead' | 'member';
      readonly source: 'referenced' | 'inline';
      readonly agent_version_id: string | null;
      readonly skills: readonly string[];
      readonly tools: readonly string[];
    }[];
    readonly environment: {
      readonly source: 'referenced' | 'inline';
      readonly environment_version_id: string | null;
    };
    readonly memory_version_ids: readonly string[];
    readonly required_runtime_capabilities: readonly string[];
    readonly platform_capabilities: readonly string[];
  };
};

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
}: {
  readonly workId: string;
  readonly workDefinitionId: string;
  readonly currentWorkVersionId: string;
  readonly selectedVersionId: string;
  readonly version: ProductWorkDefinitionVersionResponse | null;
  readonly editable: boolean;
}) {
  const normalizedSource = useMemo(
    () => (version ? JSON.stringify(version.source, null, 2) : ''),
    [version],
  );
  const [source, setSource] = useState(normalizedSource);
  const [state, setState] = useState<AuthoringState>('idle');
  const [diagnostics, setDiagnostics] = useState<readonly Diagnostic[]>([]);
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
        <p className="work-shell-kicker">Definition</p>
        <h2>The exact Definition version could not be loaded.</h2>
        <p>The selected Product version reference is:</p>
        <code className="work-definition-ref">{selectedVersionId}</code>
      </section>
    );

  const metadata = asRecord(version.source.metadata);
  const spec = asRecord(version.source.spec);
  const name = stringValue(metadata?.name) ?? 'Work Definition';
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
    const validation = await authoringRequest('/api/work-definitions/validate', source);
    if (!validation.ok || !isValidSuccess(validation.body)) {
      const nextDiagnostics = diagnosticsFrom(validation.body);
      setDiagnostics(nextDiagnostics);
      setStatusMessage(
        nextDiagnostics.length
          ? 'Fix the reported Definition diagnostics before applying.'
          : 'The Definition could not be validated.',
      );
      setState('error');
      return null;
    }
    const planned = await authoringRequest('/api/work-definitions/plan', source);
    if (!planned.ok || !isPlan(planned.body)) {
      const nextDiagnostics = diagnosticsFrom(planned.body);
      setDiagnostics(nextDiagnostics);
      setStatusMessage('The Definition validated, but its resource plan failed.');
      setState('error');
      return null;
    }
    setPlan(planned.body);
    setState('valid');
    setStatusMessage('Definition is valid and its resource plan resolved.');
    return planned.body;
  }

  async function applyDefinition() {
    const resolvedPlan = await validateAndPlan();
    if (!resolvedPlan) return;
    setState('applying');
    const response = await fetch('/api/work-definitions/apply', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ source }),
    }).catch(() => null);
    if (!response) {
      setState('error');
      setStatusMessage('The Definition apply request could not reach Agent Server.');
      return;
    }
    const body = await response.json().catch(() => undefined);
    if (!response.ok || !isApply(body)) {
      setDiagnostics(diagnosticsFrom(body));
      setState('error');
      setStatusMessage('The Definition was not applied.');
      return;
    }
    if (body.definition.id !== workDefinitionId) {
      setState('error');
      setStatusMessage(
        'Apply produced a different Definition lineage. Keep metadata.name on the current Work lineage before applying here.',
      );
      return;
    }
    const pinResponse = await fetch(
      `/api/works/${encodeURIComponent(workId)}/definition-version`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ definition_version_id: body.version.id }),
      },
    ).catch(() => null);
    if (!pinResponse?.ok) {
      setState('error');
      setStatusMessage(
        'A new immutable version was created, but this Work could not advance to it.',
      );
      return;
    }
    setState('applied');
    setStatusMessage('Applied and pinned as the current Work Definition version.');
    window.location.assign(workTabHref(workId, 'definition'));
  }

  async function runCurrentVersion() {
    if (!isCurrentVersion) return;
    setState('running');
    setStatusMessage(null);
    const response = await fetch(`/api/works/${encodeURIComponent(workId)}/runs`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger_kind: 'manual' }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => undefined) : undefined;
    const runId = runIdFromStart(body);
    if (!response?.ok || !runId) {
      setState('error');
      setStatusMessage('The current Definition version could not be started.');
      return;
    }
    window.location.assign(workTabHref(workId, 'overview', runId));
  }

  return (
    <section className="work-definition" data-testid="definition-viewer">
      <div className="work-section-heading work-definition__heading">
        <div>
          <p className="work-shell-kicker">Definition</p>
          <h2>{name}</h2>
          <p>
            {editable
              ? 'Edit the source, resolve it through Agent Server, then apply an immutable version.'
              : 'Historical Definition versions are immutable and remain read-only.'}
          </p>
        </div>
        <span className="work-definition__version-chip">
          {isCurrentVersion ? 'Current Work version' : 'Historical Run version'}
        </span>
      </div>

      {editable ? (
        <div className="work-definition__authoring" data-testid="definition-authoring">
          <div className="work-definition__editor-column">
            <div className="work-definition__editor-heading">
              <div>
                <h3>YAML source</h3>
                <p>
                  The API currently returns normalized source. It is seeded here as
                  JSON-compatible YAML, so original comments and formatting are not
                  round-tripped.
                </p>
              </div>
              <span>{source.length.toLocaleString()} chars</span>
            </div>
            <textarea
              aria-label="Work Definition YAML source"
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
                disabled={state === 'validating' || state === 'applying' || state === 'running'}
                onClick={() => void validateAndPlan()}
                type="button"
              >
                {state === 'validating' ? 'Validating…' : 'Validate & plan'}
              </button>
              <button
                className="work-definition__primary-action"
                disabled={state === 'validating' || state === 'applying' || state === 'running'}
                onClick={() => void applyDefinition()}
                type="button"
              >
                {state === 'applying' ? 'Applying…' : 'Apply new version'}
              </button>
              <button
                disabled={!isCurrentVersion || state === 'running' || state === 'applying'}
                onClick={() => void runCurrentVersion()}
                type="button"
              >
                {state === 'running' ? 'Starting…' : 'Run current version'}
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
              <ul className="work-definition__diagnostics" data-testid="definition-diagnostics">
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
          <DefinitionPlanPreview fallbackKind={kind} plan={plan} participants={participants} />
        </div>
      ) : null}

      <dl className="work-definition__facts">
        <Fact label="Status" value={humanize(version.status)} />
        <Fact label="Composition" value={humanize(kind)} />
        <Fact label="Version reference" value={version.id} code />
        <Fact label="Fingerprint" value={version.fingerprint} code />
        <Fact
          label="Resolved manifest"
          value={
            version.resolved.resource_manifest_fingerprint ?? 'Not captured'
          }
          code={version.resolved.resource_manifest_fingerprint !== null}
        />
        <Fact
          label="Description"
          value={description ?? 'No description captured'}
        />
        <Fact label="Environment" value={environment.label} code={environment.code} />
      </dl>
      {!editable ? (
        <div className="work-definition__agents">
          <h3>Participants</h3>
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
  const previewParticipants = plan?.resolved.participants ?? participants.map((participant) => ({
    name: participant.name,
    role: participant.role,
    source: participant.versionId ? ('referenced' as const) : ('inline' as const),
    agent_version_id: participant.versionId,
    skills: [] as readonly string[],
    tools: [] as readonly string[],
  }));
  return (
    <aside className="work-definition__preview" aria-label="Resolved Definition preview">
      <p className="work-shell-kicker">Structured preview</p>
      <h3>{humanize(plan?.resolved.kind ?? fallbackKind)}</h3>
      <p>
        {plan
          ? 'Server-resolved preview. This projection never writes back to source.'
          : 'Validate to resolve exact resource references and runtime capabilities.'}
      </p>
      <h4>Agents</h4>
      <ul>
        {previewParticipants.map((participant) => (
          <li key={`${participant.role}:${participant.name}`}>
            <strong>{participant.name}</strong>
            <span>{humanize(participant.role)} · {participant.source}</span>
            {participant.agent_version_id ? <code>{participant.agent_version_id}</code> : null}
          </li>
        ))}
      </ul>
      {plan ? (
        <>
          <h4>Environment</h4>
          <p>
            {plan.resolved.environment.environment_version_id ??
              `${plan.resolved.environment.source} environment`}
          </p>
          <h4>Runtime</h4>
          <p>
            {plan.resolved.required_runtime_capabilities.length
              ? plan.resolved.required_runtime_capabilities.join(' · ')
              : 'No additional runtime capabilities required'}
          </p>
          <h4>Platform</h4>
          <p>
            {plan.resolved.platform_capabilities.length
              ? plan.resolved.platform_capabilities.join(' · ')
              : 'No platform capability declared'}
          </p>
          <h4>Memory</h4>
          <p>{plan.resolved.memory_version_ids.length} immutable binding(s)</p>
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
            <span>Inline Agent materialized at apply</span>
          )}
        </li>
      ))}
    </ul>
  ) : (
    <p>Participant details were not captured in this author source.</p>
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
  if (kind === 'single_agent')
    return [
      {
        name: 'Primary Agent',
        role: 'primary',
        versionId: stringValue(spec.agent_version_id),
      },
    ];
  if (kind !== 'collaboration') return [];

  const lead = asRecord(spec.lead);
  const members = Array.isArray(spec.members) ? spec.members : [];
  const result: ParticipantView[] = [];
  if (lead)
    result.push({
      name: stringValue(lead.name) ?? 'Lead',
      role: 'lead',
      versionId: stringValue(lead.agent_version_id),
    });
  for (const item of members) {
    const member = asRecord(item);
    if (!member) continue;
    result.push({
      name: stringValue(member.name) ?? 'Member',
      role: 'member',
      versionId: stringValue(member.agent_version_id),
    });
  }
  return result;
}

function resourceBinding(
  spec: Readonly<Record<string, unknown>> | null,
  versionKey: string,
  inlineKey: string,
): { readonly label: string; readonly code: boolean } {
  if (!spec) return { label: 'Not captured', code: false };
  const versionId = stringValue(spec[versionKey]);
  if (versionId) return { label: versionId, code: true };
  if (asRecord(spec[inlineKey]))
    return { label: 'Inline resource materialized at apply', code: false };
  return { label: 'Not captured', code: false };
}

async function authoringRequest(path: string, source: string) {
  const response = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source }),
  }).catch(() => null);
  if (!response) return { ok: false, body: undefined } as const;
  return {
    ok: response.ok,
    body: await response.json().catch(() => undefined),
  } as const;
}

function isValidSuccess(value: unknown): value is { readonly valid: true } {
  const record = asRecord(value);
  return record?.valid === true;
}

function isPlan(value: unknown): value is Plan {
  const record = asRecord(value);
  const resolved = asRecord(record?.resolved);
  return (
    record?.valid === true &&
    typeof record.fingerprint === 'string' &&
    (resolved?.kind === 'single_agent' || resolved?.kind === 'collaboration') &&
    Array.isArray(resolved.participants)
  );
}

function isApply(value: unknown): value is {
  readonly definition: { readonly id: string };
  readonly version: { readonly id: string };
} {
  const record = asRecord(value);
  const definition = asRecord(record?.definition);
  const version = asRecord(record?.version);
  return typeof definition?.id === 'string' && typeof version?.id === 'string';
}

function diagnosticsFrom(value: unknown): readonly Diagnostic[] {
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

function runIdFromStart(value: unknown): string | null {
  const record = asRecord(value);
  const run = asRecord(record?.work_run);
  return typeof run?.id === 'string' ? run.id : null;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
