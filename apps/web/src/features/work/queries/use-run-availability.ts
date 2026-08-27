import { useEffect, useState } from 'react';

import { isFeatureUnavailable } from '../../../api/feature-availability';
import { loadRuntimeCapabilities } from '../clients/runtime-capabilities-client';
import { workDefinitionClient } from '../clients/work-definition-client';
import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

export type RunAvailabilityQuery =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly missingCapability: string | null }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error' };

export function useRunAvailability(
  version: ProductWorkDefinitionVersionResponse | null,
): RunAvailabilityQuery {
  const [state, setState] = useState<RunAvailabilityQuery>(() =>
    version
      ? { status: 'loading' }
      : { status: 'ready', missingCapability: null },
  );

  useEffect(() => {
    if (!version) {
      setState({ status: 'ready', missingCapability: null });
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
          setState({ status: 'unavailable' });
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
  }, [version?.id, version?.source_yaml]);

  return state;
}
