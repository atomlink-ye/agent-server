'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { ProductRunTrace } from '@atomlink-ye/agent-server/product-contract';
import './run-trace.css';

type Trace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;
type WorkItem = Trace['work_items'][number];
type Attempt = WorkItem['attempts'][number];
type Entry = { readonly workItem: WorkItem; readonly attempt: Attempt };
type Geometry = { readonly left: number; readonly width: number };

export function RunTrace({ trace }: { readonly trace: Trace }) {
  const attempts = useMemo(() => attemptsFrom(trace), [trace]);
  const [view, setView] = useState<'timeline' | 'events'>('timeline');
  const [selectedAttemptKey, setSelectedAttemptKey] = useState<string | null>(
    attempts[0]?.attempt.id ?? null,
  );
  const selectedAttempt =
    attempts.find((entry) => entry.attempt.id === selectedAttemptKey) ?? null;
  const geometry = useMemo(() => timelineGeometry(attempts), [attempts]);
  const capturedRange = useMemo(
    () => capturedTimelineRange(attempts),
    [attempts],
  );
  const recordedFeedbackCount = trace.edges.filter(
    (edge) => edge.kind === 'feedback',
  ).length;
  const feedbackAttemptIds = new Set(
    trace.edges.flatMap((edge) =>
      edge.kind === 'feedback' && edge.attempt_id !== null
        ? [edge.attempt_id]
        : [],
    ),
  );
  const actorRows = trace.actors.map((actor) => ({
    key: actor.id,
    name: actor.name ?? 'Name not captured',
    items: trace.work_items.filter(
      (workItem) => workItem.actor_id === actor.id,
    ),
  }));
  const unassignedItems = trace.work_items.filter(
    (workItem) => !trace.actors.some((actor) => actor.id === workItem.actor_id),
  );
  if (unassignedItems.length)
    actorRows.push({
      key: 'uncaptured-actor',
      name: 'Name not captured',
      items: unassignedItems,
    });
  return (
    <section className="run-trace" aria-labelledby="run-trace-heading">
      <header className="run-trace__header">
        <div>
          <p id="run-trace-heading" className="run-trace__eyebrow">
            Run Trace
          </p>
        </div>
        <span className="run-trace__historical">Historical</span>
      </header>
      <p className="run-trace__subhead">
        Captured MCP dispatch and confirmation activity
        {capturedRange
          ? ` · recorded ${capturedRange.startedAt} → ${capturedRange.endedAt}`
          : ''}
      </p>
      <div className="run-trace__tabs" role="tablist" aria-label="Trace views">
        <button
          aria-selected={view === 'timeline'}
          className="run-trace__tab"
          onClick={() => setView('timeline')}
          role="tab"
          type="button"
        >
          Timeline
        </button>
        <button
          aria-selected={view === 'events'}
          className="run-trace__tab"
          onClick={() => setView('events')}
          role="tab"
          type="button"
        >
          Events
        </button>
      </div>
      {view === 'timeline' ? (
        <div className="run-trace__body">
          <div className="run-trace__canvas">
            <div className="run-trace__timeline" data-testid="trace-timeline">
              <TimeAxis range={capturedRange} />
              <div className="run-trace__lanes">
                {actorRows.map((actor) => (
                  <div
                    className={`run-trace__actor ${actorTone(actor.key)}`}
                    key={actor.key}
                  >
                    <div className="run-trace__lane-name">{actor.name}</div>
                    <div className="run-trace__actor-rows">
                      {actor.items.map((workItem) => (
                        <div className="run-trace__item-row" key={workItem.id}>
                          <div className="run-trace__item-name">
                            {workItem.subject}
                          </div>
                          <div className="run-trace__track">
                            {workItem.attempts.map((attempt) => (
                              <AttemptSpan
                                attempt={attempt}
                                feedbackSource={feedbackAttemptIds.has(
                                  attempt.id,
                                )}
                                geometry={geometry.get(attempt.id)}
                                key={attempt.id}
                                selected={selectedAttemptKey === attempt.id}
                                onSelect={setSelectedAttemptKey}
                                subject={workItem.subject}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Inspector selectedAttempt={selectedAttempt} trace={trace} />
        </div>
      ) : (
        <Events trace={trace} />
      )}
      <aside
        className="run-trace__coverage"
        data-testid="trace-coverage-disclosure"
      >
        <strong>MCP-only coverage.</strong>{' '}
        {humanize(trace.timeline_coverage.scope)}; other execution sources are
        not represented in this recording.
        {recordedFeedbackCount
          ? ` ${recordedFeedbackCount} recorded feedback edge${recordedFeedbackCount === 1 ? '' : 's'} present; relation geometry is unavailable.`
          : ''}
      </aside>
    </section>
  );
}

function TimeAxis({
  range,
}: {
  readonly range: ReturnType<typeof capturedTimelineRange>;
}) {
  const ticks = range ? relativeTicks(range.startedAt, range.endedAt) : [];
  return (
    <div className="run-trace__axis" aria-label="Recorded time axis">
      {ticks.map((tick) => (
        <span
          key={tick.position}
          style={{ '--tick-position': `${tick.position}%` } as CSSProperties}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}

function AttemptSpan({
  attempt,
  feedbackSource,
  geometry,
  selected,
  onSelect,
  subject,
}: {
  readonly attempt: Attempt;
  readonly feedbackSource: boolean;
  readonly geometry: Geometry | undefined;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly subject: string;
}) {
  if (!geometry)
    return (
      <span
        aria-label={`${subject}, Attempt ${attempt.attempt_no}, timing not captured`}
        className="run-trace__attempt-unpositioned"
      >
        Attempt {attempt.attempt_no} · Timing not captured
      </span>
    );
  return (
    <button
      aria-label={`${subject}, Attempt ${attempt.attempt_no}, ${durationLabel(attempt)}`}
      aria-pressed={selected}
      className="run-trace__attempt"
      data-testid="trace-attempt"
      onClick={() => onSelect(attempt.id)}
      style={
        {
          '--attempt-left': `${geometry.left}%`,
          '--attempt-width': `${geometry.width}%`,
        } as CSSProperties
      }
      title={subject}
      type="button"
    >
      <span className="run-trace__attempt-label">
        Attempt {attempt.attempt_no} · {durationLabel(attempt)}
      </span>
      {feedbackSource ? (
        <span
          aria-label="Recorded feedback relation"
          data-attempt-id={attempt.id}
        >
          Feedback recorded
        </span>
      ) : null}
    </button>
  );
}

function Events({ trace }: { readonly trace: Trace }) {
  const actors = new Map(trace.actors.map((actor) => [actor.id, actor]));
  const items = new Map(trace.work_items.map((item) => [item.id, item]));
  return (
    <section
      className="run-trace__events"
      aria-label="Recorded MCP activities"
      data-testid="trace-events"
    >
      <p className="run-trace__events-caption">
        Recorded MCP activities. Sequence values are shown as captured; no
        additional ordering or timing is inferred.
      </p>
      <div className="run-trace__events-toolbar">
        <strong>Recorded events</strong>
        <span>{trace.mcp_activities.length} captured rows</span>
      </div>
      <div className="run-trace__events-scroll">
        <table>
          <thead>
            <tr>
              <th>Sequence</th>
              <th>Actor</th>
              <th>Work Item</th>
              <th>Kind</th>
              <th>Category</th>
              <th>MCP activity status</th>
              <th>Result capture</th>
            </tr>
          </thead>
          <tbody>
            {trace.mcp_activities.map((activity, snapshotOrdinal) => {
              const actor = activity.source_refs.actor_id
                ? actors.get(activity.source_refs.actor_id)
                : null;
              const item = activity.source_refs.work_item_id
                ? items.get(activity.source_refs.work_item_id)
                : null;
              return (
                <tr
                  key={activitySnapshotIdentity(
                    activity.activity_id,
                    snapshotOrdinal,
                  )}
                >
                  <td>{activity.sequence}</td>
                  <td>{actor?.name ?? 'Name not captured'}</td>
                  <td>{item?.subject ?? 'Work Item not captured'}</td>
                  <td>{humanize(activity.kind)}</td>
                  <td>{humanize(activity.category)}</td>
                  <td>{humanize(activity.status)}</td>
                  <td>{captureLabel(activity.result_capture_status)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function activitySnapshotIdentity(activityId: string, snapshotOrdinal: number) {
  return `${activityId}:${snapshotOrdinal}`;
}

function Inspector({
  selectedAttempt,
  trace,
}: {
  readonly selectedAttempt: Entry | null;
  readonly trace: Trace;
}) {
  const actor = trace.actors.find(
    (candidate) => candidate.id === selectedAttempt?.workItem.actor_id,
  );
  return (
    <aside
      className="run-trace__inspector"
      aria-live="polite"
      aria-labelledby="trace-inspector-heading"
    >
      <h3 id="trace-inspector-heading">Inspector</h3>
      {selectedAttempt ? (
        <>
          <div className="run-trace__selected-execution">
            <h4>{selectedAttempt.workItem.subject}</h4>
            <p>{actor?.name ?? 'Name not captured'}</p>
          </div>
          <InspectorGroup title="Subject / actor">
            <Fact label="Work Item" value={selectedAttempt.workItem.subject} />
            <Fact label="Actor" value={actor?.name ?? 'Name not captured'} />
          </InspectorGroup>
          <InspectorGroup
            title={`Attempt ${selectedAttempt.attempt.attempt_no}`}
          >
            <Fact
              label="Attempt number"
              value={String(selectedAttempt.attempt.attempt_no)}
            />
          </InspectorGroup>
          <InspectorGroup title="Timing facts">
            <Fact
              label="Started"
              value={recordedTimestamp(selectedAttempt.attempt.started_at)}
            />
            <Fact
              label="Ended"
              value={recordedTimestamp(selectedAttempt.attempt.ended_at)}
            />
            <Fact
              label="Duration"
              value={durationLabel(selectedAttempt.attempt)}
            />
          </InspectorGroup>
          <InspectorGroup title="Capture facts">
            <Fact
              label="Timing"
              value={captureLabel(
                selectedAttempt.attempt.timing_capture_status,
              )}
            />
            <Fact
              label="Feedback"
              value={captureLabel(
                selectedAttempt.attempt.feedback_capture_status,
              )}
            />
            <Fact
              label="Result"
              value={captureLabel(
                selectedAttempt.attempt.result_capture_status,
              )}
            />
          </InspectorGroup>
        </>
      ) : (
        <p className="run-trace__unavailable">
          Select an Attempt to inspect recorded facts.
        </p>
      )}
    </aside>
  );
}
function InspectorGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="run-trace__inspector-group">
      <h4>{title}</h4>
      <dl>{children}</dl>
    </section>
  );
}
function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function attemptsFrom(trace: Trace): readonly Entry[] {
  return trace.work_items.flatMap((workItem) =>
    workItem.attempts.map((attempt) => ({ workItem, attempt })),
  );
}
export function timelineGeometry(
  attempts: readonly Entry[],
): ReadonlyMap<string, Geometry> {
  const captured = attempts.filter(
    ({ attempt }) =>
      attempt.timing_capture_status === 'captured' &&
      attempt.started_at &&
      attempt.ended_at &&
      attempt.duration_ms !== null,
  );
  if (!captured.length) return new Map();
  const start = Math.min(
    ...captured.map(({ attempt }) => Date.parse(attempt.started_at!)),
  );
  const end = Math.max(
    ...captured.map(({ attempt }) => Date.parse(attempt.ended_at!)),
  );
  const range = end - start;
  return new Map(
    captured.map(({ attempt }) => [
      attempt.id,
      {
        left: range
          ? ((Date.parse(attempt.started_at!) - start) / range) * 100
          : 0,
        width: range ? (attempt.duration_ms! / range) * 100 : 100,
      },
    ]),
  );
}
function capturedTimelineRange(attempts: readonly Entry[]) {
  const captured = attempts.filter(
    ({ attempt }) =>
      attempt.timing_capture_status === 'captured' &&
      attempt.started_at &&
      attempt.ended_at,
  );
  if (!captured.length) return null;
  return {
    startedAt: captured.map(({ attempt }) => attempt.started_at!).sort()[0]!,
    endedAt: captured
      .map(({ attempt }) => attempt.ended_at!)
      .sort()
      .at(-1)!,
  };
}
function durationLabel(attempt: Attempt) {
  return attempt.duration_ms === null
    ? 'Not captured'
    : `${(attempt.duration_ms / 1000).toFixed(1)} seconds`;
}
function recordedTimestamp(timestamp: string | null) {
  return timestamp === null
    ? 'Not captured'
    : `Recorded timestamp: ${timestamp}`;
}
function captureLabel(value: string) {
  return value === 'not_present' || value === 'not_captured'
    ? 'Not captured'
    : value === 'redacted'
      ? 'Captured, content redacted'
      : value === 'captured'
        ? 'Captured'
        : humanize(value);
}
function humanize(value: string) {
  return value.replaceAll('_', ' ');
}

function actorTone(identity: string) {
  let hash = 0;
  for (const character of identity)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `run-trace__actor--tone-${Math.abs(hash) % 3}`;
}

function relativeTicks(startedAt: string, endedAt: string) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  const span = Math.max(0, end - start);
  const count = span > 20 * 60_000 ? 7 : span > 5 * 60_000 ? 6 : 5;
  return Array.from({ length: count }, (_, index) => {
    const position = (index / (count - 1)) * 100;
    const timestamp = new Date(start + (span * index) / (count - 1));
    return {
      position,
      label:
        index === 0 || index === count - 1
          ? formatClock(timestamp)
          : `+${formatRelative((span * index) / (count - 1))}`,
    };
  });
}
function formatClock(value: Date) {
  return value.toISOString().slice(11, 16);
}
function formatRelative(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60_000);
  return minutes ? `${minutes}m` : `${Math.round(milliseconds / 1000)}s`;
}
