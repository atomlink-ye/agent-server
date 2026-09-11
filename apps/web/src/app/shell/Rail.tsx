import type { ComponentType, SVGProps } from 'react';

import { useT } from '../../i18n';
import LanguageSwitcher from './LanguageSwitcher';
import {
  IAgent,
  IBoard,
  IChat,
  IFile,
  IObserve,
  IShip,
  ITasks,
  IWhisper,
} from '../../components/icons';

export type DesktopTab =
  | 'conversations'
  | 'agents'
  | 'tasks'
  | 'boards'
  | 'work'
  | 'observe'
  | 'files'
  | 'whispers';

export interface RailProps {
  readonly activeTab: DesktopTab;
  readonly onSelectTab: (tab: DesktopTab) => void;
}

export function Rail({ activeTab, onSelectTab }: RailProps) {
  const t = useT();
  return (
    <aside className="rail" aria-label={t('shell.nav.primary')}>
      <div className="rail-brand" aria-label={t('shell.brand')}>
        <span aria-hidden="true">✦</span>
      </div>
      <nav className="rail-tabs" aria-label={t('shell.nav.sections')}>
        <RailTab
          active={activeTab === 'conversations'}
          label={t('shell.nav.conversations')}
          Icon={IChat}
          onClick={() => onSelectTab('conversations')}
        />
        <RailTab
          active={activeTab === 'agents'}
          label={t('shell.nav.agents')}
          Icon={IAgent}
          onClick={() => onSelectTab('agents')}
        />
        <RailTab
          active={activeTab === 'tasks'}
          label={t('shell.nav.tasks')}
          Icon={ITasks}
          onClick={() => onSelectTab('tasks')}
        />
        <RailTab
          active={activeTab === 'boards'}
          label={t('shell.nav.boards')}
          Icon={IBoard}
          onClick={() => onSelectTab('boards')}
        />
        <RailTab
          active={activeTab === 'work'}
          label={t('shell.nav.work')}
          Icon={IShip}
          onClick={() => onSelectTab('work')}
        />
        <RailTab
          active={activeTab === 'observe'}
          label={t('shell.nav.observe')}
          Icon={IObserve}
          onClick={() => onSelectTab('observe')}
        />
        <RailTab
          active={activeTab === 'files'}
          label={t('shell.nav.files')}
          Icon={IFile}
          onClick={() => onSelectTab('files')}
        />
        <RailTab
          active={activeTab === 'whispers'}
          label={t('shell.nav.whispers')}
          Icon={IWhisper}
          onClick={() => onSelectTab('whispers')}
        />
      </nav>
      <LanguageSwitcher />
    </aside>
  );
}

function RailTab({
  active,
  label,
  Icon,
  onClick,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly onClick: () => void;
}) {
  return (
    <button
      className="rail-tab"
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
    >
      <span className="rail-tab-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="rail-tab-label">{label}</span>
    </button>
  );
}

export default Rail;
