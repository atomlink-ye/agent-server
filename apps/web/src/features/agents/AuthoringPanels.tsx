import { useMemo, useState } from 'react';

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
    <section className="agents-authoring" aria-label="New Coworker">
      <header>
        <span className="eyebrow">New Coworker</span>
        <h1>Hire an AI Coworker</h1>
        <p>
          Describe the teammate you want. Runtime package details stay behind
          the product contract.
        </p>
      </header>
      <div className="agents-form-grid">
        <Field
          label="Name"
          hint="The name you will see in Chat and the roster."
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Maya"
          />
        </Field>
        <Field label="Role" hint="A human-readable role, not a runtime type.">
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="Research Analyst"
          />
        </Field>
        <Field label="What should this Coworker help with?">
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            placeholder="Research competitors, track market changes, and challenge assumptions."
          />
        </Field>
        <Field label="Working style" hint="Optional standing instructions.">
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={5}
            placeholder="Be thorough, concise, and cite evidence before making a recommendation."
          />
        </Field>
      </div>
      <details className="agents-advanced">
        <summary>Advanced</summary>
        <Field
          label="Model policy"
          hint="The default is the lowest-friction development policy."
        >
          <select
            value={modelPolicyRef}
            onChange={(event) =>
              setModelPolicyRef(event.target.value as typeof modelPolicyRef)
            }
          >
            <option value="free-only">Recommended · free-only</option>
            <option value="claude/deepseek-v4-flash">
              Claude · deepseek-v4-flash
            </option>
            <option value="codex/deepseek-v4-flash">
              Codex · deepseek-v4-flash
            </option>
          </select>
        </Field>
        <p className="agents-form-hint">
          Formal Work discovery and start tools are attached by the
          deterministic Coworker compiler. Provider session and permission
          boilerplate are not user-authored here.
        </p>
      </details>
      {error ? (
        <p className="agents-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="agents-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="agents-primary"
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !role.trim() || !summary.trim()}
        >
          {busy ? 'Creating…' : 'Create & Chat'}
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
    },
  ]);
  const [inputs, setInputs] = useState<EditableInput[]>([]);
  const [plan, setPlan] = useState<DefinitionPlan | null>(null);
  const [diagnostics, setDiagnostics] = useState<DefinitionDiagnostics>([]);
  const [generatedSource, setGeneratedSource] = useState('');
  const [status, setStatus] = useState<
    'idle' | 'previewing' | 'ready' | 'saving' | 'error'
  >('idle');
  const [message, setMessage] = useState<string | null>(null);

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
    setStatus('idle');
  }

  async function preview(): Promise<{
    source: string;
    plan: DefinitionPlan;
  } | null> {
    setStatus('previewing');
    setDiagnostics([]);
    setMessage(null);
    let source: string;
    try {
      source = compileCapabilityDraft(draft).source;
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
      setMessage(
        'Ready to save. The preview below shows the resolved plan for this Capability.',
      );
      return { source, plan: nextPlan };
    } catch (reason) {
      const nextDiagnostics = diagnosticsFrom(
        reason instanceof ApiTransportError ? reason.payload : undefined,
      );
      setDiagnostics(nextDiagnostics);
      setStatus('error');
      setMessage(
        nextDiagnostics.length
          ? 'Fix the highlighted Capability details before saving.'
          : reason instanceof Error
            ? reason.message
            : String(reason),
      );
      return null;
    }
  }

  async function save(startAfterSave: boolean): Promise<void> {
    if (status === 'saving') return;
    const ready = await preview();
    if (!ready) return;
    setStatus('saving');
    try {
      const applied = await workDefinitionClient.apply(ready.source);
      await associateCapability(agent.id, capabilityBindingFromApply(applied));
      await onSaved();
      setStatus('ready');
      setMessage('Capability saved to this Coworker’s Work Catalog.');
      if (startAfterSave) onStart(applied.versionId);
    } catch (reason) {
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
    <section className="agents-authoring" aria-label="Capability Builder">
      <header>
        <span className="eyebrow">Teach a capability</span>
        <h1>What can {agent.displayName} formally do?</h1>
        <p>
          A Capability is a reusable way for this Coworker to complete a formal
          kind of Work. The execution details stay behind this builder.
        </p>
      </header>

      <div className="agents-form-grid">
        <Field label="Capability name">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              resetPreview();
            }}
            placeholder="Competitor Research"
          />
        </Field>
        <Field label="Outcome">
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              resetPreview();
            }}
            rows={3}
            placeholder="Research a company’s major competitors and deliver an evidence-backed comparison."
          />
        </Field>
      </div>

      <div className="agents-authoring-section">
        <h2>Execution</h2>
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
            One specialist <small>Recommended</small>
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
            A small team
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
                    ? 'Lead'
                    : mode === 'single'
                      ? 'Specialist'
                      : `Member ${index}`}
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
                    Remove
                  </button>
                ) : null}
              </div>
              <Field label="Name">
                <input
                  value={participant.name}
                  onChange={(event) =>
                    changeParticipant(index, { name: event.target.value })
                  }
                />
              </Field>
              <Field label="Role">
                <input
                  value={participant.role}
                  onChange={(event) =>
                    changeParticipant(index, { role: event.target.value })
                  }
                />
              </Field>
              <Field label="Instructions">
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
            + Add member
          </button>
        ) : null}
      </div>

      <div className="agents-authoring-section">
        <div className="agents-section-heading">
          <div>
            <h2>Inputs</h2>
            <p>These fields become the questions shown when starting Work.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setInputs((current) => [...current, emptyInput()]);
              resetPreview();
            }}
          >
            + Add input
          </button>
        </div>
        {inputs.length === 0 ? (
          <p className="agents-empty-note">
            No input fields yet. The Capability can still be started with an
            empty input object.
          </p>
        ) : null}
        {inputs.map((input) => (
          <article className="agents-input-row" key={input.id}>
            <input
              aria-label="Input label"
              value={input.label}
              placeholder="Company"
              onChange={(event) =>
                changeInput(input.id, { label: event.target.value })
              }
            />
            <input
              aria-label="Input key"
              value={input.key}
              placeholder="company"
              onChange={(event) =>
                changeInput(input.id, { key: event.target.value })
              }
            />
            <select
              aria-label="Input type"
              value={input.type}
              onChange={(event) =>
                changeInput(input.id, {
                  type: event.target.value as CapabilityInputType,
                })
              }
            >
              <option value="text">Text</option>
              <option value="select">Choice</option>
              <option value="number">Number</option>
              <option value="integer">Integer</option>
              <option value="boolean">Yes / No</option>
            </select>
            <label className="agents-inline-check">
              <input
                type="checkbox"
                checked={input.required}
                onChange={(event) =>
                  changeInput(input.id, { required: event.target.checked })
                }
              />{' '}
              Required
            </label>
            {input.type === 'select' ? (
              <input
                className="agents-input-wide"
                value={input.choices}
                placeholder="OpenAI, Anthropic, Google"
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
                  placeholder="Min length"
                  onChange={(event) =>
                    changeInput(input.id, { minLength: event.target.value })
                  }
                />
                <input
                  type="number"
                  value={input.maxLength}
                  placeholder="Max length"
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
                  placeholder="Minimum"
                  onChange={(event) =>
                    changeInput(input.id, { minimum: event.target.value })
                  }
                />
                <input
                  type="number"
                  value={input.maximum}
                  placeholder="Maximum"
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
              Remove
            </button>
          </article>
        ))}
      </div>

      <div className="agents-authoring-section">
        <div className="agents-section-heading">
          <div>
            <h2>Preview</h2>
            <p>Check how this Capability will work before saving.</p>
          </div>
          <button
            type="button"
            onClick={() => void preview()}
            disabled={status === 'previewing' || status === 'saving'}
          >
            {status === 'previewing' ? 'Resolving…' : 'Preview plan'}
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
          <summary>Advanced · generated canonical source</summary>
          <pre className="agents-source-preview">
            {generatedSource ||
              'Preview the plan to generate canonical WorkDefinition source.'}
          </pre>
        </details>
      </div>

      {message ? (
        <p
          className={status === 'error' ? 'agents-error' : 'agents-status'}
          role={status === 'error' ? 'alert' : 'status'}
        >
          {message}
        </p>
      ) : null}
      <div className="agents-form-actions">
        <button type="button" onClick={onCancel} disabled={status === 'saving'}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save(false)}
          disabled={status === 'saving'}
        >
          {status === 'saving' ? 'Saving…' : 'Save capability'}
        </button>
        <button
          className="agents-primary"
          type="button"
          onClick={() => void save(true)}
          disabled={status === 'saving'}
        >
          Save & start Work
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
  return (
    <div className="agents-plan-preview">
      <div>
        <span className="eyebrow">Execution</span>
        <strong>
          {plan.resolved.kind === 'single_worker'
            ? 'One specialist'
            : 'Small team'}
        </strong>
      </div>
      <div>
        <span className="eyebrow">Participants</span>
        {plan.resolved.participants.map((participant) => (
          <p key={`${participant.role}:${participant.name}`}>
            <strong>{participant.name}</strong> · {participant.role}
          </p>
        ))}
      </div>
      <div>
        <span className="eyebrow">Tools & Skills</span>
        <p>
          {unique(
            plan.resolved.participants.flatMap(
              (participant) => participant.tools,
            ),
          ).join(', ') || 'No domain tools declared'}
        </p>
        <p>
          {unique(
            plan.resolved.participants.flatMap(
              (participant) => participant.skills,
            ),
          ).join(', ') || 'No skills declared'}
        </p>
      </div>
      <div>
        <span className="eyebrow">Inputs</span>
        <p>
          {inputs.length
            ? inputs
                .map(
                  (input) =>
                    `${input.label || input.key}${input.required ? ' *' : ''}`,
                )
                .join(', ')
            : 'No required input'}
        </p>
      </div>
      <div>
        <span className="eyebrow">Platform</span>
        <p>
          {plan.resolved.platformCapabilities.join(', ') ||
            'No additional platform capabilities'}
        </p>
      </div>
    </div>
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
  };
}
function reviewerParticipant(): CapabilityParticipantDraft {
  return {
    name: 'reviewer',
    role: 'Reviewer',
    instructions:
      'Review the work independently, identify material gaps, and return clear corrections or approval evidence.',
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
