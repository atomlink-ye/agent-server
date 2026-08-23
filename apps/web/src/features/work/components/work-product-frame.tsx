import type { ReactNode } from 'react';

export function WorkProductFrame({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId: string;
}) {
  return (
    <div className="work-product-frame">
      <aside className="work-product-nav" aria-label="Product areas">
        <a className="work-product-brand" href="/">
          <span aria-hidden="true">◆</span>
          <span>Agent Server</span>
        </a>
        <nav aria-label="Primary product navigation">
          <a aria-current="page" className="work-product-nav__current" href="/">
            My Work
          </a>
          <span aria-disabled="true" className="work-product-nav__disabled">
            Artifacts <small>Not available</small>
          </span>
          <span aria-disabled="true" className="work-product-nav__disabled">
            Inbox <small>Not available</small>
          </span>
          <span aria-disabled="true" className="work-product-nav__disabled">
            Resource <small>Not available</small>
          </span>
        </nav>
        <div className="work-product-nav__foot">
          <a href="/chat">Compatibility Chat</a>
          <span>Runtime debugging only</span>
        </div>
      </aside>
      <main className="work-shell" data-testid={testId}>
        {children}
      </main>
    </div>
  );
}
