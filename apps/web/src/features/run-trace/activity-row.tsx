import { buildEntryPresentation } from './transcript-presentation';
import type { ProjectedTranscriptEntry } from './transcript-projection';

export function ActivityRow({
  entry,
  nested = false,
  terminalRun = false,
}: {
  readonly entry: ProjectedTranscriptEntry;
  readonly nested?: boolean;
  readonly terminalRun?: boolean;
}) {
  const presentation = buildEntryPresentation(entry.event, { terminalRun });
  const children = entry.children?.length ? (
    <div className="transcript__children">
      {entry.children.map((child) => (
        <ActivityRow
          entry={child}
          key={child.sourceOrdinals.join(':')}
          nested
          terminalRun={terminalRun}
        />
      ))}
    </div>
  ) : null;
  const expandable = presentation.expandable || Boolean(children);
  const rowKind =
    entry.event.kind === 'reasoning_progress'
      ? 'reasoning'
      : entry.event.kind === 'tool_status'
        ? 'tool'
        : 'other';
  const attributes = {
    'data-detail-source-ordinals': entry.detailSourceOrdinals.join(','),
    'data-source-ordinals': entry.sourceOrdinals.join(','),
    'data-testid': 'transcript-activity-row',
    'data-transcript-row-kind': rowKind,
    'data-transcript-row-mode': expandable ? 'expandable' : 'static',
    ...(presentation.platformToolName
      ? {
          'data-platform-tool': 'true',
          'data-tool-name': presentation.platformToolName,
        }
      : {}),
  } as const;
  const content = (
    <RowContent
      entry={entry}
      expandable={expandable}
      terminalRun={terminalRun}
    />
  );
  const platformStatus =
    entry.event.kind === 'tool_status' ? entry.event.status : '';
  if (!expandable)
    return (
      <div
        className={`transcript__row transcript__row--static ${nested ? 'transcript__row--nested' : ''}`}
        {...attributes}
      >
        {content}
      </div>
    );
  return (
    <details
      className={`transcript__row ${presentation.platformToolName ? 'transcript__row--platform' : ''} ${nested ? 'transcript__row--nested' : ''} ${presentation.tone === 'running' ? 'is-running' : ''}`}
      {...attributes}
    >
      <summary>{content}</summary>
      <div className="transcript__detail">
        {presentation.platformToolName ? (
          <PlatformToolDetail
            name={presentation.platformToolName}
            status={platformStatus}
          />
        ) : (
          <>
            {presentation.detailText ? (
              <pre>{presentation.detailText}</pre>
            ) : null}
            {presentation.exitCode !== null ? (
              <small>Exit code: {presentation.exitCode}</small>
            ) : null}
          </>
        )}
        {children}
      </div>
    </details>
  );
}

function RowContent({
  entry,
  expandable,
  terminalRun,
}: {
  readonly entry: ProjectedTranscriptEntry;
  readonly expandable: boolean;
  readonly terminalRun: boolean;
}) {
  const presentation = buildEntryPresentation(entry.event, { terminalRun });
  const status = entry.event.kind === 'tool_status' ? entry.event.status : null;
  const duration = formatDuration(entry.startedAt, entry.endedAt);
  return (
    <>
      <span className="transcript__icon-slot">
        <ActivityIcon
          icon={presentation.tone === 'failed' ? 'error' : presentation.icon}
        />
        {expandable ? (
          <span className="transcript__chevron" aria-hidden="true">
            ⌄
          </span>
        ) : null}
      </span>
      <span className="transcript__row-copy">
        {presentation.origin ? (
          <em className="transcript__origin">{presentation.origin}</em>
        ) : null}
        <strong>{presentation.label}</strong>
        {presentation.summary ? <small>{presentation.summary}</small> : null}
        {status ? (
          <small className={`transcript__status transcript__status--${status}`}>
            {status === 'completed' ? 'Succeeded' : humanizeStatus(status)}
            {duration ? ` · ${duration}` : ''}
          </small>
        ) : null}
      </span>
    </>
  );
}

function formatDuration(startedAt: string, endedAt: string): string | null {
  const milliseconds = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  return milliseconds < 1_000
    ? `${milliseconds} ms`
    : `${(milliseconds / 1_000).toFixed(1)} s`;
}

function humanizeStatus(status: string): string {
  return status[0]!.toUpperCase() + status.slice(1);
}

function PlatformToolDetail({
  name,
  status,
}: {
  readonly name: string;
  readonly status: string;
}) {
  return (
    <>
      <p>
        Platform tool · {name} · {status}
      </p>
      <p>
        Arguments and result are not captured in this transcript.
        <br />
        Only dispatch and completion were recorded.
      </p>
    </>
  );
}

function ActivityIcon({ icon }: { readonly icon: string }) {
  const symbols: Record<string, string> = {
    brain: '✦',
    terminal: '⌘',
    eye: '◉',
    pencil: '✎',
    search: '⌕',
    bot: '♙',
    lock: '⌑',
    error: '!',
    wrench: '·',
    platform: '◆',
  };
  return (
    <span
      className={`transcript__icon transcript__icon--${icon}`}
      aria-hidden="true"
    >
      {symbols[icon] ?? '·'}
    </span>
  );
}
