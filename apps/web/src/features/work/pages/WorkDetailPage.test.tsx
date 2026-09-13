import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { useWorkDetail } from '../queries/use-work-detail';
import { WorkDetailPage } from './WorkDetailPage';

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )),
  useNavigate: vi.fn(),
}));
vi.mock('../queries/use-work-detail', () => ({ useWorkDetail: vi.fn() }));
vi.mock('../components/work-header', () => ({ WorkDetailHeader: () => null }));
vi.mock('../components/work-tabs', () => ({ WorkTabs: () => null }));
vi.mock('../components/run-trigger', () => ({ RunTrigger: () => null }));
let startedCallback: ((id: string) => void) | undefined;
vi.mock('../components/panes/work-chat-pane', () => ({
  WorkChatPane: ({
    workRunId,
    onWorkRunStarted,
  }: {
    workRunId?: string;
    onWorkRunStarted?: (id: string) => void;
  }) => {
    startedCallback = onWorkRunStarted;
    return <p data-run={workRunId ?? 'preparation'} />;
  },
}));

it.each([undefined, 'historical-run'])(
  'passes selected Run %s into its conversation',
  (workRunId) => {
    vi.mocked(useWorkDetail).mockReturnValue({
      status: 'ready',
      detail: {
        work: { id: 'work' },
        run: workRunId
          ? { work_run: { id: workRunId, product_state: 'complete' } }
          : null,
        runs: [],
      },
    } as any);
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <WorkDetailPage workId="work" tab="chat" selectedRunId={workRunId} />
      </MemoryRouter>,
  );
    expect(markup).toContain(`data-run="${workRunId ?? 'preparation'}"`);
  },
);

it('opens a chat-started WorkRun in Activity', () => {
  const navigate = vi.fn();
  vi.mocked(useNavigate).mockReturnValue(navigate);
  vi.mocked(useWorkDetail).mockReturnValue({
    status: 'ready',
    detail: {
      work: { id: 'work' },
      run: null,
      runs: [],
    },
  } as any);

  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <WorkDetailPage
        workId="work"
        tab="chat"
        originConversationId="conversation"
      />
    </MemoryRouter>,
  );
  expect(markup).toContain('data-run="preparation"');
  startedCallback?.('new-run');
  expect(navigate).toHaveBeenCalledWith(
    '/work/work?from_conversation=conversation&tab=transcript&run=new-run',
  );
});
