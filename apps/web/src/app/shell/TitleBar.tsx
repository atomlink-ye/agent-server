import type { ReactNode } from 'react';

export interface TitleBarProps {
  readonly section: string;
  readonly right?: ReactNode;
}

export function TitleBar({ section, right }: TitleBarProps) {
  return (
    <header className="title-bar" aria-label={`${section} workspace`}>
      <span className="title-bar-crumb">Agent Server</span>
      <span className="title-bar-divider" aria-hidden="true">
        /
      </span>
      <span className="title-bar-section">{section}</span>
      {right ? <span className="title-bar-right">{right}</span> : null}
    </header>
  );
}

export default TitleBar;
