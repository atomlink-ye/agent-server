'use client';

import type { ReactNode } from 'react';

import { AssistantMarkdown } from '@/components/chat/assistant-markdown';

/**
 * Shared entry renderer for both per-Attempt execution detail and per-role
 * session transcript entries. Both share the same ProductExecutionDetailEvent
 * discriminated union (contracts/product-projection/execution-detail.ts).
 *
 * Extracted per roadmap §16.3: "don't copy TeamTranscript and maintain a second."
 */

export type ExecutionEventEntry = {
  readonly kind: string;
  readonly sequence: number;
  readonly created_at: string;
  readonly [key: string]: unknown;
};

export function ExecutionEventRenderer({
  event,
  renderAssistantText = false,
}: {
  readonly event: ExecutionEventEntry;
  /**
   * Per-Attempt detail lifts assistant output into its own "Agent output"
   * section, so it must not be rendered twice there. A session transcript has
   * no such section — it reads chronologically, so it opts in.
   */
  readonly renderAssistantText?: boolean;
}): ReactNode {
  if (event.kind === 'assistant_text') {
    if (!renderAssistantText) return null;
    const e = event as { text?: string | null };
    return (
      <article className="execution-transcript__event execution-transcript__answer">
        <AssistantMarkdown text={e.text ?? ''} />
        <time dateTime={event.created_at}>
          {formatTimestamp(event.created_at)}
        </time>
      </article>
    );
  }
  if (event.kind === 'reasoning_progress') {
    const e = event as { status?: string; text?: string | null };
    return (
      <details className="execution-transcript__event">
        <summary>
          <span>Reasoning</span>
          <strong>{e.status ?? ''}</strong>
          <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
        </summary>
        {e.text ? <p>{e.text}</p> : <p>Reasoning text was not captured.</p>}
      </details>
    );
  }
  if (event.kind === 'tool_status') {
    const e = event as { tool_name?: string | null; label?: string | null; category?: string; status?: string; summary?: string | null; detail_text?: string | null };
    return (
      <details className="execution-transcript__event">
        <summary>
          <span>{e.tool_name ?? e.label ?? humanize(e.category ?? 'tool')}</span>
          <strong>{humanize(e.status ?? 'unknown')}</strong>
          <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
        </summary>
        {e.summary ? <p>{e.summary}</p> : null}
        {e.detail_text ? <pre>{e.detail_text}</pre> : null}
      </details>
    );
  }
  if (event.kind === 'child_timeline_item') {
    const e = event as { label?: string; status?: string; summary?: string; detail_text?: string | null };
    return (
      <details className="execution-transcript__event">
        <summary>
          <span>{e.label ?? 'Activity'}</span>
          <strong>{humanize(e.status ?? 'unknown')}</strong>
          <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
        </summary>
        {e.summary ? <p>{e.summary}</p> : null}
        {e.detail_text ? <pre>{e.detail_text}</pre> : null}
      </details>
    );
  }
  if (event.kind === 'permission') {
    const e = event as { category?: string; status?: string; decision?: string | null; summary?: string };
    return (
      <div className="execution-transcript__event execution-transcript__event--row">
        <span>Permission · {humanize(e.category ?? 'other')}</span>
        <strong>{e.decision ? humanize(e.decision) : e.status ? humanize(e.status) : 'Not captured / not triggered'}</strong>
        <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
        {e.summary ? <p>{e.summary}</p> : null}
      </div>
    );
  }
  if (event.kind === 'usage') {
    const e = event as { input_tokens?: number | null; output_tokens?: number | null; total_cost_usd?: number | null };
    const parts = [
      e.input_tokens == null ? null : `${e.input_tokens.toLocaleString()} input`,
      e.output_tokens == null ? null : `${e.output_tokens.toLocaleString()} output`,
      e.total_cost_usd == null ? null : `$${e.total_cost_usd.toFixed(4)}`,
    ].filter(Boolean);
    return (
      <div className="execution-transcript__event execution-transcript__event--row">
        <span>Usage</span>
        <strong>{parts.length ? parts.join(' · ') : 'Not captured'}</strong>
        <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
      </div>
    );
  }
  if (event.kind === 'lifecycle') {
    const e = event as { status?: string };
    return (
      <div className="execution-transcript__event execution-transcript__event--row">
        <span>Lifecycle</span>
        <strong>{humanize(e.status ?? 'unknown')}</strong>
        <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
      </div>
    );
  }
  return (
    <div className="execution-transcript__event execution-transcript__event--row">
      <span>{humanize(event.kind)}</span>
      <strong>—</strong>
      <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
    </div>
  );
}

function humanize(value: string) { return value.replaceAll('_', ' '); }
function formatTimestamp(value: string) { return `${value.replace('T', ' ').slice(0, 19)} UTC`; }
