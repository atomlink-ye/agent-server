import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './not-found.css';

export function NotFoundContent({
  title,
  children,
  to,
  linkLabel,
  eyebrow = 'Route unavailable',
  as: Container = 'section',
  onRetry,
  retryLabel = 'Try again',
  mark = '404',
  variant = 'page',
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly to: string;
  readonly linkLabel: string;
  readonly eyebrow?: string;
  readonly as?: 'main' | 'section';
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly mark?: string;
  readonly variant?: 'page' | 'detail';
}) {
  return (
    <Container
      className={`not-found not-found--${variant}`}
      aria-labelledby="not-found-title"
    >
      <div className="not-found__mark" aria-hidden="true">
        {mark}
      </div>
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="not-found-title">{title}</h1>
      <p>{children}</p>
      <Link to={to}>{linkLabel}</Link>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </Container>
  );
}

/** A route miss is a navigational dead end, not an app load failure. */
export function NotFoundPage() {
  const location = useLocation();

  return (
    <NotFoundContent
      as="main"
      title="This workspace view doesn’t exist."
      to="/"
      linkLabel="Go to Conversations"
    >
      <>
        <code>{location.pathname}</code> isn’t a page in this Agent Server
        workspace. Return to Conversations to keep working.
      </>
    </NotFoundContent>
  );
}

export default NotFoundPage;
