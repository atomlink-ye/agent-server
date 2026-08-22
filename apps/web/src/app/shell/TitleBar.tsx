export interface TitleBarProps {
  readonly section: string;
}

export function TitleBar({ section }: TitleBarProps) {
  return (
    <header className="title-bar">
      <div className="title-bar-lights" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="title-bar-brand">
        <span className="title-bar-mark" aria-hidden="true">
          ✦
        </span>
        <span>Agent Chat</span>
      </div>
      <span className="title-bar-section">{section}</span>
    </header>
  );
}

export default TitleBar;
