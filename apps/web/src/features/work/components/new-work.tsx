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
  'idle' | 'validating' | 'valid' | 'applying' | 'applied' | 'error';

export function NewWork({
  originConversationId = null,
  initialAgentId = null,
  initialCapabilityVersionId = null,
}: {
  readonly originConversationId?: string | null;
  readonly initialAgentId?: string | null;
  readonly initialCapabilityVersionId?: string | null;
}) {
  const navigate = (path: string): void => {
    window.location.assign(path);
  };
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
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [createdWorkId, setCreatedWorkId] = useState<string | null>(null);
  const [rosterAttempt, setRosterAttempt] = useState(0);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [invalidField, setInvalidField] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadCoworkers().then(
      (items) => {
        if (!active) return;
        setCoworkers(items);
        const requestedAgentAvailable =
          initialAgentId !== null &&
          items.some((item) => item.id === initialAgentId);
        const hasDeepLink = Boolean(
          initialAgentId || initialCapabilityVersionId,
        );
        const selected = hasDeepLink
          ? requestedAgentAvailable
            ? initialAgentId!
            : ''
          : (items[0]?.id ?? '');
        setAgentId((current) => (hasDeepLink ? selected : current || selected));
        if (hasDeepLink && !requestedAgentAvailable) {
          setSelectionNotice(
            'That Coworker is no longer available. Choose a Coworker to continue, or create a new one.',
          );
          setCapabilityVersionId('');
        }
        setState('idle');
      },
      (reason: unknown) => {
        if (!active) return;
        setState('error');
        setMessage('Coworkers could not be loaded. Try again.');
      },
    );
    return () => {
      active = false;
    };
  }, [initialAgentId, initialCapabilityVersionId, rosterAttempt]);

  useEffect(() => {
    if (!agentId) {
      setProfile(null);
      setCapabilityVersionId('');
      return;
    }
    let active = true;
    setState('loading');
    setMessage(null);
    setProfile(null);
    setCapabilityVersionId('');
    void loadCoworkerProfile(agentId).then(
      (next) => {
        if (!active) return;
        setProfile(next);
        const requestedAvailable =
          initialCapabilityVersionId !== null &&
          next.workCatalog.some(
            (item) => item.definitionVersionId === initialCapabilityVersionId,
          );
        const preserveRequestedCapability = Boolean(initialCapabilityVersionId);
        const requested = preserveRequestedCapability
          ? requestedAvailable
            ? initialCapabilityVersionId!
            : ''
          : (next.workCatalog[0]?.definitionVersionId ?? '');
        setCapabilityVersionId(requested);
        if (initialCapabilityVersionId && !requestedAvailable) {
          setSelectionNotice(
            'That Capability is no longer available for this Coworker. Choose another Capability, or add it again from the Coworker profile.',
          );
        }
        setState('idle');
      },
      (reason: unknown) => {
        if (!active) return;
        setState('error');
        setMessage('This Coworker could not be loaded. Try again.');
      },
    );
    return () => {
      active = false;
    };
  }, [agentId, initialAgentId, initialCapabilityVersionId, profileAttempt]);

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
    setInvalidField(null);
    if (capability) {
      setSelectionNotice(null);
      setTitle(humanize(capability.name));
    }
  }, [capability]);

  useEffect(() => {
    if (!invalidField) return;
    document
      .getElementById(
        invalidField === 'title' ? 'work-title' : `work-input-${invalidField}`,
      )
      ?.focus();
  }, [invalidField]);

  function retryLoad(): void {
    setMessage(null);
    setSelectionNotice(null);
    setRosterAttempt((value) => value + 1);
    setProfileAttempt((value) => value + 1);
  }

  async function startWork(): Promise<void> {
    if (!capability || state === 'creating' || state === 'starting') return;
    const validation = validateFriendlyInput(capability, values, title);
    if (validation) {
      setState('error');
      setInvalidField(validation.field);
      setMessage(validation.message);
      return;
    }
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
      await startRun(workId);
    } catch (reason) {
      setState('error');
      setMessage(
        `The Work was created, but its Run did not start. ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
  }

  async function startRun(workId: string): Promise<void> {
    setState('starting');
    setMessage('Work created. Starting the first Run…');
    try {
      const run = await workRunClient.start(
        workId,
        buildInput(capability!, values),
      );
      window.location.assign(
        workTabHref(workId, 'overview', run.work_run.id, originConversationId),
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
        <p>
          Choose a Coworker and one of its saved Capabilities, then answer a few
          questions to start the Work.
        </p>
      </div>

      <div className="new-work-form__content">
        <div className="new-work-form__column">
          <div className="new-work-form__field">
            <label htmlFor="work-coworker">Coworker</label>
            <select
              id="work-coworker"
              value={agentId}
              onChange={(event) => {
                setAgentId(event.target.value);
                setSelectionNotice(null);
                setMessage(null);
              }}
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
              onChange={(event) => {
                setCapabilityVersionId(event.target.value);
                setSelectionNotice(null);
                setMessage(null);
              }}
              disabled={
                !profile || state === 'creating' || state === 'starting'
              }
            >
              <option value="">Choose what this Coworker should do…</option>
              {profile?.workCatalog.map((item) => (
                <option
                  key={item.definitionVersionId}
                  value={item.definitionVersionId}
                >
                  {humanize(item.name)}
                </option>
              ))}
            </select>
            {profile && profile.workCatalog.length === 0 ? (
              <div className="new-work-form__hint">
                This Coworker has no formal Capabilities yet. Add one from the
                Coworker profile.
                <button
                  type="button"
                  className="new-work-form__link"
                  onClick={() =>
                    navigate(`/agents/${encodeURIComponent(agentId)}`)
                  }
                >
                  Add a Capability
                </button>
              </div>
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
                  aria-invalid={invalidField === 'title'}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setInvalidField(null);
                  }}
                  disabled={state === 'creating' || state === 'starting'}
                />
              </div>
              <TypedInputs
                capability={capability}
                values={values}
                invalidField={invalidField}
                disabled={state === 'creating' || state === 'starting'}
                onChange={(key, value) => {
                  setInvalidField(null);
                  setValues((current) => ({ ...current, [key]: value }));
                }}
              />
              <div className="new-work-form__actions">
                <button
                  type="button"
                  className="new-work-form__submit"
                  data-testid="new-work-submit"
                  disabled={state === 'creating' || state === 'starting'}
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

          {selectionNotice ? (
            <div
              className="new-work-form__status new-work-form__status--error"
              role="alert"
            >
              <p>{selectionNotice}</p>
              {coworkers.length === 0 ? (
                <button type="button" onClick={() => navigate('/agents')}>
                  Create a Coworker
                </button>
              ) : null}
            </div>
          ) : null}

          {state === 'idle' && coworkers.length === 0 ? (
            <div
              className="new-work-form__status new-work-form__status--error"
              role="status"
            >
              <p>No Coworkers are available yet. Create one to begin.</p>
              <button type="button" onClick={() => navigate('/agents')}>
                Create a Coworker
              </button>
            </div>
          ) : null}

          {message ? (
            <div
              className={`new-work-form__status new-work-form__status--${state}`}
              role={state === 'error' ? 'alert' : 'status'}
              data-testid="new-work-status"
            >
              <p>{message}</p>
              {state === 'error' && createdWorkId ? (
                <div className="new-work-form__recovery">
                  <a
                    href={workTabHref(
                      createdWorkId,
                      'overview',
                      undefined,
                      originConversationId,
                    )}
                  >
                    Open the created Work
                  </a>
                  <button
                    type="button"
                    onClick={() => void startRun(createdWorkId)}
                  >
                    Retry Run
                  </button>
                </div>
              ) : null}
              {state === 'error' && !createdWorkId && !capability ? (
                <div className="new-work-form__recovery">
                  <button type="button" onClick={retryLoad}>
                    Try again
                  </button>
                  <button type="button" onClick={() => navigate('/agents')}>
                    Create a Coworker
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <details className="new-work-form__advanced">
        <summary>Advanced · author raw WorkDefinition source</summary>
        <AdvancedDefinitionAuthoring
          originConversationId={originConversationId}
        />
      </details>
    </section>
  );
}

function TypedInputs({
  capability,
  values,
  invalidField,
  disabled,
  onChange,
}: {
  readonly capability: CoworkerCapability;
  readonly values: Readonly<Record<string, unknown>>;
  readonly invalidField: string | null;
  readonly disabled: boolean;
  readonly onChange: (key: string, value: unknown) => void;
}) {
  const entries = Object.entries(capability.inputSchema.properties);
  if (!entries.length)
    return (
      <p className="new-work-form__hint">This Capability needs no input.</p>
    );
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
          invalid={invalidField === key}
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
  invalid,
  disabled,
  onChange,
}: {
  readonly name: string;
  readonly property: CapabilityInputProperty;
  readonly required: boolean;
  readonly value: unknown;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: unknown) => void;
}) {
  const label = humanize(name);
  if (property.type === 'boolean') {
    return (
      <div className="new-work-form__field">
        <label htmlFor={`work-input-${name}`}>
          {label}
          {required ? ' *' : ''}
        </label>
        <select
          id={`work-input-${name}`}
          value={value === true ? 'true' : value === false ? 'false' : ''}
          aria-invalid={invalid}
          disabled={disabled}
          required={required}
          onChange={(event) =>
            onChange(
              event.target.value === ''
                ? undefined
                : event.target.value === 'true',
            )
          }
        >
          <option value="">Choose…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>
    );
  }
  if (property.type === 'string' && property.choices?.length) {
    return (
      <div className="new-work-form__field">
        <label htmlFor={`work-input-${name}`}>
          {label}
          {required ? ' *' : ''}
        </label>
        <select
          id={`work-input-${name}`}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {property.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="new-work-form__field">
      <label htmlFor={`work-input-${name}`}>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        id={`work-input-${name}`}
        type={property.type === 'string' ? 'text' : 'number'}
        step={
          property.type === 'integer'
            ? '1'
            : property.type === 'number'
              ? 'any'
              : undefined
        }
        min={property.type === 'string' ? undefined : property.minimum}
        max={property.type === 'string' ? undefined : property.maximum}
        minLength={property.type === 'string' ? property.minLength : undefined}
        maxLength={property.type === 'string' ? property.maxLength : undefined}
        required={required}
        aria-invalid={invalid}
        disabled={disabled}
        value={
          typeof value === 'string' || typeof value === 'number' ? value : ''
        }
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
  for (const [key, property] of Object.entries(
    capability.inputSchema.properties,
  )) {
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

interface FriendlyInputError {
  readonly field: string;
  readonly message: string;
}

export function validateFriendlyInput(
  capability: CoworkerCapability,
  values: Readonly<Record<string, unknown>>,
  title: string,
): FriendlyInputError | null {
  if (!title.trim())
    return { field: 'title', message: 'Add a title for this Work.' };

  for (const [key, property] of Object.entries(
    capability.inputSchema.properties,
  )) {
    const label = humanize(key);
    const raw = values[key];
    const missing =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim() === '');
    if (capability.inputSchema.required.includes(key) && missing)
      return { field: key, message: `Complete the required input: ${label}.` };
    if (missing) continue;

    if (property.type === 'string') {
      const value = String(raw);
      if (property.minLength !== undefined && value.length < property.minLength)
        return {
          field: key,
          message: `${label} must be at least ${property.minLength} characters.`,
        };
      if (property.maxLength !== undefined && value.length > property.maxLength)
        return {
          field: key,
          message: `${label} must be at most ${property.maxLength} characters.`,
        };
      if (property.choices?.length && !property.choices.includes(value))
        return {
          field: key,
          message: `${label} must use one of the available choices.`,
        };
      continue;
    }

    if (property.type === 'boolean') {
      if (typeof raw !== 'boolean')
        return { field: key, message: `${label} must be Yes or No.` };
      continue;
    }

    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(numeric))
      return { field: key, message: `${label} must be a number.` };
    if (property.type === 'integer' && !Number.isInteger(numeric))
      return { field: key, message: `${label} must be a whole number.` };
    if (property.minimum !== undefined && numeric < property.minimum)
      return {
        field: key,
        message: `${label} must be at least ${property.minimum}.`,
      };
    if (property.maximum !== undefined && numeric > property.maximum)
      return {
        field: key,
        message: `${label} must be at most ${property.maximum}.`,
      };
  }
  return null;
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
      if (!validation.fingerprint)
        throw new Error('Definition did not produce a fingerprint.');
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
        workTabHref(
          created.work.id,
          'definition',
          undefined,
          originConversationId,
        ),
      );
    } catch (error) {
      setState('error');
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'The Definition was not applied.',
      );
    }
  }

  return (
    <div className="new-work-form__advanced-editor">
      <p>
        Developer escape hatch. This still uses the exact canonical validate →
        plan → apply pipeline.
      </p>
      <div className="new-work-form__field">
        <label htmlFor="work-title">Work Title</label>
        <input
          id="work-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="new-work-form__field">
        <label htmlFor="work-definition">Definition YAML / JSON</label>
        <textarea
          id="work-definition"
          value={source}
          rows={14}
          spellCheck={false}
          onChange={(event) => {
            setSource(event.target.value);
            setState('idle');
            setPlan(null);
            setDiagnostics([]);
            setStatusMessage(null);
          }}
        />
      </div>
      {plan ? (
        <p className="new-work-form__hint">
          Resolved {plan.resolved.participants.length} Worker participant(s).
        </p>
      ) : null}
      {diagnostics.length ? (
        <ul className="new-work-form__diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.path}:${index}`}>
              <code>{diagnostic.path}</code>
              <strong>{diagnostic.code}</strong>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {statusMessage ? (
        <p className={`new-work-form__status new-work-form__status--${state}`}>
          {statusMessage}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="new-work-submit"
        disabled={
          !title.trim() ||
          !source.trim() ||
          state === 'validating' ||
          state === 'applying'
        }
        onClick={() => void applyDefinition()}
      >
        {state === 'applying' ? 'Creating…' : 'Apply Definition & create Work'}
      </button>
    </div>
  );
}
