import { WorkRunListResponseSchema } from '@atomlink-ye/agent-server/product-contract';
import { workRunClient } from '../clients/work-run-client';
import { parseProduct, readProductJson } from '../clients/errors';

/** Read the complete index so counts and chronological ordinals are honest. */
export async function loadWorkRuns(workId: string) {
  let page = await workRunClient.list(workId);
  const runs = new Map(page.work_runs.map((run) => [run.id, run]));
  const cursors = new Set<string>();
  while (page.next_cursor) {
    const cursor = page.next_cursor;
    if (cursors.has(cursor))
      throw new Error('The Run index could not be loaded.');
    cursors.add(cursor);
    page = parseProduct(
      WorkRunListResponseSchema,
      await readProductJson(
        `/api/works/${encodeURIComponent(workId)}/runs?cursor=${encodeURIComponent(cursor)}`,
        { method: 'GET', cache: 'no-store' },
      ),
    );
    for (const run of page.work_runs) {
      if (run.work_id !== workId)
        throw new Error('The Run index could not be loaded.');
      runs.set(run.id, run);
    }
  }
  return [...runs.values()].sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}
