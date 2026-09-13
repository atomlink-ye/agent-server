import { useEffect, useState } from 'react';
import { diagnosticsFrom } from '@/features/work/components/definition-panel';
import {
  startedWorkRunHref,
  workTabHref,
} from '@/features/work/components/work-presentation';
import {
  type DefinitionDiagnostics,
  type DefinitionPlan,
  type WorkDefinitionCatalogEntry,
  workDefinitionClient,
} from '@/features/work/clients/work-definition-client';
import { workClient } from '@/features/work/clients/work-client';
import { workRunClient } from '@/features/work/clients/work-run-client';
import type {
  CapabilityInputProperty,
  CoworkerCapability,
} from '@/features/agents/contracts';
import { ApiTransportError } from '@/api/transport';
import { workRunFailureMessage } from '@/features/work/clients/errors';
import { isFeatureUnavailable } from '@/api/feature-availability';
import { useT, type Translate } from '@/i18n';

type StartState = 'idle' | 'loading' | 'creating' | 'starting' | 'error';
type ErrorKind =
  'validation' | 'load' | 'create' | 'start' | 'unavailable' | null;
type AuthoringState =
  'idle' | 'validating' | 'valid' | 'applying' | 'applied' | 'error';

export function NewWork({
  originConversationId = null,
  initialCapabilityVersionId = null,
  initialDefinitionId = null,
  initialDefinitionVersionId = null,
  onWorkCreated,
}: {
  readonly originConversationId?: string | null;
  readonly initialCapabilityVersionId?: string | null;
  readonly initialDefinitionId?: string | null;
  readonly initialDefinitionVersionId?: string | null;
  readonly onWorkCreated?: () => void;
}) {
  const t = useT();
  const [catalog, setCatalog] = useState<readonly WorkDefinitionCatalogEntry[]>(
    [],
  );
  const [selectedVersionId, setSelectedVersionId] = useState(
    initialDefinitionVersionId ?? initialCapabilityVersionId ?? '',
  );
  const [capability, setCapability] = useState<CoworkerCapability | null>(null);
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<StartState>('loading');
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createdWorkId, setCreatedWorkId] = useState<string | null>(null);
  const [definitionAttempt, setDefinitionAttempt] = useState(0);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const hasDefinitionLink = Boolean(
    initialDefinitionVersionId || initialCapabilityVersionId,
  );

  useEffect(() => {
    setSelectedVersionId(
      initialDefinitionVersionId ?? initialCapabilityVersionId ?? '',
    );
  }, [initialDefinitionVersionId, initialCapabilityVersionId]);

  useEffect(() => {
    if (hasDefinitionLink) return;
    let active = true;
    setState('loading');
    void workDefinitionClient.listCatalog().then(
      (items) => {
        if (!active) return;
        setCatalog(items);
        setState('idle');
      },
      () => {
        if (!active) return;
        setState('error');
        setErrorKind('load');
        setMessage(t('work.definitionLoadFailed'));
      },
    );
    return () => {
      active = false;
    };
  }, [hasDefinitionLink, definitionAttempt, t]);

  useEffect(() => {
    setCapability(null);
    if (!selectedVersionId) return;
    let active = true;
    setState('loading');
    setMessage(null);
    void workDefinitionClient.getVersion(selectedVersionId).then(
      (version) => {
        if (!active) return;
        const selected =
          version &&
          (!initialDefinitionId ||
            version.definition_id === initialDefinitionId)
            ? capabilityFromDefinition(
                version.source,
                version.id,
                version.definition_id,
              )
            : null;
        setCapability(selected);
        setState(selected ? 'idle' : 'error');
        if (!selected) {
          setErrorKind('load');
          setMessage(t('work.definitionUnavailable'));
        }
      },
      () => {
        if (!active) return;
        setState('error');
        setErrorKind('load');
        setMessage(t('work.definitionLoadFailed'));
      },
    );
    return () => {
      active = false;
    };
  }, [selectedVersionId, initialDefinitionId, definitionAttempt, t]);

  useEffect(() => {
    setValues({});
    setCreatedWorkId(null);
    setMessage(null);
    setInvalidField(null);
    setErrorKind(null);
    if (capability) {
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
    setErrorKind(null);
    setDefinitionAttempt((value) => value + 1);
  }

  async function startWork(): Promise<void> {
    if (
      !capability ||
      createdWorkId ||
      state === 'creating' ||
      state === 'starting'
    )
      return;
    const validation = validateFriendlyInput(capability, values, title, t);
    if (validation) {
      setState('error');
      setErrorKind('validation');
      setInvalidField(validation.field);
      setMessage(validation.message);
      return;
    }
    setState('creating');
    setErrorKind(null);
    setMessage(t('work.start.creatingRecord'));
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
      onWorkCreated?.();
    } catch (reason) {
      setState('error');
      if (isFeatureUnavailable(reason)) {
        // This workspace does not compose the Product Work surface at all.
        // Offering a Retry here would be a false promise, and the upstream
        // reason string is control-plane prose, not user-facing copy.
        setErrorKind('unavailable');
        setMessage(t('work.start.unavailable'));
        return;
      }
      setErrorKind('create');
      setMessage(
        t('work.start.createFailed', {
          reason: workRunFailureMessage(reason, t),
        }),
      );
      return;
    }

    setState('starting');
    setMessage(t('work.start.createdStarting'));
    try {
      await startRun(workId);
    } catch (reason) {
      setState('error');
      setErrorKind('start');
      setMessage(
        t('work.start.runFailed', { reason: workRunFailureMessage(reason, t) }),
      );
    }
  }

  async function startRun(workId: string): Promise<void> {
    setState('starting');
    setMessage(t('work.start.createdStarting'));
    try {
      const run = await workRunClient.start(
        workId,
        buildInput(capability!, values),
      );
      window.location.assign(
        startedWorkRunHref(workId, run.work_run.id, originConversationId),
      );
    } catch (reason) {
      setState('error');
      setMessage(
        t('work.start.runFailed', { reason: workRunFailureMessage(reason, t) }),
      );
    }
  }

  return (
    <section className="new-work-form" data-testid="new-work-form">
      <div className="new-work-form__heading">
        <span className="eyebrow">{t('work.start.new')}</span>
        <h2>{t('work.start.heading')}</h2>
        <p>
          {t(
            hasDefinitionLink
              ? 'work.definitionStartIntro'
              : 'work.start.chooseIntro',
          )}
        </p>
      </div>

      <div className="new-work-form__content">
        <div className="new-work-form__column">
          {!hasDefinitionLink ? (
            <div className="new-work-form__field">
              <label htmlFor="work-definition-choice">
                {t('work.tab.definition')}
              </label>
              <select
                id="work-definition-choice"
                value={selectedVersionId}
                disabled={
                  state === 'loading' ||
                  state === 'creating' ||
                  state === 'starting'
                }
                onChange={(event) => {
                  setSelectedVersionId(event.target.value);
                  setState('idle');
                  setMessage(null);
                }}
              >
                <option value="">{t('work.start.chooseDefinition')}</option>
                {catalog.map((item) => (
                  <option
                    key={item.definitionVersionId}
                    value={item.definitionVersionId}
                  >
                    {humanize(item.name)}
                  </option>
                ))}
              </select>
              {state === 'idle' && catalog.length === 0 ? (
                <p role="status">{t('work.start.noDefinitions')}</p>
              ) : null}
            </div>
          ) : null}
          {state === 'loading' ? (
            <p role="status">{t('work.detail.loading')}</p>
          ) : null}

          {capability ? (
            <>
              <div className="new-work-form__capability-summary">
                <strong>{humanize(capability.name)}</strong>
                <p>
                  {capability.description ??
                    t('work.start.fallbackDescription')}
                </p>
                <p>{t('work.definitionExecutor')}</p>
              </div>
              <div className="new-work-form__field">
                <label htmlFor="work-title">{t('work.start.workTitle')}</label>
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
                  disabled={
                    Boolean(createdWorkId) ||
                    state === 'creating' ||
                    state === 'starting'
                  }
                  onClick={() => void startWork()}
                >
                  {state === 'creating'
                    ? t('work.start.creating')
                    : state === 'starting'
                      ? t('work.start.starting')
                      : t('work.start.start')}
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
                <div className="new-work-form__recovery">
                  <a
                    href={workTabHref(
                      createdWorkId,
                      'overview',
                      undefined,
                      originConversationId,
                    )}
                  >
                    {t('work.start.openCreated')}
                  </a>
                  <button
                    type="button"
                    onClick={() => void startRun(createdWorkId)}
                  >
                    {t('work.start.retryRun')}
                  </button>
                </div>
              ) : null}
              {state === 'error' && !createdWorkId && !capability ? (
                <div className="new-work-form__recovery">
                  <button type="button" onClick={retryLoad}>
                    {t('work.start.retry')}
                  </button>
                </div>
              ) : null}
              {state === 'error' && errorKind === 'create' && capability ? (
                <div className="new-work-form__recovery">
                  <button type="button" onClick={() => void startWork()}>
                    {t('work.start.retryCreate')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <details className="new-work-form__advanced">
        <summary>{t('work.start.advanced')}</summary>
        <AdvancedDefinitionAuthoring
          originConversationId={originConversationId}
          onWorkCreated={onWorkCreated}
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
  const t = useT();
  const entries = Object.entries(capability.inputSchema.properties);
  if (!entries.length)
    return <p className="new-work-form__hint">{t('work.start.noInput')}</p>;
  return (
    <div className="new-work-form__typed-inputs">
      <h3>{t('work.start.inputs')}</h3>
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
  const t = useT();
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
          <option value="">{t('work.start.choose')}</option>
          <option value="true">{t('work.start.yes')}</option>
          <option value="false">{t('work.start.no')}</option>
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
          <option value="">{t('work.start.choose')}</option>
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
  t: Translate,
): FriendlyInputError | null {
  if (!title.trim())
    return { field: 'title', message: t('work.start.requiredTitle') };

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
      return { field: key, message: t('work.start.required', { label }) };
    if (missing) continue;

    if (property.type === 'string') {
      const value = String(raw);
      if (property.minLength !== undefined && value.length < property.minLength)
        return {
          field: key,
          message: t('work.start.minLength', {
            label,
            count: property.minLength,
          }),
        };
      if (property.maxLength !== undefined && value.length > property.maxLength)
        return {
          field: key,
          message: t('work.start.maxLength', {
            label,
            count: property.maxLength,
          }),
        };
      if (property.choices?.length && !property.choices.includes(value))
        return {
          field: key,
          message: t('work.start.choices', { label }),
        };
      continue;
    }

    if (property.type === 'boolean') {
      if (typeof raw !== 'boolean')
        return { field: key, message: t('work.start.boolean', { label }) };
      continue;
    }

    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(numeric))
      return { field: key, message: t('work.start.number', { label }) };
    if (property.type === 'integer' && !Number.isInteger(numeric))
      return { field: key, message: t('work.start.integer', { label }) };
    if (property.minimum !== undefined && numeric < property.minimum)
      return {
        field: key,
        message: t('work.start.minimum', { label, count: property.minimum }),
      };
    if (property.maximum !== undefined && numeric > property.maximum)
      return {
        field: key,
        message: t('work.start.maximum', { label, count: property.maximum }),
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

function capabilityFromDefinition(
  source: Record<string, unknown>,
  definitionVersionId: string,
  definitionId: string,
): CoworkerCapability | null {
  const metadata = asRecord(source.metadata);
  const spec = asRecord(source.spec);
  const name = typeof metadata?.name === 'string' ? metadata.name : null;
  if (!name) return null;
  const schema = asRecord(spec?.input_schema);
  const properties = asRecord(schema?.properties) ?? {};
  const parsedProperties: Record<string, CapabilityInputProperty> = {};
  for (const [key, value] of Object.entries(properties)) {
    const property = asRecord(value);
    if (!property) return null;
    const type = property?.type;
    if (type === 'string') {
      parsedProperties[key] = {
        type,
        ...(typeof property.min_length === 'number'
          ? { minLength: property.min_length }
          : {}),
        ...(typeof property.max_length === 'number'
          ? { maxLength: property.max_length }
          : {}),
        ...(Array.isArray(property.enum) &&
        property.enum.every((item) => typeof item === 'string')
          ? { choices: property.enum }
          : {}),
      };
      continue;
    }
    if (type === 'number' || type === 'integer') {
      parsedProperties[key] = {
        type,
        ...(typeof property.minimum === 'number'
          ? { minimum: property.minimum }
          : {}),
        ...(typeof property.maximum === 'number'
          ? { maximum: property.maximum }
          : {}),
      };
      continue;
    }
    if (type === 'boolean') {
      parsedProperties[key] = { type };
      continue;
    }
    return null;
  }
  return {
    definitionId,
    definitionVersionId,
    name,
    description:
      typeof metadata?.description === 'string' ? metadata.description : null,
    inputSchema: {
      properties: parsedProperties,
      required: Array.isArray(schema?.required)
        ? schema.required.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      additionalProperties: schema?.additional_properties === true,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function AdvancedDefinitionAuthoring({
  originConversationId,
  onWorkCreated,
}: {
  readonly originConversationId: string | null;
  readonly onWorkCreated?: () => void;
}) {
  const t = useT();
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
        throw new Error(t('work.start.noFingerprint'));
      const planned = await workDefinitionClient.plan(source);
      setPlan(planned);
      setState('valid');
      setStatusMessage(t('work.start.valid'));
      return planned;
    } catch (error) {
      const nextDiagnostics = diagnosticsFrom(
        error instanceof ApiTransportError ? error.payload : undefined,
      );
      setDiagnostics(nextDiagnostics);
      setState('error');
      setStatusMessage(
        nextDiagnostics.length
          ? t('work.start.fixDiagnostics')
          : t('work.start.validationFailed'),
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
    } catch {
      setState('error');
      setStatusMessage(t('work.start.applyFailed'));
    }
  }

  return (
    <div className="new-work-form__advanced-editor">
      <p>{t('work.start.advancedIntro')}</p>
      <div className="new-work-form__field">
        <label htmlFor="advanced-work-title">{t('work.start.workTitle')}</label>
        <input
          id="advanced-work-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="new-work-form__field">
        <label htmlFor="work-definition">{t('work.start.source')}</label>
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
          {t('work.start.participants', {
            count: plan.resolved.participants.length,
          })}
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
        {state === 'applying'
          ? t('work.start.creatingAdvanced')
          : t('work.start.apply')}
      </button>
    </div>
  );
}
