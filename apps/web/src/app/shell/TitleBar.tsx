export interface TitleBarProps {
  readonly section: string;
}

export function TitleBar({ section }: TitleBarProps) {
  return (
    <header className="title-bar" aria-label={`${section} workspace`}>
      <span className="title-bar-crumb">Agent Server</span>
      <span className="title-bar-divider" aria-hidden="true">
        /
      </span>
      <span className="title-bar-section">{section}</span>
    </header>
  );
}

export default TitleBar;
