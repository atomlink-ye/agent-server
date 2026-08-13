'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import type { ProductRunTrace } from '@atomlink-ye/agent-server/product-contract';
import './run-trace.css';

type Trace = Extract<ProductRunTrace, { projection_status: 'internally_anchored' }>;
type WorkItem = Trace['work_items'][number];
type Attempt = WorkItem['attempts'][number];
type Entry = { readonly workItem: WorkItem; readonly attempt: Attempt };
type Geometry = { readonly left: number; readonly width: number };

export function RunTrace({ trace }: { readonly trace: Trace }) {
  const attempts = useMemo(() => attemptsFrom(trace), [trace]);
  const [view, setView] = useState<'timeline' | 'events'>('timeline');
  const [selectedId, setSelectedId] = useState<string | null>(attempts[0]?.attempt.id ?? null);
  const selected = attempts.find((entry) => entry.attempt.id === selectedId) ?? null;
  const geometry = useMemo(() => timelineGeometry(attempts), [attempts]);
  const capturedRange = useMemo(() => capturedTimelineRange(attempts), [attempts]);
  const feedback = new Set(trace.edges.filter((edge) => edge.kind === 'feedback' && edge.attempt_id).map((edge) => edge.attempt_id!));
  return <section className="run-trace" aria-labelledby="run-trace-heading">
    <header className="run-trace__header"><div><p className="run-trace__eyebrow">Historical recorded run</p><h2 id="run-trace-heading">{trace.work.title}</h2></div><span className="run-trace__historical">Historical</span></header>
    <p className="run-trace__subhead">Captured MCP dispatch and confirmation activity{capturedRange ? ` · recorded ${capturedRange.startedAt} → ${capturedRange.endedAt}` : ''}</p>
    <div className="run-trace__tabs" role="tablist" aria-label="Trace views">
      <button aria-selected={view === 'timeline'} className="run-trace__tab" onClick={() => setView('timeline')} role="tab" type="button">Timeline</button>
      <button aria-selected={view === 'events'} className="run-trace__tab" onClick={() => setView('events')} role="tab" type="button">Events</button>
      <button className="run-trace__tab" disabled type="button">Map unavailable</button>
      <span className="run-trace__map-note">Map data not provided for this recording.</span>
    </div>
    <aside className="run-trace__coverage" data-testid="trace-coverage-disclosure"><p><strong>MCP-only coverage.</strong> This trace covers {humanize(trace.timeline_coverage.scope)}.</p><ul aria-label="Execution not covered by this trace">{trace.timeline_coverage.excluded_execution.map((item) => <li key={item}>{humanize(item)}</li>)}</ul></aside>
    {view === 'timeline' ? <div className="run-trace__body"><div className="run-trace__canvas"><div className="run-trace__timeline" data-testid="trace-timeline"><div className="run-trace__axis"><span>{capturedRange?.startedAt ?? 'Start not captured'}</span><span>{capturedRange?.endedAt ?? 'End not captured'}</span></div>{trace.actors.map((actor) => {
      const items = trace.work_items.filter((workItem) => workItem.actor_id === actor.id);
      return <div className="run-trace__lane" key={actor.id}><div className="run-trace__lane-name">{actor.name ?? 'Name not captured'}</div><div className="run-trace__track">{items.flatMap((workItem) => workItem.attempts.map((attempt) => <AttemptSpan attempt={attempt} geometry={geometry.get(attempt.id)} key={attempt.id} selected={selectedId === attempt.id} onSelect={setSelectedId} subject={workItem.subject} />))}{items.flatMap((workItem) => workItem.attempts.filter((attempt) => feedback.has(attempt.id)).map((attempt) => <span aria-label="Recorded feedback relation" className="run-trace__feedback" key={`feedback-${attempt.id}`} style={{ '--feedback-left': `${geometry.get(attempt.id)?.left ?? 0}%` } as CSSProperties} />))}</div></div>;
    })}</div></div><Inspector selected={selected} trace={trace} /></div> : <Events trace={trace} />}
  </section>;
}

function AttemptSpan({ attempt, geometry, selected, onSelect, subject }: { readonly attempt: Attempt; readonly geometry: Geometry | undefined; readonly selected: boolean; readonly onSelect: (id: string) => void; readonly subject: string }) {
  return <button aria-label={`${subject}, Attempt ${attempt.attempt_no}, ${durationLabel(attempt)}`} aria-pressed={selected} className="run-trace__attempt" data-testid="trace-attempt" onClick={() => onSelect(attempt.id)} style={{ '--attempt-left': `${geometry?.left ?? 0}%`, '--attempt-width': `${geometry?.width ?? 0}%` } as CSSProperties} title={subject} type="button"><span className="run-trace__attempt-label">Attempt {attempt.attempt_no} · {durationLabel(attempt)}</span></button>;
}

