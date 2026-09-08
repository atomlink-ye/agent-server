import type { ReactNode } from 'react';

import { useT } from '../../i18n';

export interface TitleBarProps {
  readonly section: string;
  readonly right?: ReactNode;
}

export function TitleBar({ section, right }: TitleBarProps) {
  const t = useT();
  return (
    <header
      className="title-bar"
      aria-label={t('shell.titleBar.workspace', { section })}
    >
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
