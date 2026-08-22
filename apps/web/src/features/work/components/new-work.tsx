'use client';

import { useState } from 'react';
import { diagnosticsFrom } from '@/features/work/components/definition-panel';
import { workTabHref } from '@/features/work/components/work-presentation';
import {
  applyWorkDefinition,
  createWork as createWorkRequest,
  planWorkDefinition,
  validateWorkDefinition,
  type DefinitionDiagnostics,
  type DefinitionPlan,
} from '@/features/work/work-gateway';
import { ApiTransportError } from '@/api/transport';

type AuthoringState =
  | 'idle'
  | 'validating'
  | 'valid'
  | 'applying'
  | 'applied'
  | 'error';

export function NewWork({ originConversationId = null }: { readonly originConversationId?: string | null }) {
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

    let validation;
    try {
      validation = await validateWorkDefinition(source);
    } catch (error) {
      const nextDiagnostics = diagnosticsFrom(
        error instanceof ApiTransportError ? error.payload : undefined,
      );
      setDiagnostics(nextDiagnostics);
      setState('error');
      setStatusMessage(
        nextDiagnostics.length
          ? 'Fix the reported Definition diagnostics before applying.'
          : 'The Definition could not be validated.',
      );
      return null;
    }
    if (!validation.fingerprint) {
      setState('error');
      setStatusMessage('The Definition could not be validated.');
      return null;
    }

    let planned;
    try {
      planned = await planWorkDefinition(source);
    } catch (error) {
      const nextDiagnostics = diagnosticsFrom(
        error instanceof ApiTransportError ? error.payload : undefined,
      );
      setDiagnostics(nextDiagnostics);
      setState('error');
      setStatusMessage('The Definition validated, but its resource plan failed.');
      return null;
    }

    setPlan(planned);
    setState('valid');
    setStatusMessage('Definition is valid and its resource plan resolved.');
    return planned;
  }

  async function applyDefinition() {
    const resolvedPlan = await validateAndPlan();
    if (!resolvedPlan) return;

    setState('applying');

    try {
      const applied = await applyWorkDefinition(source);
      setState('applied');
      await createWork(applied.definitionId, applied.versionId);
    } catch (error) {
      setDiagnostics(
        diagnosticsFrom(error instanceof ApiTransportError ? error.payload : undefined),
      );
      setState('error');
      setStatusMessage(error instanceof Error ? error.message : 'The Definition was not applied.');
    }
  }

  async function createWork(definitionId: string, versionId: string) {
    try {
      const created = await createWorkRequest(definitionId, versionId, title);
      window.location.assign(workTabHref(created.workId, 'definition', undefined, originConversationId));
    } catch (error) {
      setState('error');
      setStatusMessage(error instanceof Error ? error.message : 'The Work could not be created.');
    }
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
