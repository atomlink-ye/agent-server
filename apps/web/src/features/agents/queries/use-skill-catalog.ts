import { useCallback, useEffect, useState } from 'react';

import { isFeatureUnavailable } from '../../../api/feature-availability';
import { loadSkills, type WorkSkillSummary } from '../skills-gateway';

export type SkillCatalogQuery = {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'error';
  readonly skills: readonly WorkSkillSummary[];
  readonly error: string | null;
  readonly refresh: () => void;
};

/**
 * Same four-state load model as `features/work/queries/use-work-list.ts`:
 * `unavailable` means this deployment does not compose the Product Work
 * surface at all (Skill selection is gated by it), so the picker must not
 * offer a Retry there; `error` is a transient read failure and keeps one.
 */
export function useSkillCatalog(): SkillCatalogQuery {
  const [status, setStatus] = useState<SkillCatalogQuery['status']>('loading');
  const [skills, setSkills] = useState<readonly WorkSkillSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setStatus('loading');
    setError(null);
    void loadSkills()
      .then((next) => {
        setSkills(next);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (isFeatureUnavailable(reason)) {
          setStatus('unavailable');
          return;
        }
        setStatus('error');
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, skills, error, refresh };
}
