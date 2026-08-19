'use client';

import { useState } from 'react';
import { diagnosticsFrom } from '@/components/work/definition-panel';
import { workTabHref } from '@/components/work/work-presentation';

type Diagnostic = {
  readonly path: string;
  readonly code: string;
  readonly message: string;
};

type Plan = {
  readonly fingerprint: string;
};

type AuthoringState =
  | 'idle'
  | 'validating'
  | 'valid'
  | 'applying'
  | 'applied'
  | 'error';

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!record.error || typeof record.error !== 'object' || Array.isArray(record.error)) return null;
  const error = record.error as Record<string, unknown>;
  return typeof error.message === 'string' ? error.message : null;
}

export function NewWork() {
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [state, setState] = useState<AuthoringState>('idle');
  const [diagnostics, setDiagnostics] = useState<readonly Diagnostic[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function validateAndPlan(): Promise<Plan | null> {
    setState('validating');
    setDiagnostics([]);
    setPlan(null);
    setStatusMessage(null);

    const validation = await fetch('/api/work-definitions/validate', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    }).catch(() => null);

    const validationBody = validation ? await validation.json().catch(() => undefined) : undefined;

    if (!validation?.ok) {
      const nextDiagnostics = diagnosticsFrom(validationBody);
      setDiagnostics(nextDiagnostics);
      setState('error');
      setStatusMessage(
        nextDiagnostics.length
          ? 'Fix the reported Definition diagnostics before applying.'
          : 'The Definition could not be validated.',
      );
      return null;
    }

    if (!validationBody?.fingerprint) {
      setStatusMessage('The Definition could not be validated.');
      setState('error');
      return null;
    }

    const planned = await fetch('/api/work-definitions/plan', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    }).catch(() => null);

    if (!planned?.ok) {
      setState('error');
      setStatusMessage('The Definition validated, but its resource plan failed.');
      return null;
    }

    const plannedBody = await planned.json().catch(() => undefined);
    if (!plannedBody?.fingerprint) {
      setState('error');
      setStatusMessage('The Definition validated, but its resource plan failed.');
      return null;
    }

    setPlan(plannedBody);
    setState('valid');
    setStatusMessage('Definition is valid and its resource plan resolved.');
    return plannedBody;
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

    if (!response.ok) {
      setDiagnostics(diagnosticsFrom(body));
      setState('error');
      const errorMessage = extractErrorMessage(body);
      setStatusMessage(errorMessage || 'The Definition was not applied.');
      return;
    }

    if (!body?.definition?.id || !body?.version?.id) {
      setState('error');
      setStatusMessage('The Definition was not applied.');
      return;
    }

    setState('applied');

    await createWork(body.definition.id, body.version.id);
  }

  async function createWork(definitionId: string, versionId: string) {
    const response = await fetch('/api/works', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        definition_id: definitionId,
        definition_version_id: versionId,
        title,
      }),
    }).catch(() => null);

    if (!response?.ok) {
      const body = response ? await response.json().catch(() => undefined) : undefined;
      setState('error');
      const errorMessage = extractErrorMessage(body);
      setStatusMessage(errorMessage || 'The Work could not be created.');
      return;
    }

    const body = await response.json().catch(() => undefined);
    if (!body?.work?.id) {
      setState('error');
      setStatusMessage('The Work was created but response was invalid.');
      return;
    }

    window.location.assign(workTabHref(body.work.id, 'definition'));
  }

  return (
    <section
      className="new-work-form"
      data-testid="new-work-form"
    >
      <div className="new-work-form__heading">
        <h2>Create New Work</h2>
        <p>
          Paste or edit a Work Definition, then apply it to create a new Work
          record.
        </p>
      </div>

      <div className="new-work-form__content">
        <div className="new-work-form__column">
          <div className="new-work-form__field">
            <label htmlFor="work-title">Work Title</label>
            <input
              id="work-title"
              type="text"
              placeholder="My important work…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={state === 'validating' || state === 'applying'}
            />
          </div>

          <div className="new-work-form__field">
            <label htmlFor="work-definition">Definition</label>
            <textarea
              id="work-definition"
              placeholder="Paste your Work Definition YAML/JSON here…"
              className="new-work-form__textarea"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setState('idle');
                setPlan(null);
                setDiagnostics([]);
                setStatusMessage(null);
              }}
              disabled={state === 'validating' || state === 'applying'}
              spellCheck={false}
            />
          </div>

          <div className="new-work-form__actions">
            <button
              disabled={
                !title.trim() ||
                !source.trim() ||
                state === 'validating' ||
                state === 'applying'
              }
              onClick={() => void applyDefinition()}
              type="button"
              data-testid="new-work-submit"
              className="new-work-form__submit"
            >
              {state === 'applying' ? 'Creating…' : 'Create Work'}
            </button>
          </div>

          {statusMessage ? (
            <p
              aria-live="polite"
              className={`new-work-form__status new-work-form__status--${state}`}
              data-testid="new-work-status"
            >
              {statusMessage}
            </p>
          ) : null}

          {diagnostics.length > 0 ? (
            <ul className="new-work-form__diagnostics" data-testid="new-work-diagnostics">
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
      </div>
    </section>
  );
}
