import { useCallback, useEffect, useState } from 'react';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { workClient } from '../clients/work-client';

export type WorkListQuery = {
  readonly status: 'loading' | 'ready' | 'error';
  readonly works: readonly WorkListItem[];
  readonly error: string | null;
  readonly refresh: () => void;
};

export function useWorkList(): WorkListQuery {
  const [status, setStatus] = useState<WorkListQuery['status']>('loading');
  const [works, setWorks] = useState<readonly WorkListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setStatus('loading');
    setError(null);
    void workClient
      .list()
      .then((response) => {
        setWorks(response.works);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        setStatus('error');
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, works, error, refresh };
}
