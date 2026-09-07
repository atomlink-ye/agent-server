import { Link, useLocation } from 'react-router-dom';

/** A route miss is a navigational dead end, not an app load failure. */
export function NotFoundPage() {
  const location = useLocation();

  return (
    <main className="not-found" aria-labelledby="not-found-title">
      <div className="not-found__mark" aria-hidden="true">
        404
      </div>
      <p className="eyebrow">Route unavailable</p>
      <h1 id="not-found-title">This workspace view doesn’t exist.</h1>
      <p>
        <code>{location.pathname}</code> isn’t a page in this Agent Server
        workspace. Return to Conversations to keep working.
      </p>
      <Link to="/">Go to Conversations</Link>
    </main>
  );
}

export default NotFoundPage;
