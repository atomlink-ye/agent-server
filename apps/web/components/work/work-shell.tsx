'use client';

import { useEffect, useState } from 'react';

import type {
  ProductRunTrace,
  ProductWorkRun,
  WorkListResponse,
  WorkResponse,
  WorkRunListResponse,
} from '@atomlink-ye/agent-server/product-contract';

import { RunTrace } from '@/features/run-trace/run-trace';

type LoadState = 'loading' | 'available' | 'error';

export function WorkListShell() {
  const [state, setState] = useState<LoadState>('loading');
  const [works, setWorks] = useState<readonly WorkResponse[]>([]);

  useEffect(() => {
    let active = true;
    void readJson<WorkListResponse>('/api/works')
      .then((response) => {
        if (!active) return;
        setWorks(response.works);
        setState('available');
      })
      .catch(() => {
        if (active) setState('error');
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
      {state === 'loading' ? <p>Loading Works…</p> : null}
      {state === 'error' ? (
        <p role="alert">Work data could not be loaded.</p>
      ) : null}
      {state === 'available' ? (
        <ul data-testid="work-list">
          {works.map((work) => (
            <li key={work.id}>
              <a href={`/works/${encodeURIComponent(work.id)}`}>{work.title}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}

export function WorkDetailShell({ workId }: { readonly workId: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [detail, setDetail] = useState<WorkDetailData | null>(null);

  useEffect(() => {
    let active = true;
    void loadWorkDetail(workId)
      .then((loaded) => {
        if (!active) return;
        setDetail(loaded);
        setState('available');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [workId]);

  return (
    <main className="work-shell" data-testid="work-detail-shell">
      <p className="work-shell-kicker">Work-first surface · read only</p>
      {state === 'loading' ? <p>Loading Work…</p> : null}
      {state === 'error' ? (
        <p role="alert">Work data could not be loaded.</p>
      ) : null}
      {detail ? <WorkDetail data={detail} /> : null}
    </main>
  );
}

function WorkDetail({ data }: { readonly data: WorkDetailData }) {
  const { work, trace } = data;

  return (
    <>
      <h1>{work.title}</h1>
      <p>This is a read-only Work-first surface.</p>
      <p>Controls are explicitly unavailable.</p>
      <RunTrace trace={trace} />
    </>
  );
}

type WorkDetailData = {
  readonly work: WorkResponse;
  readonly run: Extract<
    ProductWorkRun,
    { projection_status: 'internally_anchored' }
  >;
  readonly trace: Extract<
    ProductRunTrace,
    { projection_status: 'internally_anchored' }
  >;
};

async function loadWorkDetail(workId: string): Promise<WorkDetailData> {
  const encodedId = encodeURIComponent(workId);
  const workResponse = await readJson<{ work: WorkResponse }>(
    `/api/works/${encodedId}`,
  );
  const runsResponse = await readJson<WorkRunListResponse>(
    `/api/works/${encodedId}/runs`,
  );
  const finalRun = [...runsResponse.work_runs].sort(compareWorkRuns).at(-1);
  if (!finalRun) throw new Error('No WorkRun is available.');

  const runPath = `/api/works/${encodedId}/runs/${encodeURIComponent(finalRun.id)}`;
  const [run, trace] = await Promise.all([
    readJson<ProductWorkRun>(runPath),
    readJson<ProductRunTrace>(`${runPath}/trace`),
  ]);
  if (!isAnchoredRun(run) || !isAnchoredTrace(trace))
    throw new Error('The WorkRun projection was not captured.');
  return { work: workResponse.work, run, trace };
}

function compareWorkRuns(
  left: WorkRunListResponse['work_runs'][number],
  right: WorkRunListResponse['work_runs'][number],
): number {
  return (
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

function isAnchoredRun(value: ProductWorkRun): value is WorkDetailData['run'] {
  return (
    'projection_status' in value &&
    value.projection_status === 'internally_anchored'
  );
}

function isAnchoredTrace(
  value: ProductRunTrace,
): value is WorkDetailData['trace'] {
  return (
    'projection_status' in value &&
    value.projection_status === 'internally_anchored'
  );
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Product read failed.');
  return (await response.json()) as T;
}
