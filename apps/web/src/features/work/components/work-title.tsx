import './work-card.css';

/** Preserve the distinguishing suffix as well as the beginning of long names. */
export function WorkTitle({ title }: { readonly title: string }) {
  const split = title.length > 70;
  return (
    <strong className="work-scannable-title" title={title} aria-label={title}>
      <span>{split ? title.slice(0, -8) : title}</span>
      {split ? <span className="work-scannable-title__suffix" aria-hidden="true">{title.slice(-8)}</span> : null}
    </strong>
  );
}
