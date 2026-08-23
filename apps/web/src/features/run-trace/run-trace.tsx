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
export type TraceView = 'timeline' | 'map' | 'events';
type InspectorMode = 'overview' | 'conversation' | 'activity';

const TAB_LABELS: Record<TraceView, string> = {
  timeline: 'Timeline',
  map: 'Map',
  events: 'MCP Activity',
};

export function RunTrace({
  trace,
  live = false,
  selectedAttemptId,
  onSelectAttempt,
  view: controlledView,
  onViewChange,
}: {
  readonly trace: Trace;
  readonly live?: boolean;
  readonly selectedAttemptId?: string | null;
  readonly onSelectAttempt?: (attemptId: string) => void;
  readonly view?: TraceView;
  readonly onViewChange?: (view: TraceView) => void;
}) {
  const attempts = useMemo(() => attemptsFrom(trace), [trace]);
  const [internalView, setInternalView] = useState<TraceView>('timeline');
  const view = controlledView ?? internalView;
  function setView(nextView: TraceView) {
    setInternalView(nextView);
    onViewChange?.(nextView);
  }
  const [internalSelectedAttemptKey, setInternalSelectedAttemptKey] = useState<
    string | null
  >(attempts[0]?.attempt.id ?? null);
  const selectedAttemptKey = selectedAttemptId ?? internalSelectedAttemptKey;
  function setSelectedAttemptKey(nextId: string | null) {
    setInternalSelectedAttemptKey(nextId);
    if (nextId !== null) onSelectAttempt?.(nextId);
  }
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('overview');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );

  function selectMessage(messageId: string) {
    // Find the edge to get work_item_id/attempt_id for inspector routing
    const edge = trace.edges.find(
      (e) => e.kind === 'observed_message' && e.message_id === messageId,
    );
    if (edge && edge.kind === 'observed_message') {
      // Attempt to select the associated attempt if unambiguous
      if (edge.attempt_id) {
        setSelectedAttemptKey(edge.attempt_id);
      } else if (edge.work_item_id) {
        const item = trace.work_items.find((wi) => wi.id === edge.work_item_id);
        if (item?.attempts.length === 1)
          setSelectedAttemptKey(item.attempts[0]!.id);
      } else if (!selectedAttemptKey && attempts.length) {
        // No association — select the first attempt so Inspector renders
        setSelectedAttemptKey(attempts[0]!.attempt.id);
      }
      setInspectorMode('conversation');
      setSelectedMessageId(messageId);
    }
  }
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
  const actorRows = actorRowsFrom(trace);

  function selectAttempt(attemptId: string) {
    setSelectedAttemptKey(attemptId);
    setSelectedMessageId(null);
  }

  return (
    <section className="run-trace" aria-labelledby="run-trace-heading">
      <header className="run-trace__header">
        <div>
          <p className="run-trace__eyebrow">Run Trace</p>
          <h2 id="run-trace-heading">{trace.work.title}</h2>
        </div>
        <span className={live ? 'run-trace__live' : 'run-trace__historical'}>
          {live ? 'Live Run Trace' : 'Historical Run Trace'}
        </span>
      </header>
      <p className="run-trace__subhead">
        Captured collaboration and MCP dispatch facts
        {capturedRange
          ? ` · recorded ${capturedRange.startedAt} → ${capturedRange.endedAt}`
          : ''}
      </p>
      <div className="run-trace__tabs" role="tablist" aria-label="Trace views">
        {(['timeline', 'map', 'events'] as const).map((item) => (
          <button
            aria-selected={view === item}
            className="run-trace__tab"
            key={item}
            onClick={() => setView(item)}
            role="tab"
            type="button"
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </div>
      <div className="run-trace__body">
        <div className="run-trace__canvas">
          {view === 'timeline' ? (
            <Timeline
              actorRows={actorRows}
              feedbackAttemptIds={feedbackAttemptIds}
              geometry={geometry}
              live={live}
              range={capturedRange}
              selectedAttemptKey={selectedAttemptKey}
              trace={trace}
              onSelect={selectAttempt}
              onSelectMessage={selectMessage}
            />
          ) : null}
          {view === 'map' ? (
            <MapView
              selectedAttemptKey={selectedAttemptKey}
              trace={trace}
              onSelect={selectAttempt}
              onSelectMessage={selectMessage}
            />
          ) : null}
          {view === 'events' ? (
            <Events trace={trace} onSelectAttempt={selectAttempt} />
          ) : null}
        </div>
        <Inspector
          mode={inspectorMode}
          selectedAttempt={selectedAttempt}
          selectedMessageId={selectedMessageId}
          trace={trace}
          onMode={setInspectorMode}
        />
      </div>
      <aside
        className="run-trace__coverage"
        data-testid="trace-coverage-disclosure"
      >
        <strong data-testid="mcp-only-warning">
          MCP-only execution coverage.
        </strong>{' '}
        Timeline execution detail is {humanize(trace.timeline_coverage.scope)};
        excluded execution:{' '}
        {trace.timeline_coverage.excluded_execution.map(humanize).join(', ')}.{' '}
        Collaboration Work Items, Attempts, assignments, dependencies and
        observed messages are projected from durable control-plane facts.
        {recordedFeedbackCount
          ? ` ${recordedFeedbackCount} recorded feedback edge${recordedFeedbackCount === 1 ? '' : 's'} present.`
          : ''}
      </aside>
      <p className="run-trace__longest-attempt" data-testid="longest-attempt">
        {'Longest captured attempt: '}
        {longestAttemptMs(trace) !== null
          ? `${longestAttemptMs(trace)} ms`
          : 'timing not captured'}
      </p>
    </section>
  );
}

function Timeline({
  actorRows,
  feedbackAttemptIds,
  geometry,
  live,
  range,
  selectedAttemptKey,
  trace,
  onSelect,
  onSelectMessage,
}: {
  readonly actorRows: ReturnType<typeof actorRowsFrom>;
  readonly feedbackAttemptIds: ReadonlySet<string>;
  readonly geometry: ReadonlyMap<string, Geometry>;
  readonly live: boolean;
  readonly range: ReturnType<typeof capturedTimelineRange>;
  readonly selectedAttemptKey: string | null;
  readonly trace: Trace;
  readonly onSelect: (id: string) => void;
  readonly onSelectMessage: (messageId: string) => void;
}) {
  return (
    <div className="run-trace__timeline" data-testid="trace-timeline">
      <TimeAxis range={range} />
      <div className="run-trace__lanes">
        {actorRows.map((actor) => (
          <div
            className={`run-trace__lane run-trace__actor ${actorTone(actor.key)}`}
            key={actor.key}
          >
            <div className="run-trace__lane-name">
              <span>{actor.name}</span>
              <small>{formatActiveDuration(actor.items)}</small>
            </div>
            <div className="run-trace__actor-rows">
              {actor.items.map((workItem) => {
                const interactions = interactionsForWorkItem(
                  trace,
                  workItem.id,
                );
                return (
                  <div className="run-trace__item-row" key={workItem.id}>
                    <div className="run-trace__item-name">
                      <span>{workItem.subject}</span>
                      {interactions.messages || interactions.activities ? (
                        <small>
                          {interactions.messages
                            ? `${interactions.messages} msg`
                            : ''}
                          {interactions.messages && interactions.activities
                            ? ' · '
                            : ''}
                          {interactions.activities
                            ? `${interactions.activities} MCP`
                            : ''}
                        </small>
                      ) : null}
                    </div>
                    <div className="run-trace__track">
                      {workItem.attempts.map((attempt) => (
                        <AttemptSpan
                          activityCount={
                            trace.mcp_activities.filter(
                              (a) => a.source_refs.work_item_id === workItem.id,
                            ).length
                          }
                          attempt={attempt}
                          feedbackSource={feedbackAttemptIds.has(attempt.id)}
                          geometry={geometry.get(attempt.id)}
                          key={attempt.id}
                          live={live && attempt.status === 'running'}
                          selected={selectedAttemptKey === attempt.id}
                          subject={workItem.subject}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <TimelineMessages
        range={range}
        trace={trace}
        onSelectMessage={onSelectMessage}
      />
    </div>
  );
}

function TimelineMessages({
  range,
  trace,
  onSelectMessage,
}: {
  readonly range: ReturnType<typeof capturedTimelineRange>;
  readonly trace: Trace;
  readonly onSelectMessage: (messageId: string) => void;
}) {
  if (!range) return null;
  const start = Date.parse(range.startedAt);
  const end = Date.parse(range.endedAt);
  const span = end - start;
  if (!span) return null;

  const actorNames = new Map(
    trace.actors.map((a) => [a.id, a.name ?? 'Name not captured']),
  );
  const messages = new Map(trace.messages.map((m) => [m.id, m]));
  const messageEdges = trace.edges.filter(
    (edge) => edge.kind === 'observed_message' && edge.source_created_at,
  );

  if (!messageEdges.length) return null;

  return (
    <div
      className="run-trace__timeline-messages"
      aria-label="Message markers"
      data-testid="timeline-messages"
    >
      {messageEdges.map((edge) => {
        if (edge.kind !== 'observed_message') return null;
        const ts = Date.parse(edge.source_created_at);
        const position = ((ts - start) / span) * 100;
        if (position < 0 || position > 100) return null;
        const senderName = edge.sender_actor_id
          ? actorNames.get(edge.sender_actor_id)
          : null;
        const recipientName = actorNames.get(edge.recipient_actor_id);
        const message = messages.get(edge.message_id);
        const canDrawLine =
          edge.sender_actor_id !== null && edge.recipient_actor_id !== null;
        return (
          <button
            className={`run-trace__message-marker${canDrawLine ? '' : ' run-trace__message-marker--partial'}`}
            data-testid="timeline-message-marker"
            key={edge.message_id}
            onClick={() => onSelectMessage(edge.message_id)}
            style={{ '--marker-position': `${position}%` } as CSSProperties}
            title={message?.summary ?? 'Message summary not captured'}
            type="button"
          >
            <span className="run-trace__message-marker-label">
              {senderName ?? '?'} → {recipientName ?? '?'}
            </span>
          </button>
        );
      })}
    </div>
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
      {range ? (
        <>
          <span aria-hidden="true" style={{ display: 'none' }}>
            {range.startedAt}
          </span>
          <span aria-hidden="true" style={{ display: 'none' }}>
            {range.endedAt}
          </span>
        </>
      ) : null}
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
  activityCount,
  attempt,
  feedbackSource,
  geometry,
  live,
  selected,
  onSelect,
  subject,
}: {
  readonly activityCount: number;
  readonly attempt: Attempt;
  readonly feedbackSource: boolean;
  readonly geometry: Geometry | undefined;
  readonly live: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly subject: string;
}) {
  if (!geometry)
    return (
      <button
        aria-label={`${subject}, Attempt ${attempt.attempt_no}, timing not captured`}
        aria-pressed={selected}
        className="run-trace__attempt-unpositioned"
        onClick={() => onSelect(attempt.id)}
        type="button"
      >
        Attempt {attempt.attempt_no} · Timing not captured
      </button>
    );
  return (
    <button
      aria-label={`${subject}, Attempt ${attempt.attempt_no}, ${durationLabel(attempt)}`}
      aria-pressed={selected}
      className={`run-trace__attempt${live ? ' run-trace__attempt--live' : ''}`}
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
      {activityCount > 0 ? (
        <span
          className="run-trace__activity-ticks"
          aria-label={`${activityCount} MCP activities`}
          data-testid="activity-ticks"
        >
          {Array.from({ length: Math.min(activityCount, 12) }, (_, i) => (
            <span
              className="run-trace__activity-tick"
              key={i}
              style={
                {
                  '--tick-offset': `${((i + 1) / (Math.min(activityCount, 12) + 1)) * 100}%`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      ) : null}
    </button>
  );
}

export function MapView({
  selectedAttemptKey,
  trace,
  onSelect,
  onSelectMessage,
}: {
  readonly selectedAttemptKey: string | null;
  readonly trace: Trace;
  readonly onSelect: (id: string) => void;
  readonly onSelectMessage?: (messageId: string) => void;
}) {
  const entries = attemptsFrom(trace);
  const levels = workItemLevels(trace.work_items);
  return (
    <section
      className="run-trace__map"
      data-testid="trace-map"
      aria-label="Run causal map"
    >
      <div className="run-trace__map-heading">
        <div>
          <strong>Causal map</strong>
          <p>
            Work Item Attempts are nodes. Duration is deliberately not encoded.
          </p>
        </div>
        <span>{entries.length} Attempt node(s)</span>
      </div>
      <div className="run-trace__map-board">
        {entries.map((entry) => {
          const actor = trace.actors.find(
            (candidate) => candidate.id === entry.workItem.actor_id,
          );
          const level =
            (levels.get(entry.workItem.id) ?? 0) +
            Math.max(0, entry.attempt.attempt_no - 1);
          const interactions = interactionsForWorkItem(
            trace,
            entry.workItem.id,
          );
          return (
            <button
              aria-pressed={selectedAttemptKey === entry.attempt.id}
              className={`run-trace__map-node ${actorTone(actor?.id ?? entry.workItem.id)}`}
              data-map-level={level}
              key={entry.attempt.id}
              onClick={() => onSelect(entry.attempt.id)}
              style={{ '--map-level': level } as CSSProperties}
              type="button"
            >
              <span className="run-trace__map-node-agent">
                {actor?.name ?? 'Name not captured'}
              </span>
              <strong>{entry.workItem.subject}</strong>
              <span>
                Attempt {entry.attempt.attempt_no} ·{' '}
                {humanize(entry.attempt.status)}
              </span>
              {interactions.messages || interactions.activities ? (
                <small>
                  {interactions.messages} msg · {interactions.activities} MCP
                </small>
              ) : null}
            </button>
          );
        })}
      </div>
      <MapRelations trace={trace} onSelectMessage={onSelectMessage} />
    </section>
  );
}

function MapRelations({
  trace,
  onSelectMessage,
}: {
  readonly trace: Trace;
  readonly onSelectMessage?: (messageId: string) => void;
}) {
  const itemNames = new Map(
    trace.work_items.map((item) => [item.id, item.subject]),
  );
  const actorNames = new Map(
    trace.actors.map((actor) => [actor.id, actor.name ?? 'Name not captured']),
  );
  const attempts = new Map(
    attemptsFrom(trace).map((entry) => [entry.attempt.id, entry]),
  );
  const rows = trace.edges.flatMap((edge, index) => {
    if (edge.kind === 'declared_dependency')
      return [
        {
          key: `dep:${index}`,
          kind: 'Dependency',
          text: `${itemNames.get(edge.prerequisite_work_item_id) ?? 'Work Item'} → ${itemNames.get(edge.dependent_work_item_id) ?? 'Work Item'}`,
        },
      ];
    if (edge.kind === 'assignment')
      return [
        {
          key: `assign:${index}`,
          kind: 'Assignment',
          text: `${actorNames.get(edge.assignee_actor_id) ?? 'Agent'} → ${itemNames.get(edge.work_item_id) ?? 'Work Item'}`,
        },
      ];
    if (edge.kind === 'feedback') {
      const entry = edge.attempt_id ? attempts.get(edge.attempt_id) : null;
      return [
        {
          key: `feedback:${index}`,
          kind: 'Feedback',
          text: `${edge.reviewer_actor_id ? (actorNames.get(edge.reviewer_actor_id) ?? 'Reviewer') : 'Reviewer'} → ${entry ? `${entry.workItem.subject} / Attempt ${entry.attempt.attempt_no}` : (itemNames.get(edge.work_item_id) ?? 'Work Item')}`,
        },
      ];
    }
    if (edge.kind === 'observed_message')
      return [
        {
          key: `message:${edge.message_id}`,
          kind: 'Message',
          text: `${edge.sender_actor_id ? (actorNames.get(edge.sender_actor_id) ?? 'Agent') : 'System'} → ${actorNames.get(edge.recipient_actor_id) ?? 'Agent'}`,
        },
      ];
    return [];
  });
  return (
    <div
      className="run-trace__map-relations"
      aria-label="Captured causal relations"
    >
      <h4>Captured relations</h4>
      {rows.length ? (
        rows.map((row) => {
          const messageId = row.key.startsWith('message:')
            ? row.key.slice(8)
            : null;
          return messageId && onSelectMessage ? (
            <button
              className="run-trace__map-relation run-trace__map-relation--clickable"
              key={row.key}
              onClick={() => onSelectMessage(messageId)}
              type="button"
            >
              <span>{row.kind}</span>
              <p>{row.text}</p>
            </button>
          ) : (
            <div className="run-trace__map-relation" key={row.key}>
              <span>{row.kind}</span>
              <p>{row.text}</p>
            </div>
          );
        })
      ) : (
        <p>No relation rows were captured.</p>
      )}
    </div>
  );
}

function Events({
  trace,
  onSelectAttempt,
}: {
  readonly trace: Trace;
  readonly onSelectAttempt: (id: string) => void;
}) {
  const actors = new Map(trace.actors.map((actor) => [actor.id, actor]));
  const items = new Map(trace.work_items.map((item) => [item.id, item]));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  return (
    <section
      className="run-trace__events"
      aria-label="Recorded MCP activities"
      data-testid="trace-events"
    >
      <p className="run-trace__events-caption">
        Recorded MCP activities. Sequence values are shown as captured; no
        additional ordering or timing is inferred. This panel counts only calls
        to server-authorized team collaboration MCP tools (message_send,
        board_submit, and similar); other tool or agent activity in this Run is
        not included here and is shown in Agent Execution and Session
        Transcripts instead.
      </p>
      <div className="run-trace__events-toolbar">
        <strong>Recorded MCP activities</strong>
        <span>{trace.mcp_activities.length} captured rows</span>
      </div>
      <div className="run-trace__events-scroll">
        {trace.mcp_activities.length === 0 ? (
          <p style={{ padding: '1rem', color: '#666' }}>
            No collaboration MCP tool calls were captured for this Run. This may
            mean this Run's members did not call any of the collaboration MCP
            tools listed above, or that identity/provenance details for such
            calls were not fully captured.
          </p>
        ) : (
          trace.mcp_activities.map((activity, snapshotOrdinal) => {
            const actor = activity.source_refs.actor_id
              ? actors.get(activity.source_refs.actor_id)
              : null;
            const item = activity.source_refs.work_item_id
              ? items.get(activity.source_refs.work_item_id)
              : null;
            const key = activitySnapshotIdentity(
              activity.activity_id,
              snapshotOrdinal,
            );
            const isSelected = selectedKey === key;
            return (
              <button
                aria-pressed={isSelected}
                className="run-trace__event"
                key={key}
                tabIndex={0}
                type="button"
                onClick={() => {
                  setSelectedKey(isSelected ? null : key);
                  // Only select an Attempt when attribution is unambiguous (exactly one Attempt).
                  // MCP activity source_refs do not capture attempt_id; selecting the "last"
                  // Attempt would fabricate causality for reworked Work Items (§1.2, §6.2).
                  if (item?.attempts.length === 1)
                    onSelectAttempt(item.attempts[0]!.id);
                }}
              >
                <strong>#{activity.sequence}</strong>
                <span>{actor?.name ?? 'Name not captured'}</span>
                <span>{item?.subject ?? 'Work Item not captured'}</span>
                <span>{`MCP activity: ${humanize(activity.status)}`}</span>
                <span>{activity.tool_name}</span>
                <span>{`Result: ${captureLabel(activity.result_capture_status)}`}</span>
                {item && item.attempts.length > 1 ? (
                  <span
                    className="run-trace__event-uncaptured"
                    data-testid="attempt-not-captured"
                  >
                    Attempt attribution not captured
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function Inspector({
  mode,
  selectedAttempt,
  selectedMessageId,
  trace,
  onMode,
}: {
  readonly mode: InspectorMode;
  readonly selectedAttempt: Entry | null;
  readonly selectedMessageId: string | null;
  readonly trace: Trace;
  readonly onMode: (mode: InspectorMode) => void;
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
      <h3 id="trace-inspector-heading">Execution Inspector</h3>
      {selectedAttempt ? (
        <>
          <div className="run-trace__selected-execution">
            <h4>{selectedAttempt.workItem.subject}</h4>
            <p>{actor?.name ?? 'Name not captured'}</p>
          </div>
          <div
            className="run-trace__inspector-tabs"
            role="tablist"
            aria-label="Inspector detail"
          >
            {(['overview', 'conversation', 'activity'] as const).map((item) => (
              <button
                aria-selected={mode === item}
                key={item}
                onClick={() => onMode(item)}
                role="tab"
                type="button"
              >
                {item[0]!.toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          {mode === 'overview' ? (
            <InspectorOverview
              actorName={actor?.name ?? 'Name not captured'}
              selectedAttempt={selectedAttempt}
            />
          ) : null}
          {mode === 'conversation' ? (
            <ConversationDetail
              selectedAttempt={selectedAttempt}
              selectedMessageId={selectedMessageId}
              trace={trace}
            />
          ) : null}
          {mode === 'activity' ? (
            <ActivityDetail selectedAttempt={selectedAttempt} trace={trace} />
          ) : null}
        </>
      ) : (
        <p className="run-trace__unavailable">
          Select an Attempt to inspect recorded facts.
        </p>
      )}
    </aside>
  );
}

function InspectorOverview({
  actorName,
  selectedAttempt,
}: {
  readonly actorName: string;
  readonly selectedAttempt: Entry;
}) {
  return (
    <>
      <InspectorGroup title="Identity">
        <Fact label="Work Item" value={selectedAttempt.workItem.subject} />
        <Fact label="Agent" value={actorName} />
      </InspectorGroup>
      <InspectorGroup title="Execution facts">
        <Fact label="State" value={humanize(selectedAttempt.attempt.status)} />
        <Fact
          label="Attempt"
          value={`${selectedAttempt.attempt.attempt_no} / ${selectedAttempt.workItem.attempts.length}`}
        />
        <Fact
          label="Started"
          value={recordedTimestamp(selectedAttempt.attempt.started_at)}
        />
        <Fact
          label="Ended"
          value={recordedTimestamp(selectedAttempt.attempt.ended_at)}
        />
        <Fact label="Duration" value={durationLabel(selectedAttempt.attempt)} />
      </InspectorGroup>
      <InspectorGroup title="Result / feedback">
        <Fact
          label="Result"
          value={
            selectedAttempt.attempt.result_summary ??
            captureLabel(selectedAttempt.attempt.result_capture_status)
          }
        />
        <Fact
          label="Feedback"
          value={
            selectedAttempt.attempt.feedback_summary ??
            captureLabel(selectedAttempt.attempt.feedback_capture_status)
          }
        />
      </InspectorGroup>
    </>
  );
}

function ConversationDetail({
  selectedAttempt,
  selectedMessageId,
  trace,
}: {
  readonly selectedAttempt: Entry;
  readonly selectedMessageId: string | null;
  readonly trace: Trace;
}) {
  const relevantEdges = trace.edges.filter(
    (edge) =>
      edge.kind === 'observed_message' &&
      (edge.attempt_id === selectedAttempt.attempt.id ||
        edge.work_item_id === selectedAttempt.workItem.id ||
        edge.message_id === selectedMessageId),
  );
  const messages = new Map(
    trace.messages.map((message) => [message.id, message]),
  );
  return (
    <section
      className="run-trace__transcript"
      data-testid="attempt-conversation"
    >
      <p className="run-trace__detail-disclosure">
        Product Trace currently captures Agent-to-Agent message summaries, not
        the full provider transcript. Full execution text is not inferred from
        technical RuntimeSession or TeamRun APIs.
      </p>
      {relevantEdges.length ? (
        relevantEdges.map((edge) => {
          if (edge.kind !== 'observed_message') return null;
          const message = messages.get(edge.message_id);
          return (
            <article
              className={
                selectedMessageId === edge.message_id
                  ? 'run-trace__message--targeted'
                  : undefined
              }
              data-message-id={edge.message_id}
              key={edge.message_id}
              ref={
                selectedMessageId === edge.message_id
                  ? (el) => {
                      if (el)
                        el.scrollIntoView({
                          behavior: 'smooth',
                          block: 'nearest',
                        });
                    }
                  : undefined
              }
            >
              <header>
                <strong>{message?.sender_name ?? 'Agent'}</strong>
                <span>→ {message?.recipient_name ?? 'Agent'}</span>
              </header>
              <p>
                {message?.summary ??
                  'Message body not captured in the Product projection.'}
              </p>
              <time dateTime={edge.source_created_at}>
                {formatTimestamp(edge.source_created_at)}
              </time>
            </article>
          );
        })
      ) : (
        <p>
          No Agent-to-Agent message is associated with this Work Item Attempt.
        </p>
      )}
      {selectedAttempt.attempt.result_summary ? (
        <article className="run-trace__transcript-result">
          <header>
            <strong>Agent result</strong>
          </header>
          <p>{selectedAttempt.attempt.result_summary}</p>
        </article>
      ) : null}
    </section>
  );
}

function ActivityDetail({
  selectedAttempt,
  trace,
}: {
  readonly selectedAttempt: Entry;
  readonly trace: Trace;
}) {
  const activities = trace.mcp_activities.filter(
    (activity) =>
      activity.source_refs.work_item_id === selectedAttempt.workItem.id,
  );
  return (
    <section
      className="run-trace__activity-detail"
      data-testid="attempt-activity"
    >
      <p className="run-trace__detail-disclosure">
        MCP dispatch/confirmation is safe structured activity. Direct shell,
        file edit and other non-MCP execution remain outside this trace.
      </p>
      {activities.length ? (
        activities.map((activity, index) => (
          <article
            key={`${activity.activity_id}:${activity.sequence}:${index}`}
          >
            <div>
              <strong>{activity.tool_name}</strong>
              <span>{humanize(activity.category)}</span>
            </div>
            <span
              className={`run-trace__activity-status run-trace__activity-status--${activity.status}`}
            >
              {humanize(activity.status)}
            </span>
            <p>Result: {captureLabel(activity.result_capture_status)}</p>
          </article>
        ))
      ) : (
        <p>No MCP activity is associated with this Work Item.</p>
      )}
    </section>
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

function actorRowsFrom(trace: Trace) {
  const rows = trace.actors.map((actor) => ({
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
    rows.push({
      key: 'uncaptured-actor',
      name: 'Name not captured',
      items: unassignedItems,
    });
  return rows;
}

function workItemLevels(
  items: readonly WorkItem[],
): ReadonlyMap<string, number> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const cache = new Map<string, number>();
  const visiting = new Set<string>();
  const level = (id: string): number => {
    const known = cache.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const item = byId.get(id);
    const next = item?.dependency_ids.length
      ? 1 +
        Math.max(
          ...item.dependency_ids.filter((dep) => byId.has(dep)).map(level),
          0,
        )
      : 0;
    visiting.delete(id);
    cache.set(id, next);
    return next;
  };
  for (const item of items) level(item.id);
  return cache;
}

function interactionsForWorkItem(trace: Trace, workItemId: string) {
  return {
    messages: trace.edges.filter(
      (edge) =>
        edge.kind === 'observed_message' && edge.work_item_id === workItemId,
    ).length,
    activities: trace.mcp_activities.filter(
      (activity) => activity.source_refs.work_item_id === workItemId,
    ).length,
  };
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
  return timestamp ?? 'Not captured';
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
function longestAttemptMs(trace: Trace): number | null {
  let max: number | null = null;
  for (const item of trace.work_items)
    for (const attempt of item.attempts)
      if (
        attempt.duration_ms !== null &&
        (max === null || attempt.duration_ms > max)
      )
        max = attempt.duration_ms;
  return max;
}
function formatActiveDuration(items: readonly WorkItem[]) {
  const milliseconds = items.reduce(
    (total, item) =>
      total +
      item.attempts.reduce(
        (sum, attempt) => sum + (attempt.duration_ms ?? 0),
        0,
      ),
    0,
  );
  if (!milliseconds) return 'active time not captured';
  const minutes = Math.round(milliseconds / 60_000);
  return minutes
    ? `${minutes}m active`
    : `${Math.round(milliseconds / 1000)}s active`;
}
function formatClock(value: Date) {
  return value.toISOString().slice(11, 16);
}
function formatRelative(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60_000);
  return minutes ? `${minutes}m` : `${Math.round(milliseconds / 1000)}s`;
}
function formatTimestamp(value: string) {
  return `${value.replace('T', ' ').slice(0, 19)} UTC`;
}
function activitySnapshotIdentity(activityId: string, snapshotOrdinal: number) {
  return `${activityId}:${snapshotOrdinal}`;
}
