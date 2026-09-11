import { useMemo, useState } from 'react';
import { useT } from '../../i18n';

import { isFeatureUnavailable } from '../../api/feature-availability';
import { ApiTransportError } from '../../api/transport';
import { diagnosticsFrom } from '../work/components/definition-panel';
import {
  type DefinitionDiagnostics,
  type DefinitionApply,
  type DefinitionPlan,
  workDefinitionClient,
} from '../work/clients/work-definition-client';
import { associateCapability, createCoworker } from './agents-gateway';
import type { Coworker } from './contracts';
import { useSkillCatalog } from './queries/use-skill-catalog';
import {
  compileCapabilityDraft,
  type CapabilityDraft,
  type CapabilityInputDraft,
  type CapabilityInputType,
  type CapabilityParticipantDraft,
} from './authoring';

export function NewCoworkerForm({
  onCreated,
  onCancel,
}: {
  readonly onCreated: (result: {
    readonly agentId: string;
    readonly conversationId: string;
  }) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [summary, setSummary] = useState('');
  const [instructions, setInstructions] = useState('');
  const [modelPolicyRef, setModelPolicyRef] = useState<
    'free-only' | 'claude/deepseek-v4-flash' | 'codex/deepseek-v4-flash'
  >('free-only');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!name.trim() || !role.trim() || !summary.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCoworker({
        name: name.trim(),
        role: role.trim(),
        summary: summary.trim(),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        modelPolicyRef,
      });
      onCreated({
        agentId: created.agentId,
        conversationId: created.conversationId,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <section
      className="agents-authoring"
      aria-label={t('authoring.newCoworker')}
    >
      <header>
        <span className="eyebrow">{t('authoring.newCoworker')}</span>
        <h1>{t('authoring.hire')}</h1>
        <p>{t('authoring.hireDescription')}</p>
      </header>
      <div className="agents-form-grid">
        <Field label={t('authoring.name')} hint={t('authoring.nameHint')}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('authoring.namePlaceholder')}
          />
        </Field>
        <Field label={t('authoring.role')} hint={t('authoring.roleHint')}>
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder={t('authoring.rolePlaceholder')}
          />
        </Field>
        <Field label={t('authoring.summaryLabel')}>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            placeholder={t('authoring.summaryPlaceholder')}
          />
        </Field>
        <Field
          label={t('authoring.workingStyle')}
          hint={t('authoring.workingStyleHint')}
        >
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={5}
            placeholder={t('authoring.instructionsPlaceholder')}
          />
        </Field>
      </div>
      <details className="agents-advanced">
        <summary>{t('authoring.advanced')}</summary>
        <Field
          label={t('authoring.modelPolicy')}
          hint={t('authoring.modelPolicyHint')}
        >
          <select
            value={modelPolicyRef}
            onChange={(event) =>
              setModelPolicyRef(event.target.value as typeof modelPolicyRef)
            }
          >
            <option value="free-only">
              {t('authoring.recommendedFreeOnly')}
            </option>
            <option value="claude/deepseek-v4-flash">
              {t('authoring.runtimeClaude')}
            </option>
            <option value="codex/deepseek-v4-flash">
              {t('authoring.runtimeCodex')}
            </option>
          </select>
        </Field>
        <p className="agents-form-hint">{t('authoring.compilerHint')}</p>
      </details>
      {error ? (
        <p className="agents-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="agents-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button
          className="agents-primary"
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !role.trim() || !summary.trim()}
        >
          {busy ? t('authoring.creating') : t('authoring.createChat')}
        </button>
      </div>
    </section>
  );
}

interface EditableInput {
  readonly id: number;
  readonly label: string;
  readonly key: string;
  readonly type: CapabilityInputType;
  readonly required: boolean;
  readonly choices: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly minLength: string;
  readonly maxLength: string;
}

export function CapabilityBuilder({
  agent,
  onCancel,
  onSaved,
  onStart,
}: {
  readonly agent: Coworker;
  readonly onCancel: () => void;
  readonly onSaved: () => Promise<void> | void;
  readonly onStart: (definitionVersionId: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'single' | 'collaboration'>('single');
  const [participants, setParticipants] = useState<
    CapabilityParticipantDraft[]
  >([
    {
      name: 'specialist',
      role: agent.roleLabel ?? 'Specialist',
      instructions:
        'Complete the requested formal Work carefully and return a concise, evidence-backed result.',
      skills: [],
    },
  ]);
  const skillCatalog = useSkillCatalog();
  const [inputs, setInputs] = useState<EditableInput[]>([]);
  const [plan, setPlan] = useState<DefinitionPlan | null>(null);
  const [diagnostics, setDiagnostics] = useState<DefinitionDiagnostics>([]);
  const [generatedSource, setGeneratedSource] = useState('');
  const [status, setStatus] = useState<
    'idle' | 'previewing' | 'ready' | 'saving' | 'unavailable' | 'error'
  >('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [saveConfirmation, setSaveConfirmation] = useState(false);

  // The Skill catalog is installed by the same `productWorkSurface` fact that
  // installs the work-definition routes this builder saves through. So a
  // `feature_unavailable` catalog is not merely "no Skills to pick" — it means
  // authoring cannot succeed here at all. Deriving it from the load, rather
  // than waiting for a save to fail, keeps the promise docs/frontend.md makes:
  // controls that cannot succeed are disabled rather than offered.
  const surfaceUnavailable =
    status === 'unavailable' || skillCatalog.status === 'unavailable';

  const draft = useMemo<CapabilityDraft>(
    () => ({
      name,
      description,
      mode,
      participants,
      inputs: inputs.map(toInputDraft),
    }),
    [description, inputs, mode, name, participants],
  );

  function resetPreview(): void {
    setPlan(null);
    setDiagnostics([]);
    setGeneratedSource('');
    setMessage(null);
    setSaveConfirmation(false);
    setStatus('idle');
  }

  async function preview(): Promise<{
    source: string;
    plan: DefinitionPlan;
  } | null> {
    setSaveConfirmation(false);
    setStatus('previewing');
    setDiagnostics([]);
    setMessage(null);
    let source: string;
    try {
      source = compileCapabilityDraft(draft, skillCatalog.skills).source;
      setGeneratedSource(source);
    } catch (reason) {
      setStatus('error');
      setMessage(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
    try {
      await workDefinitionClient.validate(source);
      const nextPlan = await workDefinitionClient.plan(source);
      setPlan(nextPlan);
      setStatus('ready');
      setMessage(t('authoring.readyToSave'));
      return { source, plan: nextPlan };
    } catch (reason) {
      if (isFeatureUnavailable(reason)) {
        setStatus('unavailable');
        setMessage(t('authoring.capabilityUnavailable'));
        return null;
      }
      const nextDiagnostics = diagnosticsFrom(
        reason instanceof ApiTransportError ? reason.payload : undefined,
      );
      setDiagnostics(nextDiagnostics);
      setStatus('error');
      setMessage(
        nextDiagnostics.length
          ? t('authoring.fixDetails')
          : reason instanceof Error
            ? reason.message
            : String(reason),
      );
      return null;
    }
  }

  async function save(startAfterSave: boolean): Promise<void> {
    if (status === 'saving' || surfaceUnavailable) return;
    const ready = await preview();
    if (!ready) return;
    setStatus('saving');
    try {
      const applied = await workDefinitionClient.apply(ready.source);
      await associateCapability(agent.id, capabilityBindingFromApply(applied));
      await onSaved();
      setStatus('ready');
      setMessage(t('authoring.saved'));
      setSaveConfirmation(true);
      if (startAfterSave) onStart(applied.versionId);
    } catch (reason) {
      if (isFeatureUnavailable(reason)) {
        setStatus('unavailable');
        setMessage(t('authoring.capabilityUnavailable'));
        return;
      }
      setStatus('error');
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function changeParticipant(
    index: number,
    patch: Partial<CapabilityParticipantDraft>,
  ): void {
    setParticipants((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
    resetPreview();
  }

  function changeInput(id: number, patch: Partial<EditableInput>): void {
    setInputs((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    resetPreview();
  }

  return (
    <section
      className="agents-authoring"
      aria-label={t('authoring.capabilityBuilder')}
    >
      <header>
        <span className="eyebrow">{t('authoring.teachCapability')}</span>
        <h1>{t('authoring.whatCan', { name: agent.displayName })}</h1>
        <p>{t('authoring.capabilityDescription')}</p>
      </header>

      <div className="agents-form-grid">
        <Field label={t('authoring.capabilityName')}>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              resetPreview();
            }}
            placeholder={t('authoring.capabilityNamePlaceholder')}
          />
        </Field>
        <Field label={t('authoring.outcome')}>
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              resetPreview();
            }}
            rows={3}
            placeholder={t('authoring.outcomePlaceholder')}
          />
        </Field>
      </div>

      <div className="agents-authoring-section">
        <h2>{t('authoring.execution')}</h2>
        <div className="agents-choice-row">
          <label>
            <input
              type="radio"
              checked={mode === 'single'}
              onChange={() => {
                setMode('single');
                setParticipants([participants[0] ?? defaultParticipant()]);
                resetPreview();
              }}
            />{' '}
            {t('authoring.oneSpecialist')}{' '}
            <small>{t('authoring.recommended')}</small>
          </label>
          <label>
            <input
              type="radio"
              checked={mode === 'collaboration'}
              onChange={() => {
                setMode('collaboration');
                setParticipants((current) =>
                  current.length >= 2
                    ? current
                    : [
                        current[0] ?? defaultParticipant(),
                        reviewerParticipant(),
                      ],
                );
                resetPreview();
              }}
            />{' '}
            {t('authoring.smallTeam')}
          </label>
        </div>
        <div className="agents-participant-list">
          {participants.map((participant, index) => (
            <article
              className="agents-participant"
              key={`${index}:${participant.name}`}
            >
              <div className="agents-participant-heading">
                <strong>
                  {index === 0 && mode === 'collaboration'
                    ? t('authoring.lead')
                    : mode === 'single'
                      ? t('authoring.specialist')
                      : t('authoring.member', { index })}
                </strong>
                {mode === 'collaboration' && index > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setParticipants((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      );
                      resetPreview();
                    }}
                  >
                    {t('authoring.remove')}
                  </button>
                ) : null}
              </div>
              <Field label={t('authoring.name')}>
                <input
                  value={participant.name}
                  onChange={(event) =>
                    changeParticipant(index, { name: event.target.value })
                  }
                />
              </Field>
              <Field label={t('authoring.role')}>
                <input
                  value={participant.role}
                  onChange={(event) =>
                    changeParticipant(index, { role: event.target.value })
                  }
                />
              </Field>
              <Field label={t('authoring.instructions')}>
                <textarea
                  rows={3}
                  value={participant.instructions}
                  onChange={(event) =>
                    changeParticipant(index, {
                      instructions: event.target.value,
                    })
                  }
                />
              </Field>
              <SkillPicker
                catalog={skillCatalog}
                selected={participant.skills}
                onChange={(skills) => changeParticipant(index, { skills })}
              />
            </article>
          ))}
        </div>
        {mode === 'collaboration' && participants.length < 17 ? (
          <button
            type="button"
            onClick={() => {
              setParticipants((current) => [...current, reviewerParticipant()]);
              resetPreview();
            }}
          >
            {t('authoring.addMember')}
          </button>
        ) : null}
      </div>

      <div className="agents-authoring-section">
        <div className="agents-section-heading">
          <div>
            <h2>{t('authoring.inputs')}</h2>
            <p>{t('authoring.inputsDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setInputs((current) => [...current, emptyInput()]);
              resetPreview();
            }}
          >
            {t('authoring.addInput')}
          </button>
        </div>
        {inputs.length === 0 ? (
          <p className="agents-empty-note">{t('authoring.noInputs')}</p>
        ) : null}
        {inputs.map((input) => (
          <article className="agents-input-row" key={input.id}>
            <input
              aria-label={t('authoring.inputLabel')}
              value={input.label}
              placeholder={t('authoring.companyPlaceholder')}
              onChange={(event) =>
                changeInput(input.id, { label: event.target.value })
              }
            />
            <input
              aria-label={t('authoring.inputKey')}
              value={input.key}
              placeholder={t('authoring.companyKeyPlaceholder')}
              onChange={(event) =>
                changeInput(input.id, { key: event.target.value })
              }
            />
            <select
              aria-label={t('authoring.inputType')}
              value={input.type}
              onChange={(event) =>
                changeInput(input.id, {
                  type: event.target.value as CapabilityInputType,
                })
              }
            >
              <option value="text">{t('authoring.text')}</option>
              <option value="select">{t('authoring.choice')}</option>
              <option value="number">{t('authoring.number')}</option>
              <option value="integer">{t('authoring.integer')}</option>
              <option value="boolean">{t('authoring.yesNo')}</option>
            </select>
            <label className="agents-inline-check">
              <input
                type="checkbox"
                checked={input.required}
                onChange={(event) =>
                  changeInput(input.id, { required: event.target.checked })
                }
              />{' '}
              {t('authoring.required')}
            </label>
            {input.type === 'select' ? (
              <input
                className="agents-input-wide"
                value={input.choices}
                placeholder={t('authoring.choicesPlaceholder')}
                onChange={(event) =>
                  changeInput(input.id, { choices: event.target.value })
                }
              />
            ) : null}
            {input.type === 'text' ? (
              <>
                <input
                  type="number"
                  value={input.minLength}
                  placeholder={t('authoring.minLength')}
                  onChange={(event) =>
                    changeInput(input.id, { minLength: event.target.value })
                  }
                />
                <input
                  type="number"
                  value={input.maxLength}
                  placeholder={t('authoring.maxLength')}
                  onChange={(event) =>
                    changeInput(input.id, { maxLength: event.target.value })
                  }
                />
              </>
            ) : null}
            {input.type === 'number' || input.type === 'integer' ? (
              <>
                <input
                  type="number"
                  value={input.minimum}
                  placeholder={t('authoring.minimum')}
                  onChange={(event) =>
                    changeInput(input.id, { minimum: event.target.value })
                  }
                />
                <input
                  type="number"
                  value={input.maximum}
                  placeholder={t('authoring.maximum')}
                  onChange={(event) =>
                    changeInput(input.id, { maximum: event.target.value })
                  }
                />
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setInputs((current) =>
                  current.filter((item) => item.id !== input.id),
                );
                resetPreview();
              }}
            >
              {t('authoring.remove')}
            </button>
          </article>
        ))}
      </div>

      <div className="agents-authoring-section">
        <div className="agents-section-heading">
          <div>
            <h2>{t('authoring.preview')}</h2>
            <p>{t('authoring.previewDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => void preview()}
            disabled={
              status === 'previewing' ||
              status === 'saving' ||
              surfaceUnavailable
            }
          >
            {status === 'previewing'
              ? t('authoring.resolving')
              : t('authoring.previewPlan')}
          </button>
        </div>
        {plan ? <PlanPreview plan={plan} inputs={inputs} /> : null}
        {diagnostics.length ? (
          <ul className="new-work-form__diagnostics">
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.path}:${index}`}>
                <code>{diagnostic.path}</code>
                <strong>{diagnostic.message}</strong>
                <span>{diagnostic.code}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <details className="agents-advanced">
          <summary>{t('authoring.generatedSource')}</summary>
          <pre className="agents-source-preview">
            {generatedSource || t('authoring.previewSource')}
          </pre>
        </details>
      </div>

      {message ? (
        <p
          className={
            status === 'error'
              ? 'agents-error'
              : saveConfirmation
                ? 'agents-save-success'
                : 'agents-status'
          }
          data-testid={saveConfirmation ? 'capability-save-success' : undefined}
          role={status === 'error' ? 'alert' : 'status'}
        >
          {saveConfirmation ? <span aria-hidden="true">✓</span> : null}
          {message}
        </p>
      ) : null}
      <div className="agents-form-actions">
        <button type="button" onClick={onCancel} disabled={status === 'saving'}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void save(false)}
          disabled={status === 'saving' || surfaceUnavailable}
        >
          {status === 'saving' ? t('authoring.saving') : t('authoring.save')}
        </button>
        <button
          className="agents-primary"
          type="button"
          onClick={() => void save(true)}
          disabled={status === 'saving' || surfaceUnavailable}
        >
          {t('authoring.saveStart')}
        </button>
      </div>
    </section>
  );
}

export function capabilityBindingFromApply(applied: DefinitionApply): {
  readonly definitionId: string;
  readonly definitionVersionId: string;
} {
  return {
    definitionId: applied.definitionId,
    definitionVersionId: applied.versionId,
  };
}

function PlanPreview({
  plan,
  inputs,
}: {
  readonly plan: DefinitionPlan;
  readonly inputs: readonly EditableInput[];
}) {
  const t = useT();
  return (
    <div className="agents-plan-preview">
      <div>
        <span className="eyebrow">{t('authoring.execution')}</span>
        <strong>
          {plan.resolved.kind === 'single_worker'
            ? t('authoring.oneSpecialistPlan')
            : t('authoring.smallTeamPlan')}
        </strong>
      </div>
      <div>
        <span className="eyebrow">{t('authoring.participants')}</span>
        {plan.resolved.participants.map((participant) => (
          <p key={`${participant.role}:${participant.name}`}>
            <strong>{participant.name}</strong> · {participant.role}
          </p>
        ))}
      </div>
      <div>
        <span className="eyebrow">{t('authoring.toolsSkills')}</span>
        <p>
          {unique(
            plan.resolved.participants.flatMap(
              (participant) => participant.tools,
            ),
          ).join(', ') || t('authoring.noDomainTools')}
        </p>
        <p>
          {unique(
            plan.resolved.participants.flatMap(
              (participant) => participant.skills,
            ),
          ).join(', ') || t('authoring.noSkills')}
        </p>
      </div>
      <div>
        <span className="eyebrow">{t('authoring.runtimeRequirements')}</span>
        {plan.resolved.requiredRuntimeCapabilities.length ? (
          <ul className="agents-runtime-requirements">
            {plan.resolved.requiredRuntimeCapabilities.map((token) => (
              <li key={token}>{describeRuntimeCapability(t, token)}</li>
            ))}
          </ul>
        ) : (
          <p>{t('authoring.noRuntimeCapability')}</p>
        )}
      </div>
      <div>
        <span className="eyebrow">{t('authoring.inputs')}</span>
        <p>
          {inputs.length
            ? inputs
                .map(
                  (input) =>
                    `${input.label || input.key}${input.required ? ' *' : ''}`,
                )
                .join(', ')
            : t('authoring.noRequiredInput')}
        </p>
      </div>
      <div>
        <span className="eyebrow">{t('authoring.platform')}</span>
        <p>
          {plan.resolved.platformCapabilities.join(', ') ||
            t('authoring.noPlatformCapabilities')}
        </p>
      </div>
    </div>
  );
}

// This is Work-layer Skill selection for an authored participant. It is
// deliberately absent from Agent/Coworker authoring (`NewCoworkerForm`) —
// the Owner has ruled Agent-level Skill selection out; the Coworker
// profile's read-only Skill chips stay as the aggregate view of what its
// saved Capabilities already selected here.
function SkillPicker({
  catalog,
  selected,
  onChange,
}: {
  readonly catalog: ReturnType<typeof useSkillCatalog>;
  readonly selected: readonly string[];
  readonly onChange: (skills: readonly string[]) => void;
}) {
  const t = useT();
  if (catalog.status === 'loading')
    return <p className="agents-empty-note">{t('authoring.loadingSkills')}</p>;
  if (catalog.status === 'unavailable')
    // feature_unavailable means this workspace does not compose the Product
    // Work surface, so Skill selection can never succeed here. No Retry.
    return (
      <p className="agents-empty-note">{t('authoring.skillsUnavailable')}</p>
    );
  if (catalog.status === 'error')
    return (
      <p className="agents-error" role="alert">
        {t('authoring.skillsLoadError')}{' '}
        <button type="button" onClick={catalog.refresh}>
          {t('common.retry')}
        </button>
      </p>
    );
  if (catalog.skills.length === 0)
    return (
      <p className="agents-empty-note">{t('authoring.noPublishedSkills')}</p>
    );
  return (
    <Field label={t('authoring.skillsLabel')} hint={t('authoring.skillsHint')}>
      <div className="agents-skill-list">
        {catalog.skills.map((skill) => (
          <label className="agents-inline-check" key={skill.ref}>
            <input
              type="checkbox"
              checked={selected.includes(skill.ref)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, skill.ref]
                    : selected.filter((ref) => ref !== skill.ref),
                )
              }
            />{' '}
            {skill.name}
            {/*
              A Skill is not an inert instruction pack: it carries
              `requiredToolRefs`, so selecting one transitively grants those
              tools to the compiled Worker. Naming the grant at selection time
              is the whole point — an author must not widen what a Work may do
              without being able to see what they widened it by.
            */}
            {skill.requiredToolRefs.length ? (
              <span className="agents-skill-grant">
                {t('authoring.grants', {
                  tools: skill.requiredToolRefs.join(', '),
                })}
              </span>
            ) : (
              <span className="agents-skill-grant">
                {t('authoring.grantsNone')}
              </span>
            )}
          </label>
        ))}
      </div>
    </Field>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="agents-field">
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
      {children}
    </label>
  );
}

let nextInputId = 1;
function emptyInput(): EditableInput {
  return {
    id: nextInputId++,
    label: '',
    key: '',
    type: 'text',
    required: true,
    choices: '',
    minimum: '',
    maximum: '',
    minLength: '',
    maxLength: '',
  };
}
function defaultParticipant(): CapabilityParticipantDraft {
  return {
    name: 'specialist',
    role: 'Specialist',
    instructions:
      'Complete the requested formal Work carefully and return a concise, evidence-backed result.',
    skills: [],
  };
}
function reviewerParticipant(): CapabilityParticipantDraft {
  return {
    name: 'reviewer',
    role: 'Reviewer',
    instructions:
      'Review the work independently, identify material gaps, and return clear corrections or approval evidence.',
    skills: [],
  };
}
function toInputDraft(input: EditableInput): CapabilityInputDraft {
  const minimum = number(input.minimum);
  const maximum = number(input.maximum);
  const minLength = integer(input.minLength);
  const maxLength = integer(input.maxLength);
  return {
    label: input.label,
    key: input.key,
    type: input.type,
    required: input.required,
    ...(input.type === 'select'
      ? {
          choices: input.choices
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }
      : {}),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
  };
}
function number(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function integer(value: string): number | undefined {
  const parsed = number(value);
  return parsed === undefined
    ? undefined
    : Number.isInteger(parsed)
      ? parsed
      : Number.NaN;
}
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// The compiler attaches these runtime capability tokens unconditionally, and
// they are internal vocabulary rather than user-facing copy. Translate before
// the author ever commits to creating a Work: some deployments do not support every token, and finding that out
// only after Run start is the exact gap this preview closes.
function describeRuntimeCapability(
  t: ReturnType<typeof useT>,
  token: string,
): string {
  if (token === 'external_workspace') return t('authoring.externalWorkspace');
  if (token === 'reusable_session') return t('authoring.reusableSession');
  if (token === 'platform_mcp') return t('authoring.platformMcp');
  return t('authoring.runtimeCapabilityRequired', { token });
}
