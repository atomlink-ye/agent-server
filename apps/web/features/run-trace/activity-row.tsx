import { buildEntryPresentation } from './transcript-presentation';
import type { ProjectedTranscriptEntry, TranscriptEntry } from './transcript-projection';

export function ActivityRow({ entry, nested = false }: { readonly entry: ProjectedTranscriptEntry; readonly nested?: boolean }) {
  const presentation = buildEntryPresentation(entry.event);
  const children = entry.children?.length ? (
    <div className="transcript__children">
      {entry.children.map((child) => <ActivityRow entry={child} key={child.sourceOrdinals.join(':')} nested />)}
    </div>
  ) : null;
  const expandable = presentation.expandable || Boolean(children);
  const rowKind = entry.event.kind === 'reasoning_progress'
    ? 'reasoning'
    : entry.event.kind === 'tool_status'
      ? 'tool'
      : 'other';
  const attributes = {
    'data-source-ordinals': entry.sourceOrdinals.join(','),
    'data-testid': 'transcript-activity-row',
    'data-transcript-row-kind': rowKind,
    'data-transcript-row-mode': expandable ? 'expandable' : 'static',
    ...(presentation.platformToolName ? { 'data-platform-tool': 'true', 'data-tool-name': presentation.platformToolName } : {}),
  } as const;
  const content = <RowContent event={entry.event} expandable={expandable} />;
  const platformStatus = entry.event.kind === 'tool_status' ? entry.event.status : '';
  if (!expandable)
    return <div className={`transcript__row transcript__row--static ${nested ? 'transcript__row--nested' : ''}`} {...attributes}>{content}</div>;
  return (
    <details className={`transcript__row ${presentation.platformToolName ? 'transcript__row--platform' : ''} ${nested ? 'transcript__row--nested' : ''} ${presentation.tone === 'running' ? 'is-running' : ''}`} {...attributes}>
      <summary>{content}</summary>
      <div className="transcript__detail">
        {presentation.platformToolName ? <PlatformToolDetail name={presentation.platformToolName} status={platformStatus} /> : <>
          {presentation.detailText ? <pre>{presentation.detailText}</pre> : null}
          {presentation.exitCode !== null ? <small>Exit code: {presentation.exitCode}</small> : null}
        </>}
        {children}
      </div>
    </details>
  );
}

function RowContent({ event, expandable }: { readonly event: TranscriptEntry; readonly expandable: boolean }) {
  const presentation = buildEntryPresentation(event);
  return <>
    <span className="transcript__icon-slot">
      <ActivityIcon icon={presentation.tone === 'failed' ? 'error' : presentation.icon} />
      {expandable ? <span className="transcript__chevron" aria-hidden="true">⌄</span> : null}
    </span>
    <span className="transcript__row-copy">{presentation.origin ? <em className="transcript__origin">{presentation.origin}</em> : null}<strong>{presentation.label}</strong>{presentation.summary ? <small>{presentation.summary}</small> : null}</span>
  </>;
}

function PlatformToolDetail({ name, status }: { readonly name: string; readonly status: string }) {
  return <><p>Platform tool · {name} · {status}</p><p>Arguments and result are not captured in this transcript.<br />Only dispatch and completion were recorded.</p></>;
}

function ActivityIcon({ icon }: { readonly icon: string }) {
  const symbols: Record<string, string> = { brain: '✦', terminal: '⌘', eye: '◉', pencil: '✎', search: '⌕', bot: '♙', lock: '⌑', error: '!', wrench: '·', platform: '◆' };
  return <span className={`transcript__icon transcript__icon--${icon}`} aria-hidden="true">{symbols[icon] ?? '·'}</span>;
}