function Events({ trace }: { readonly trace: Trace }) {
  const [selectedActivity, setSelectedActivity] = useState<string | null>(null);
  const actors = new Map(trace.actors.map((actor) => [actor.id, actor]));
  const items = new Map(trace.work_items.map((item) => [item.id, item]));
  return <section className="run-trace__events" aria-label="Recorded MCP activities" data-testid="trace-events"><p className="run-trace__events-caption">Recorded sequence values; absolute timing is not captured. Activity status is MCP activity status, not Work status.</p>{trace.mcp_activities.map((activity, snapshotOrdinal) => {
    const actor = activity.source_refs.actor_id ? actors.get(activity.source_refs.actor_id) : null;
    const item = activity.source_refs.work_item_id ? items.get(activity.source_refs.work_item_id) : null;
    const identity = activitySnapshotIdentity(activity.activity_id, snapshotOrdinal);
    return <button aria-pressed={selectedActivity === identity} className="run-trace__event" key={identity} onClick={() => setSelectedActivity(identity)} type="button"><strong>#{activity.sequence}</strong><span>{actor?.name ?? 'Name not captured'}</span><span>{item?.subject ?? 'Work Item not captured'}</span><span className="run-trace__event-meta">{humanize(activity.kind)} · {humanize(activity.category)} · MCP activity: {humanize(activity.status)} · Result: {captureLabel(activity.result_capture_status)}</span></button>;
  })}</section>;
}

function activitySnapshotIdentity(activityId: string, snapshotOrdinal: number) {
  return `${activityId}:${snapshotOrdinal}`;
}

function Inspector({ selected, trace }: { readonly selected: Entry | null; readonly trace: Trace }) {
  const actor = trace.actors.find((candidate) => candidate.id === selected?.workItem.actor_id);
  return <aside className="run-trace__inspector" aria-live="polite" aria-labelledby="trace-inspector-heading"><h3 id="trace-inspector-heading">Inspector</h3>{selected ? <dl><Fact label="Work Item" value={selected.workItem.subject} /><Fact label="Agent" value={actor?.name ?? 'Name not captured'} /><Fact label="Attempt" value={String(selected.attempt.attempt_no)} /><Fact label="Started" value={recordedTimestamp(selected.attempt.started_at)} /><Fact label="Ended" value={recordedTimestamp(selected.attempt.ended_at)} /><Fact label="Captured duration" value={durationLabel(selected.attempt)} /><Fact label="Timing capture" value={captureLabel(selected.attempt.timing_capture_status)} /><Fact label="Feedback capture" muted value={captureLabel(selected.attempt.feedback_capture_status)} /><Fact label="Result capture" muted value={captureLabel(selected.attempt.result_capture_status)} /></dl> : <p className="run-trace__unavailable">Select an Attempt to inspect recorded facts.</p>}</aside>;
}
function Fact({ label, value, muted = false }: { readonly label: string; readonly value: string; readonly muted?: boolean }) { return <div><dt>{label}</dt><dd className={muted ? 'run-trace__unavailable' : undefined}>{value}</dd></div>; }

export function attemptsFrom(trace: Trace): readonly Entry[] { return trace.work_items.flatMap((workItem) => workItem.attempts.map((attempt) => ({ workItem, attempt }))); }
export function timelineGeometry(attempts: readonly Entry[]): ReadonlyMap<string, Geometry> {
  const captured = attempts.filter(({ attempt }) => attempt.timing_capture_status === 'captured' && attempt.started_at && attempt.ended_at && attempt.duration_ms !== null);
  if (!captured.length) return new Map();
  const start = Math.min(...captured.map(({ attempt }) => Date.parse(attempt.started_at!)));
  const end = Math.max(...captured.map(({ attempt }) => Date.parse(attempt.ended_at!)));
  const range = end - start;
  return new Map(captured.map(({ attempt }) => [attempt.id, { left: range ? ((Date.parse(attempt.started_at!) - start) / range) * 100 : 0, width: range ? (attempt.duration_ms! / range) * 100 : 100 }]));
}
function capturedTimelineRange(attempts: readonly Entry[]) {
  const captured = attempts.filter(({ attempt }) => attempt.timing_capture_status === 'captured' && attempt.started_at && attempt.ended_at);
  if (!captured.length) return null;
  return {
    startedAt: captured.map(({ attempt }) => attempt.started_at!).sort()[0]!,
    endedAt: captured.map(({ attempt }) => attempt.ended_at!).sort().at(-1)!,
  };
}
function durationLabel(attempt: Attempt) { return attempt.duration_ms === null ? 'Not captured' : `${(attempt.duration_ms / 1000).toFixed(1)} seconds`; }
function recordedTimestamp(timestamp: string | null) { return timestamp === null ? 'Not captured' : `Recorded timestamp: ${timestamp}`; }
function captureLabel(value: string) { return value === 'not_present' || value === 'not_captured' ? 'Not captured' : value === 'redacted' ? 'Captured, content redacted' : value === 'captured' ? 'Captured' : humanize(value); }
function humanize(value: string) { return value.replaceAll('_', ' '); }
