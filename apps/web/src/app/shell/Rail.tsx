import type { ComponentType, SVGProps } from 'react';
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
  return (
    <aside className="rail" aria-label="Primary navigation">
      <div className="rail-brand" aria-label="Agent Chat">
        <span aria-hidden="true">✦</span>
      </div>
      <nav className="rail-tabs" aria-label="Sections">
        <RailTab
          active={activeTab === 'conversations'}
          label="Conversations"
          Icon={IChat}
          onClick={() => onSelectTab('conversations')}
        />
        <RailTab
          active={activeTab === 'agents'}
          label="Agents"
          Icon={IAgent}
          onClick={() => onSelectTab('agents')}
        />
        <RailTab
          active={activeTab === 'tasks'}
          label="Tasks"
          Icon={ITasks}
          onClick={() => onSelectTab('tasks')}
        />
        <RailTab
          active={activeTab === 'boards'}
          label="Boards"
          Icon={IBoard}
          onClick={() => onSelectTab('boards')}
        />
        <RailTab
          active={activeTab === 'work'}
          label="Work"
          Icon={IShip}
          onClick={() => onSelectTab('work')}
        />
        <RailTab
          active={activeTab === 'observe'}
          label="Observe"
          Icon={IObserve}
          onClick={() => onSelectTab('observe')}
        />
        <RailTab
          active={activeTab === 'files'}
          label="Files"
          Icon={IFile}
          onClick={() => onSelectTab('files')}
        />
        <RailTab
          active={activeTab === 'whispers'}
          label="Whispers"
          Icon={IWhisper}
          onClick={() => onSelectTab('whispers')}
        />
      </nav>
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
      <span>{label}</span>
    </button>
  );
}

export default Rail;
