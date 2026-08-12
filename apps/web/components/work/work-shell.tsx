'use client';

import { useEffect, useState } from 'react';

type ReadState = 'loading' | 'not_implemented' | 'available' | 'error';

export function WorkListShell() {
  const [readState, setReadState] = useState<ReadState>('loading');

  useEffect(() => {
    let active = true;
    void fetch('/api/works', {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then((response) => {
        if (!active) return;
        setReadState(
          response.status === 501
            ? 'not_implemented'
            : response.ok
              ? 'available'
              : 'error',
        );
      })
      .catch(() => {
        if (active) setReadState('error');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="work-shell" data-testid="work-list-shell">
      <p className="work-shell-kicker">Work-first surface · read only</p>
      <h1>Works</h1>
      <p>This is a read-only Work-first surface.</p>
      <p>Controls are explicitly unavailable.</p>
      <p aria-live="polite" data-testid="work-read-state">
        {readStateMessage(readState)}
      </p>
    </main>
  );
}

export function WorkDetailShell({ workId }: { readonly workId: string }) {
  const [readState, setReadState] = useState<ReadState>('loading');

  useEffect(() => {
    let active = true;
    const path = `/api/works/${encodeURIComponent(workId)}`;
    void fetch(path, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then((response) => {
        if (!active) return;
        setReadState(
          response.status === 501
            ? 'not_implemented'
            : response.ok
              ? 'available'
              : 'error',
        );
      })
      .catch(() => {
        if (active) setReadState('error');
      });
    return () => {
      active = false;
    };
  }, [workId]);

  return (
    <main className="work-shell" data-testid="work-detail-shell">
      <p className="work-shell-kicker">Work-first surface · read only</p>
      <h1>Work detail</h1>
      <p>This is a read-only Work-first surface.</p>
      <p>Controls are explicitly unavailable.</p>
      <p aria-live="polite" data-testid="work-read-state">
        {readStateMessage(readState)}
      </p>
    </main>
  );
}

function readStateMessage(state: ReadState): string {
  switch (state) {
    case 'loading':
      return 'Checking read access…';
    case 'not_implemented':
      return 'Read data is not implemented yet.';
    case 'available':
      return 'Read data is available to the next shell stage.';
    case 'error':
      return 'Read data could not be loaded.';
  }
}
