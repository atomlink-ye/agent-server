import { t } from '@/i18n';
import { buildEntryPresentation } from './transcript-presentation';
import type { ProjectedTranscriptEntry } from './transcript-projection';

export function ActivityRow({
  entry,
  nested = false,
  terminalRun = false,
  actorName = null,
}: {
  readonly entry: ProjectedTranscriptEntry;
  readonly nested?: boolean;
  readonly terminalRun?: boolean;
  readonly actorName?: string | null;
}) {
  const presentation = buildEntryPresentation(entry.event, {
    terminalRun,
    actorName,
  });
  const children = entry.children?.length ? (
    <div className="transcript__children">
      {entry.children.map((child) => (
        <ActivityRow
          entry={child}
          key={child.sourceOrdinals.join(':')}
          nested
          terminalRun={terminalRun}
          actorName={actorName}
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
      actorName={actorName}
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
              <small>
                {t('trace.exitCode', { code: presentation.exitCode })}
              </small>
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
  actorName,
}: {
  readonly entry: ProjectedTranscriptEntry;
  readonly expandable: boolean;
  readonly terminalRun: boolean;
  readonly actorName: string | null;
}) {
  const presentation = buildEntryPresentation(entry.event, {
    terminalRun,
    actorName,
  });
  const status = entry.event.kind === 'tool_status' ? entry.event.status : null;
  const timing = formatActivityTiming(entry);
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
          <span className="transcript__row-meta">
            <span
              className={`transcript__status transcript__status--${status}`}
            >
              {humanizeStatus(status)}
            </span>
            {timing ? (
              <time dateTime={entry.endedAt} title={timing.title}>
                {timing.label}
              </time>
            ) : null}
          </span>
        ) : null}
      </span>
    </>
  );
}

function formatActivityTiming(entry: ProjectedTranscriptEntry): {
  readonly label: string;
  readonly title: string;
} | null {
  const started = new Date(entry.startedAt);
  const ended = new Date(entry.endedAt);
  if (Number.isNaN(started.valueOf()) || Number.isNaN(ended.valueOf()))
    return null;
  const capturedAt = ended.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const duration = ended.valueOf() - started.valueOf();
  // A single provider event captures a point in time, not a duration. Do not
  // turn that missing information into a misleading "0 ms" claim.
  if (entry.sourceOrdinals.length < 2 || duration <= 0)
    return {
      label: capturedAt,
      title: t('trace.capturedAt', { time: capturedAt }),
    };
  return {
    label: `${formatDuration(duration)} · ${capturedAt}`,
    title: t('trace.capturedRange', {
      start: started.toLocaleTimeString(),
      end: ended.toLocaleTimeString(),
    }),
  };
}

function formatDuration(milliseconds: number): string {
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
        {t('trace.platformTool', { name })} · {status}
      </p>
      <p>
        {t('trace.argumentsMissing')}
        <br />
        {t('trace.dispatchOnly')}
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
    play: '▶',
    check: '✓',
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
