import { useCallback, useEffect, useState } from 'react';

import { isFeatureUnavailable } from '../../../api/feature-availability';
import { loadRuntimeCapabilities } from '../clients/runtime-capabilities-client';
import { workDefinitionClient } from '../clients/work-definition-client';
import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

export type RunAvailabilityQuery =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly missingCapability: string | null }
  | {
      readonly status: 'unavailable';
      readonly reason: 'current_definition_missing' | 'feature_unavailable';
    }
  | { readonly status: 'error' };

export function useRunAvailability(
  version: ProductWorkDefinitionVersionResponse | null | undefined,
): RunAvailabilityQuery & { readonly retry: () => void } {
  const [refreshToken, setRefreshToken] = useState(0);
  const retry = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);
  const [state, setState] = useState<RunAvailabilityQuery>(() =>
    version === undefined
      ? { status: 'ready', missingCapability: null }
      : version === null
        ? { status: 'unavailable', reason: 'current_definition_missing' }
        : { status: 'loading' },
  );

  useEffect(() => {
    if (version === undefined) {
      setState({ status: 'ready', missingCapability: null });
      return;
    }
    if (version === null) {
      setState({ status: 'unavailable', reason: 'current_definition_missing' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    void Promise.all([
      loadRuntimeCapabilities(),
      workDefinitionClient.plan(version.source_yaml),
    ]).then(
      ([supported, plan]) => {
        if (!active) return;
        const supportedSet = new Set(supported);
        const missingCapability =
          plan.resolved.requiredRuntimeCapabilities.find(
            (capability) => !supportedSet.has(capability),
          ) ?? null;
        setState({ status: 'ready', missingCapability });
      },
      (reason: unknown) => {
        if (!active) return;
        if (isFeatureUnavailable(reason)) {
          setState({ status: 'unavailable', reason: 'feature_unavailable' });
          return;
        }
        // A projection read failure must not change admission semantics. Keep
        // the normal Start Run action available so its existing bounded error
        // classification remains authoritative.
        setState({ status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [refreshToken, retry, version?.id, version?.source_yaml]);

  return { ...state, retry };
}
