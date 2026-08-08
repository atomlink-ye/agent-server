import { useEffect, useRef } from 'react';
import {
  selectActivityEntries,
  selectChildEntriesByParent,
} from '@/lib/stream-reducer';
import type {
  ApprovalEntry,
  TimelineActivityEntry,
  TimelineChildEntry,
  TimelineState,
  TimelineToolEntry,
  UsageEntry,
} from '@/lib/stream-reducer';

type ActivityPanelProps = {
  readonly timeline: TimelineState;
  readonly runId: string;
  readonly active: boolean;
  readonly replayAvailable?: boolean;
  readonly replayLoading?: boolean;
};

export function ActivityPanel({
  timeline,
  runId,
  active,
  replayAvailable = true,
  replayLoading = false,
}: ActivityPanelProps) {
  const entries = selectActivityEntries(timeline, runId);
  const childrenByParent = selectChildEntriesByParent(timeline, runId);
  const hasActivity = entries.length > 0;
  if (!hasActivity && replayAvailable && !replayLoading && !active) return null;
  return (
    <div className="activity-panel" aria-label="Execution activity">
      {replayLoading && !hasActivity ? (
        <p className="activity-unavailable">
          {active ? 'Waiting for runtime activity…' : 'Loading saved activity…'}
        </p>
      ) : null}
      {!replayLoading && !replayAvailable ? (
        <p className="activity-unavailable">
          Activity details are not available for this turn.
        </p>
      ) : null}
      <div className="activity-list">
        {entries.map((entry) => {
          const key = `${entry.activityId.scope}:${entry.activityId.value}`;
          if (entry.kind === 'thinking')
            return <ThinkingRow key={key} active={active} entry={entry} />;
          if (entry.kind === 'tool') {
            return entry.category === 'subagent' ? (
              <SubagentRow
                key={key}
                active={active}
                entry={entry}
                children={childrenByParent.get(entry.activityId.value) ?? []}
              />
            ) : (
              <ToolRow key={key} entry={entry} />
            );
          }
          if (entry.kind === 'approval')
            return <PermissionRow key={key} entry={entry} />;
          return <UsageRow key={key} entry={entry} />;
        })}
      </div>
    </div>
  );
}

type ActivityIconKind =
  'reasoning' | 'tool' | 'subagent' | 'permission' | 'usage';

