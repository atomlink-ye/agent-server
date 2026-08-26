import { useEffect, useMemo, useState } from 'react';
import { diagnosticsFrom } from '@/features/work/components/definition-panel';
import { workTabHref } from '@/features/work/components/work-presentation';
import {
  type DefinitionDiagnostics,
  type DefinitionPlan,
  workDefinitionClient,
} from '@/features/work/clients/work-definition-client';
import { workClient } from '@/features/work/clients/work-client';
import { workRunClient } from '@/features/work/clients/work-run-client';
import {
  loadCoworkers,
  loadCoworkerProfile,
  type CoworkerProfile,
} from '@/features/agents/agents-gateway';
import type {
  CapabilityInputProperty,
  Coworker,
  CoworkerCapability,
} from '@/features/agents/contracts';
import { ApiTransportError } from '@/api/transport';

type StartState = 'idle' | 'loading' | 'creating' | 'starting' | 'error';
type AuthoringState =
  | 'idle'
  | 'validating'
  | 'valid'
  | 'applying'
  | 'applied'
  | 'error';

export function NewWork({
  originConversationId = null,
  initialAgentId = null,
  initialCapabilityVersionId = null,
}: {
  readonly originConversationId?: string | null;
  readonly initialAgentId?: string | null;
  readonly initialCapabilityVersionId?: string | null;
}) {
  const [coworkers, setCoworkers] = useState<readonly Coworker[]>([]);
  const [agentId, setAgentId] = useState(initialAgentId ?? '');
  const [profile, setProfile] = useState<CoworkerProfile | null>(null);
  const [capabilityVersionId, setCapabilityVersionId] = useState(
    initialCapabilityVersionId ?? '',
  );
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<StartState>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [createdWorkId, setCreatedWorkId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadCoworkers().then(
      (items) => {
        if (!active) return;
        setCoworkers(items);
        const selected = initialAgentId && items.some((item) => item.id === initialAgentId)
          ? initialAgentId
          : items[0]?.id ?? '';
        setAgentId((current) => current || selected);
        setState('idle');
      },
      (reason: unknown) => {
        if (!active) return;
        setState('error');
        setMessage(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [initialAgentId]);

  useEffect(() => {
    if (!agentId) {
      setProfile(null);
      setCapabilityVersionId('');
      return;
    }
    let active = true;
    setState('loading');
    setMessage(null);
    void loadCoworkerProfile(agentId).then(
      (next) => {
        if (!active) return;
        setProfile(next);
        const requested =
          initialCapabilityVersionId &&
          next.workCatalog.some(
            (item) => item.definitionVersionId === initialCapabilityVersionId,
          )
            ? initialCapabilityVersionId
            : next.workCatalog[0]?.definitionVersionId ?? '';
        setCapabilityVersionId(requested);
        setState('idle');
      },
      (reason: unknown) => {
        if (!active) return;
        setState('error');
        setMessage(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [agentId, initialCapabilityVersionId]);

  const capability = useMemo(
    () =>
      profile?.workCatalog.find(
        (item) => item.definitionVersionId === capabilityVersionId,
      ) ?? null,
    [capabilityVersionId, profile],
  );

  useEffect(() => {
    setValues({});
    setCreatedWorkId(null);
    setMessage(null);
    if (capability) setTitle(humanize(capability.name));
  }, [capability]);

  async function startWork(): Promise<void> {
    if (!capability || !title.trim() || state === 'creating' || state === 'starting')
      return;
    setState('creating');
    setMessage('Creating the Work record…');
    setCreatedWorkId(null);
    let workId: string;
    try {
      const created = await workClient.create({
        definitionId: capability.definitionId,
        definitionVersionId: capability.definitionVersionId,
        title: title.trim(),
      });
      workId = created.work.id;
      setCreatedWorkId(workId);
    } catch (reason) {
      setState('error');
      setMessage(
        `Work was not created. ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      return;
    }

    setState('starting');
    setMessage('Work created. Starting the first Run…');
    try {
      const run = await workRunClient.start(workId, buildInput(capability, values));
      window.location.assign(
        workTabHref(
          workId,
          'overview',
          run.work_run.id,
          originConversationId,
        ),
      );
    } catch (reason) {
      setState('error');
      setMessage(
        `The Work was created, but its Run did not start. ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
  }

  return (
    <section className="new-work-form" data-testid="new-work-form">
      <div className="new-work-form__heading">
        <span className="eyebrow">New Work</span>
        <h2>Start formal Work</h2>
        <p>Choose a Coworker and one of its saved Capabilities, then fill the typed input contract.</p>
      </div>

      <div className="new-work-form__content">
        <div className="new-work-form__column">
          <div className="new-work-form__field">
            <label htmlFor="work-coworker">Coworker</label>
            <select
              id="work-coworker"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              disabled={state === 'creating' || state === 'starting'}
            >
              <option value="">Choose a Coworker…</option>
              {coworkers.map((coworker) => (
                <option key={coworker.id} value={coworker.id}>
                  {coworker.displayName} · {coworker.roleLabel ?? 'Coworker'}
                </option>
              ))}
            </select>
          </div>

          <div className="new-work-form__field">
            <label htmlFor="work-capability">Capability</label>
            <select
              id="work-capability"
              value={capabilityVersionId}
              onChange={(event) => setCapabilityVersionId(event.target.value)}
              disabled={!profile || state === 'creating' || state === 'starting'}
            >
              <option value="">Choose what this Coworker should do…</option>
              {profile?.workCatalog.map((item) => (
                <option key={item.definitionVersionId} value={item.definitionVersionId}>
                  {humanize(item.name)}
                </option>
              ))}
            </select>
            {profile && profile.workCatalog.length === 0 ? (
              <p className="new-work-form__hint">
                This Coworker has no formal Capabilities yet. Add one from the Agents page first.
              </p>
            ) : null}
          </div>

          {capability ? (
            <>
              <div className="new-work-form__capability-summary">
                <strong>{humanize(capability.name)}</strong>
                <p>{capability.description ?? 'Formal Work capability'}</p>
              </div>
              <div className="new-work-form__field">
                <label htmlFor="work-title">Work Title</label>
                <input
                  id="work-title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={state === 'creating' || state === 'starting'}
                />
              </div>
              <TypedInputs
                capability={capability}
                values={values}
                disabled={state === 'creating' || state === 'starting'}
                onChange={(key, value) =>
                  setValues((current) => ({ ...current, [key]: value }))
                }
              />
              <div className="new-work-form__actions">
                <button
                  type="button"
                  className="new-work-form__submit"
                  data-testid="new-work-submit"
                  disabled={!title.trim() || state === 'creating' || state === 'starting'}
                  onClick={() => void startWork()}
                >
                  {state === 'creating'
                    ? 'Creating Work…'
                    : state === 'starting'
                      ? 'Starting Run…'
                      : 'Start Work'}
                </button>
              </div>
            </>
          ) : null}

          {message ? (
            <div
              className={`new-work-form__status new-work-form__status--${state}`}
              role={state === 'error' ? 'alert' : 'status'}
              data-testid="new-work-status"
            >
              <p>{message}</p>
              {state === 'error' && createdWorkId ? (
                <a href={workTabHref(createdWorkId, 'overview', undefined, originConversationId)}>
                  Open the created Work
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <details className="new-work-form__advanced">
        <summary>Advanced · author raw WorkDefinition source</summary>
        <AdvancedDefinitionAuthoring originConversationId={originConversationId} />
      </details>
    </section>
  );
}

function TypedInputs({
  capability,
  values,
  disabled,
  onChange,
}: {
  readonly capability: CoworkerCapability;
  readonly values: Readonly<Record<string, unknown>>;
  readonly disabled: boolean;
  readonly onChange: (key: string, value: unknown) => void;
}) {
  const entries = Object.entries(capability.inputSchema.properties);
  if (!entries.length) return <p className="new-work-form__hint">This Capability needs no input.</p>;
  return (
    <div className="new-work-form__typed-inputs">
      <h3>Inputs</h3>
      {entries.map(([key, property]) => (
        <TypedInput
          key={key}
          name={key}
          property={property}
          required={capability.inputSchema.required.includes(key)}
          value={values[key]}
          disabled={disabled}
          onChange={(value) => onChange(key, value)}
        />
      ))}
    </div>
  );
}

function TypedInput({
  name,
  property,
  required,
  value,
  disabled,
  onChange,
}: {
  readonly name: string;
  readonly property: CapabilityInputProperty;
  readonly required: boolean;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onChange: (value: unknown) => void;
}) {
  const label = humanize(name);
  if (property.type === 'boolean') {
    return (
      <label className="new-work-form__boolean">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}{required ? ' *' : ''}
      </label>
    );
  }
  if (property.type === 'string' && property.choices?.length) {
    return (
      <div className="new-work-form__field">
        <label htmlFor={`work-input-${name}`}>{label}{required ? ' *' : ''}</label>
        <select
          id={`work-input-${name}`}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {property.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className="new-work-form__field">
      <label htmlFor={`work-input-${name}`}>{label}{required ? ' *' : ''}</label>
      <input
        id={`work-input-${name}`}
        type={property.type === 'string' ? 'text' : 'number'}
        step={property.type === 'integer' ? '1' : property.type === 'number' ? 'any' : undefined}
        min={property.type === 'string' ? undefined : property.minimum}
        max={property.type === 'string' ? undefined : property.maximum}
        minLength={property.type === 'string' ? property.minLength : undefined}
        maxLength={property.type === 'string' ? property.maxLength : undefined}
        required={required}
        disabled={disabled}
        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function buildInput(
  capability: CoworkerCapability,
  values: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(capability.inputSchema.properties)) {
    const raw = values[key];
    if (property.type === 'boolean') {
      if (raw !== undefined || capability.inputSchema.required.includes(key))
        input[key] = raw === true;
      continue;
    }
    if (raw === undefined || raw === '') continue;
    if (property.type === 'number' || property.type === 'integer') {
      const parsed = Number(raw);
      input[key] = parsed;
      continue;
    }
    input[key] = String(raw);
  }
  return input;
}

function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function AdvancedDefinitionAuthoring({
  originConversationId,
}: {
  readonly originConversationId: string | null;
}) {
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [state, setState] = useState<AuthoringState>('idle');
  const [diagnostics, setDiagnostics] = useState<DefinitionDiagnostics>([]);
  const [plan, setPlan] = useState<DefinitionPlan | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function validateAndPlan(): Promise<DefinitionPlan | null> {
    setState('validating');
    setDiagnostics([]);
    setPlan(null);
    setStatusMessage(null);
    try {
      const validation = await workDefinitionClient.validate(source);
      if (!validation.fingerprint) throw new Error('Definition did not produce a fingerprint.');
      const planned = await workDefinitionClient.plan(source);
      setPlan(planned);
      setState('valid');
      setStatusMessage('Definition is valid and its resource plan resolved.');
      return planned;
    } catch (error) {
      const nextDiagnostics = diagnosticsFrom(
        error instanceof ApiTransportError ? error.payload : undefined,
      );
      setDiagnostics(nextDiagnostics);
      setState('error');
      setStatusMessage(
        nextDiagnostics.length
          ? 'Fix the reported Definition diagnostics before applying.'
          : error instanceof Error
            ? error.message
            : 'The Definition could not be validated.',
      );
      return null;
    }
  }

  async function applyDefinition(): Promise<void> {
    const resolved = await validateAndPlan();
    if (!resolved) return;
    setState('applying');
    try {
      const applied = await workDefinitionClient.apply(source);
      setState('applied');
      const created = await workClient.create({
        definitionId: applied.definitionId,
        definitionVersionId: applied.versionId,
        title,
      });
      window.location.assign(
        workTabHref(created.work.id, 'definition', undefined, originConversationId),
      );
    } catch (error) {
      setState('error');
      setStatusMessage(error instanceof Error ? error.message : 'The Definition was not applied.');
    }
  }

  return (
    <div className="new-work-form__advanced-editor">
      <p>Developer escape hatch. This still uses the exact canonical validate → plan → apply pipeline.</p>
      <div className="new-work-form__field"><label>Work Title</label><input value={title} onChange={(event) => setTitle(event.target.value)} /></div>
      <div className="new-work-form__field"><label>Definition YAML / JSON</label><textarea value={source} rows={14} spellCheck={false} onChange={(event) => { setSource(event.target.value); setState('idle'); setPlan(null); setDiagnostics([]); setStatusMessage(null); }} /></div>
      {plan ? <p className="new-work-form__hint">Resolved {plan.resolved.participants.length} Worker participant(s).</p> : null}
      {diagnostics.length ? <ul className="new-work-form__diagnostics">{diagnostics.map((diagnostic, index) => <li key={`${diagnostic.path}:${index}`}><code>{diagnostic.path}</code><strong>{diagnostic.code}</strong><span>{diagnostic.message}</span></li>)}</ul> : null}
      {statusMessage ? <p className={`new-work-form__status new-work-form__status--${state}`}>{statusMessage}</p> : null}
      <button type="button" disabled={!title.trim() || !source.trim() || state === 'validating' || state === 'applying'} onClick={() => void applyDefinition()}>{state === 'applying' ? 'Creating…' : 'Apply Definition & create Work'}</button>
    </div>
  );
}
