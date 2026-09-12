import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { useWorkDetail } from '../queries/use-work-detail';
import { WorkDetailPage } from './WorkDetailPage';

vi.mock('../queries/use-work-detail', () => ({ useWorkDetail: vi.fn() }));
vi.mock('../components/work-header', () => ({ WorkDetailHeader: () => null }));
vi.mock('../components/work-tabs', () => ({ WorkTabs: () => null }));
vi.mock('../components/run-trigger', () => ({ RunTrigger: () => null }));
vi.mock('../components/panes/work-chat-pane', () => ({
  WorkChatPane: ({ workRunId }: { workRunId?: string }) => (
    <p data-run={workRunId ?? 'preparation'} />
  ),
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
