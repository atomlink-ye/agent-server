import { useEffect, useRef } from 'react';
import { deriveToolActivityGroups } from '@/lib/stream-reducer';
import type {
  ChildProjection,
  PermissionProjection,
  StreamProjection,
  ToolProjection,
} from '@/lib/stream-reducer';

type ActivityPanelProps = {
  readonly projection: StreamProjection;
  readonly active: boolean;
  readonly replayAvailable?: boolean;
  readonly replayLoading?: boolean;
};

export function ActivityPanel({
  projection,
  active,
  replayAvailable = true,
  replayLoading = false,
}: ActivityPanelProps) {
  const tools = Object.values(projection.tools);
  const { roots, childrenByParent } = deriveToolActivityGroups(
    projection.tools,
    projection.childrenByParent,
    projection.activityOrder,
  );
  const permissions = Object.values(projection.permissions);
  const childCount = Object.values(projection.childrenByParent).reduce(
    (count, children) => count + children.length,
    0,
  );
  const hasActivity =
    projection.reasoning ||
    tools.length > 0 ||
    childCount > 0 ||
    permissions.length > 0 ||
    projection.usage;
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
        {projection.reasoning ? (
          <ThinkingRow
            active={active}
            status={projection.reasoning.status}
            text={projection.reasoning.text}
          />
        ) : null}
        {roots.map((tool) =>
          tool.category === 'subagent' ? (
            <SubagentRow
              key={tool.activityId}
              active={active}
              tool={tool}
              children={childrenByParent[tool.activityId] ?? []}
            />
          ) : (
            <ToolRow key={tool.activityId} tool={tool} />
          ),
        )}
        {projection.usage ? <UsageRow projection={projection} /> : null}
        {permissions.map((permission) => (
          <PermissionRow key={permission.activityId} permission={permission} />
        ))}
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

function UsageRow({ projection }: { readonly projection: StreamProjection }) {
  const usage = projection.usage;
  if (!usage) return null;
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
  status,
  text,
}: {
  readonly active: boolean;
  readonly status: 'started' | 'completed';
  readonly text?: string;
}) {
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
  tool,
  nested = false,
}: {
  readonly tool: ToolProjection;
  readonly nested?: boolean;
}) {
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
  tool,
  children,
}: {
  readonly active: boolean;
  readonly tool: ToolProjection;
  readonly children: readonly ChildProjection[];
}) {
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
            <ChildRow key={child.activityId} active={active} child={child} />
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
  readonly child: ChildProjection;
}) {
  const iconKind: ActivityIconKind =
    child.kind === 'reasoning'
      ? 'reasoning'
      : child.kind === 'assistant'
        ? 'subagent'
        : 'tool';
  const isTextChild = child.kind === 'reasoning' || child.kind === 'assistant';
  const semanticLabel = child.kind === 'assistant' ? 'Assistant' : 'Thinking';
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
          {child.kind === 'reasoning'
            ? 'Thinking'
            : child.kind === 'assistant'
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

function PermissionRow({
  permission,
}: {
  readonly permission: PermissionProjection;
}) {
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
