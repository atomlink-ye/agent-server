import { useEffect, useState } from 'react';

import { ProductReadError } from '../clients/errors';
import { loadWorkDetail, type WorkDetailData } from './load-work-detail';

export type WorkDetailQuery = {
  readonly status: 'loading' | 'starting' | 'available' | 'error';
  readonly detail: WorkDetailData | null;
};

export function useWorkDetail({
  workId,
  selectedRunId,
  preferCurrentDefinition,
  includeTrace,
}: {
  readonly workId: string;
  readonly selectedRunId?: string;
  readonly preferCurrentDefinition: boolean;
  readonly includeTrace: boolean;
}): WorkDetailQuery {
  const [status, setStatus] = useState<WorkDetailQuery['status']>('loading');
  const [detail, setDetail] = useState<WorkDetailData | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstLoad = true;
    let hasDetail = false;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 2_000);
    };

    const refresh = async () => {
      if (firstLoad) setStatus('loading');
      try {
        const loaded = await loadWorkDetail(
          workId,
          selectedRunId,
          preferCurrentDefinition,
          includeTrace,
        );
        if (!active) return;
        setDetail(loaded);
        setStatus('available');
        firstLoad = false;
        hasDetail = true;
        if (loaded.run?.work_run.product_state === 'running') scheduleRefresh();
      } catch (error) {
        if (!active) return;
        const projectionUnavailable =
          error instanceof ProductReadError && error.status === 503;
        if (projectionUnavailable && firstLoad) {
          setStatus('starting');
          scheduleRefresh();
        } else if (projectionUnavailable || hasDetail) {
          scheduleRefresh();
        } else {
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
  }, [workId, selectedRunId, preferCurrentDefinition, includeTrace]);

  return { status, detail };
}
