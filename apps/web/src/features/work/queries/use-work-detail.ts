import { useEffect, useState } from 'react';

import { isFeatureUnavailable } from '../../../api/feature-availability';
import { ProductReadError } from '../clients/errors';
import { loadWorkDetail, type WorkDetailData } from './load-work-detail';

export type WorkDetailQuery = {
  readonly status: 'loading' | 'starting' | 'available' | 'error';
  readonly detail: WorkDetailData | null;
  readonly error: unknown | null;
};

export function useWorkDetail({
  workId,
  selectedRunId,
  preferCurrentDefinition,
  includeTrace,
  includeRun = true,
}: {
  readonly workId: string;
  readonly selectedRunId?: string;
  readonly preferCurrentDefinition: boolean;
  readonly includeTrace: boolean;
  readonly includeRun?: boolean;
}): WorkDetailQuery {
  const [status, setStatus] = useState<WorkDetailQuery['status']>('loading');
  const [detail, setDetail] = useState<WorkDetailData | null>(null);
  const [error, setError] = useState<unknown | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstLoad = true;
    let hasDetail = false;
    setError(null);
    setStatus('loading');

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 2_000);
    };

    const refresh = async () => {
      try {
        const loaded = await loadWorkDetail(
          workId,
          selectedRunId,
          preferCurrentDefinition,
          includeTrace,
          includeRun,
        );
        if (!active) return;
        setDetail(loaded);
        setError(null);
        setStatus('available');
        firstLoad = false;
        hasDetail = true;
        if (loaded.run?.work_run.product_state === 'running') scheduleRefresh();
      } catch (error) {
        if (!active) return;
        const featureUnavailable = isFeatureUnavailable(error);
        const projectionUnavailable =
          !featureUnavailable &&
          error instanceof ProductReadError &&
          error.status === 503;
        const denied =
          error instanceof ProductReadError &&
          (error.status === 401 || error.status === 403);
        if (featureUnavailable || denied) {
          setDetail(null);
          setError(error);
          setStatus('error');
          return;
        }
        if (projectionUnavailable && firstLoad) {
          setStatus('starting');
          scheduleRefresh();
        } else if (projectionUnavailable || hasDetail) {
          scheduleRefresh();
        } else {
          setError(error);
          setStatus('error');
        }
      }
    };

    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // The refresh lifecycle is intentionally scoped to this Work selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workId,
    selectedRunId,
    preferCurrentDefinition,
    includeTrace,
    includeRun,
  ]);

  return { status, detail, error };
}
