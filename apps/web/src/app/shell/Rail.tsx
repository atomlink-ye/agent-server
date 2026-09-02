export type DesktopTab =
  | 'conversations'
  | 'agents'
  | 'tasks'
  | 'boards'
  | 'work'
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
          icon="◌"
          onClick={() => onSelectTab('conversations')}
        />
        <RailTab
          active={activeTab === 'agents'}
          label="Agents"
          icon="◎"
          onClick={() => onSelectTab('agents')}
        />
        <RailTab
          active={activeTab === 'tasks'}
          label="Tasks"
          icon="☑"
          onClick={() => onSelectTab('tasks')}
        />
        <RailTab
          active={activeTab === 'boards'}
          label="Boards"
          icon="▦"
          onClick={() => onSelectTab('boards')}
        />
        <RailTab
          active={activeTab === 'work'}
          label="Work"
          icon="✓"
          onClick={() => onSelectTab('work')}
        />
        <RailTab
          active={activeTab === 'files'}
          label="Files"
          icon="▱"
          onClick={() => onSelectTab('files')}
        />
        <RailTab
          active={activeTab === 'whispers'}
          label="Whispers"
          icon="◐"
          onClick={() => onSelectTab('whispers')}
        />
      </nav>
    </aside>
  );
}

function RailTab({
  active,
  label,
  icon,
  onClick,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly icon: string;
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
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default Rail;
