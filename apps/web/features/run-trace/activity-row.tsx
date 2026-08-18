import { buildEntryPresentation } from './transcript-presentation';
import type { ProjectedTranscriptEntry, TranscriptEntry } from './transcript-projection';

export function ActivityRow({ entry, nested = false }: { readonly entry: ProjectedTranscriptEntry; readonly nested?: boolean }) {
  const presentation = buildEntryPresentation(entry.event);
  const content = <RowContent event={entry.event} />;
  const children = entry.children?.length ? (
    <div className="transcript__children">
      {entry.children.map((child) => <ActivityRow entry={child} key={child.sourceOrdinals.join(':')} nested />)}
    </div>
  ) : null;
  if (!presentation.expandable && !children)
    return <div className={`transcript__row transcript__row--static ${nested ? 'transcript__row--nested' : ''}`} data-testid="transcript-activity-row">{content}</div>;
  return (
    <details className={`transcript__row ${nested ? 'transcript__row--nested' : ''} ${presentation.tone === 'running' ? 'is-running' : ''}`} data-testid="transcript-activity-row">
      <summary>{content}</summary>
      <div className="transcript__detail">
        {presentation.detailText ? <pre>{presentation.detailText}</pre> : null}
        {presentation.exitCode !== null ? <small>Exit code: {presentation.exitCode}</small> : null}
        {children}
      </div>
    </details>
  );
}

function RowContent({ event }: { readonly event: TranscriptEntry }) {
  const presentation = buildEntryPresentation(event);
  return <>
    <ActivityIcon icon={presentation.tone === 'failed' ? 'error' : presentation.icon} />
    <span className="transcript__row-copy"><strong>{presentation.label}</strong>{presentation.summary ? <small>{presentation.summary}</small> : null}</span>
  </>;
}

function ActivityIcon({ icon }: { readonly icon: string }) {
  const symbols: Record<string, string> = { brain: '✦', terminal: '⌘', eye: '◉', pencil: '✎', search: '⌕', bot: '♙', lock: '⌑', error: '!', wrench: '·' };
  return <span className={`transcript__icon transcript__icon--${icon}`} aria-hidden="true">{symbols[icon] ?? '·'}</span>;
}