function ActivityIcon({
  kind,
  status,
}: {
  readonly kind: ActivityIconKind;
  readonly status: string;
}) {
  const failed = status === 'failed' || status === 'cancelled';
  return (
    <span
      className={`activity-icon ${kind} ${failed ? 'is-failed' : ''}`}
      aria-hidden="true"
    >
      {failed ? (
        <svg viewBox="0 0 20 20" focusable="false">
          <circle cx="10" cy="10" r="7.2" />
          <path d="M10 6.5v4.2M10 13.5h.01" />
        </svg>
      ) : kind === 'reasoning' ? (
        <svg viewBox="0 0 20 20" focusable="false">
          <path d="m10 2 1.35 5.3L17 9l-5.65 1.7L10 16l-1.35-5.3L3 9l5.65-1.7L10 2Z" />
        </svg>
      ) : kind === 'subagent' ? (
        <svg viewBox="0 0 20 20" focusable="false">
          <circle cx="10" cy="4" r="2" />
          <circle cx="5" cy="15" r="2" />
          <circle cx="15" cy="15" r="2" />
          <path d="M10 6v4M10 10 5 13M10 10l5 3" />
        </svg>
      ) : kind === 'permission' ? (
        <svg viewBox="0 0 20 20" focusable="false">
          <rect x="4" y="8.5" width="12" height="8" rx="2" />
          <path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" />
        </svg>
      ) : kind === 'usage' ? (
        <svg viewBox="0 0 20 20" focusable="false">
          <path d="M4 15V9M10 15V5M16 15v-3" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" focusable="false">
          <path d="m12.8 3.5 3.7 3.7-2.3 2.3-3.7-3.7 2.3-2.3ZM3.5 16.5l1.2-4.2 4.2 1.2-1.2 2-4.2 1Z" />
          <path d="m9.3 7.3-4.8 4.8M12.9 10.9l-2.1 2.1" />
        </svg>
      )}
    </span>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="activity-chevron"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

function UsageRow({ entry }: { readonly entry: UsageEntry }) {
  const usage = entry.usage;
  const values = [
    usage.inputTokens === undefined
      ? null
      : `${usage.inputTokens.toLocaleString()} input`,
    usage.outputTokens === undefined
      ? null
      : `${usage.outputTokens.toLocaleString()} output`,
    usage.totalCostUsd === undefined
      ? null
      : `$${usage.totalCostUsd.toFixed(4)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="activity-usage">
      <ActivityIcon kind="usage" status="completed" />
      <span>Usage</span>
      <strong>{values || 'Reported'}</strong>
    </div>
  );
}

function ThinkingRow({
  active,
  entry,
}: {
  readonly active: boolean;
  readonly entry: Extract<TimelineActivityEntry, { readonly kind: 'thinking' }>;
}) {
  const { status, text } = entry;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!active || status !== 'started' || !text || autoOpenedRef.current)
      return;
    if (detailsRef.current) {
      detailsRef.current.open = true;
      autoOpenedRef.current = true;
    }
  }, [active, status, text]);

  const rowClass = `activity-item activity-row ${status === 'started' ? 'is-running' : ''}`;
  const content = (
    <>
      <ActivityIcon
        kind="reasoning"
        status={status === 'started' ? 'running' : 'completed'}
      />
      <span className="activity-item-copy">
        <strong>Thinking</strong>
        <small>
          {status === 'started'
            ? 'Organizing the request'
            : 'Request organized'}
        </small>
      </span>
      <span className="sr-only">{status}</span>
    </>
  );
  if (!text)
    return <div className={`${rowClass} activity-row-static`}>{content}</div>;
  return (
    <details ref={detailsRef} className={rowClass}>
      <summary>
        {content}
        <ChevronIcon />
      </summary>
      <div className="activity-detail">{text}</div>
    </details>
  );
}

function ToolRow({
  entry,
  nested = false,
}: {
  readonly entry: TimelineToolEntry;
  readonly nested?: boolean;
}) {
  const tool = entry;
  const rowClass = `activity-item activity-row tool-item ${nested ? 'nested-tool-item' : ''} ${tool.status === 'running' ? 'is-running' : ''} ${tool.status === 'failed' || tool.status === 'cancelled' ? 'is-failed' : ''}`;
  const content = (
    <>
      <ActivityIcon kind="tool" status={tool.status} />
      <span className="activity-item-copy">
        <strong>{tool.label}</strong>
        <small>{tool.summary}</small>
      </span>
      {tool.detailKind ? <DetailIcon kind={tool.detailKind} /> : null}
      <span className="sr-only">{tool.status}</span>
    </>
  );
  if (!tool.detailText)
    return <div className={`${rowClass} activity-row-static`}>{content}</div>;
  return (
    <details className={rowClass}>
      <summary>
        {content}
        <ChevronIcon />
      </summary>
      <DetailContent text={tool.detailText} exitCode={tool.exitCode} />
    </details>
  );
}

function DetailIcon({ kind }: { readonly kind: string }) {
  return (
    <span
      className={`activity-detail-icon detail-${kind}`}
      title={kind}
      aria-hidden="true"
    >
      {kind === 'shell'
        ? '⌘'
        : kind === 'read'
          ? '◉'
          : kind === 'search'
            ? '⌕'
            : '·'}
    </span>
  );
}

function DetailContent({
  text,
  exitCode,
}: {
  readonly text: string;
  readonly exitCode?: number;
}) {
  return (
    <div className="activity-detail" role="note">
      <div>{text}</div>
      {exitCode !== undefined ? <small>Exit code: {exitCode}</small> : null}
    </div>
  );
}

function SubagentRow({
  active,
  entry,
  children,
}: {
  readonly active: boolean;
  readonly entry: TimelineToolEntry;
  readonly children: readonly TimelineChildEntry[];
}) {
  const tool = entry;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (
      !active ||
      tool.status !== 'running' ||
      children.length === 0 ||
      autoOpenedRef.current
    )
      return;
    if (detailsRef.current) {
      detailsRef.current.open = true;
      autoOpenedRef.current = true;
    }
  }, [active, children.length, tool.status]);
  return (
    <details
      ref={detailsRef}
      className={`activity-item activity-row subagent-item ${tool.status === 'running' ? 'is-running' : ''} ${tool.status === 'failed' || tool.status === 'cancelled' ? 'is-failed' : ''}`}
    >
      <summary>
        <ActivityIcon kind="subagent" status={tool.status} />
        <span className="activity-item-copy">
          <strong>{tool.label}</strong>
          <small>{tool.summary}</small>
        </span>
        <span className="sr-only">{tool.status}</span>
        <ChevronIcon />
      </summary>
      {children.length > 0 ? (
        <div className="subagent-children" aria-label="Subagent activity">
          {children.map((child) => (
            <ChildRow
              key={`${child.activityId.scope}:${child.activityId.value}`}
              active={active}
              child={child}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function ChildRow({
  active,
  child,
}: {
  readonly active: boolean;
  readonly child: TimelineChildEntry;
}) {
  const iconKind: ActivityIconKind =
    child.kind === 'thinking'
      ? 'reasoning'
      : child.kind === 'agentText'
        ? 'subagent'
        : 'tool';
  const isTextChild = child.kind === 'thinking' || child.kind === 'agentText';
  const semanticLabel = child.kind === 'agentText' ? 'Assistant' : 'Thinking';
  const fullText = isTextChild
    ? (distinctText(child.detailText, semanticLabel) ??
      distinctText(child.summary, semanticLabel) ??
      '')
    : child.detailText?.trim() || '';
  const preview = isTextChild
    ? compactPreview(distinctText(child.summary, semanticLabel) ?? fullText)
    : child.summary;
  const rowClass = `activity-item activity-row nested-tool-item ${child.status === 'running' ? 'is-running' : ''} ${child.status === 'failed' || child.status === 'cancelled' ? 'is-failed' : ''}`;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (
      !active ||
      !isTextChild ||
      child.status !== 'running' ||
      !fullText ||
      autoOpenedRef.current
    )
      return;
    if (detailsRef.current) {
      detailsRef.current.open = true;
      autoOpenedRef.current = true;
    }
  }, [active, child.status, fullText, isTextChild]);
  const content = (
    <>
      <ActivityIcon kind={iconKind} status={child.status} />
      <span className="activity-item-copy">
        <strong>
          {child.kind === 'thinking'
            ? 'Thinking'
            : child.kind === 'agentText'
              ? 'Assistant'
              : child.label}
        </strong>
        <small>{isTextChild ? preview : child.summary}</small>
      </span>
      {child.detailKind ? <DetailIcon kind={child.detailKind} /> : null}
      <span className="sr-only">{child.status}</span>
    </>
  );
  if (!fullText)
    return preview ? (
      <div className={`${rowClass} activity-row-static`}>{content}</div>
    ) : null;
  return (
    <details ref={detailsRef} className={rowClass}>
      <summary>
        {content}
        <ChevronIcon />
      </summary>
      <DetailContent text={fullText} exitCode={child.exitCode} />
    </details>
  );
}

function distinctText(text: string | undefined, semanticLabel: string) {
  const trimmed = text?.trim() ?? '';
  if (
    !trimmed ||
    trimmed === 'Thinking' ||
    trimmed === 'Reasoning' ||
    trimmed === 'Assistant' ||
    trimmed === semanticLabel
  )
    return undefined;
  return trimmed;
}

function compactPreview(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (firstLine.length <= 120) return firstLine;
  return `${firstLine.slice(0, 117).trimEnd()}…`;
}

function PermissionRow({ entry }: { readonly entry: ApprovalEntry }) {
  const permission = entry;
  const decision = permission.decision ? ` · ${permission.decision}` : '';
  return (
    <details
      className={`activity-item activity-row permission-item ${permission.status === 'requested' ? 'is-running' : ''}`}
    >
      <summary>
        <ActivityIcon
          kind="permission"
          status={permission.status === 'requested' ? 'running' : 'completed'}
        />
        <span className="activity-item-copy">
          <strong>Permission check</strong>
          <small>{permission.summary}</small>
        </span>
        <span className="sr-only">
          {permission.status}
          {decision}
        </span>
        <ChevronIcon />
      </summary>
      <p>
        {permission.status === 'requested'
          ? 'This event is informational. Approval actions are not available in this MVE.'
          : permission.summary}
      </p>
    </details>
  );
}
