import type { Hono, MiddlewareHandler } from 'hono';

import type {
  AccessContextRequest,
  ServiceAccountAccessContext,
} from './access-context.js';
import type { ErrorResponse } from '../contracts/http.js';
import type { Logger } from '../shared/observability/logger.js';
import type { ApiEnvironment } from '../entrypoints/api/http-types.js';

export type PlatformHttpInstaller = (
  app: Hono<ApiEnvironment>,
  concerns: PlatformConcerns,
) => void;

export type PlatformRuntimeContributor = (
  registry: PlatformRuntimeRegistry,
) => void;

export interface PlatformRuntimeRegistry {
  register(name: string, invoke: () => Promise<unknown>): void;
}

export interface PlatformConcerns {
  readonly logger: Logger;
  readonly authenticate: MiddlewareHandler<ApiEnvironment>;
  readonly accessContext: (
    context: AccessContextRequest,
  ) => ServiceAccountAccessContext;
  readonly safeError: (
    code: string,
    message: string,
    requestId: string,
  ) => ErrorResponse;
  readonly notFound: (requestId: string) => ErrorResponse;
}

export interface PlatformContribution {
  readonly installHttp?: PlatformHttpInstaller;
  readonly contributeRuntime?: PlatformRuntimeContributor;
}

export function composePlatform(
  contributions: readonly PlatformContribution[],
  concerns: PlatformConcerns,
  starts: readonly (() =>
    | void
    | (() => Promise<void> | void)
    | Promise<void | (() => Promise<void> | void)>)[] = [],
) {
  for (const contribution of contributions)
    assertExactKeys('contribution', contribution, [
      'installHttp',
      'contributeRuntime',
    ]);
  const teardowns: (() => Promise<void> | void)[] = [];
  return {
    installHttp(app: Hono<ApiEnvironment>): void {
      for (const contribution of contributions)
        contribution.installHttp?.(app, concerns);
    },
    contributeRuntime(registry: PlatformRuntimeRegistry): void {
      for (const contribution of contributions)
        contribution.contributeRuntime?.(registry);
    },
    async start(): Promise<void> {
      for (const start of starts) {
        const teardown = await start();
        if (teardown) teardowns.push(teardown);
      }
    },
    async stop(): Promise<void> {
      while (teardowns.length > 0) await teardowns.pop()?.();
    },
  };
}

function assertExactKeys(
  target: string,
  value: object,
  allowed: readonly string[],
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0)
    throw new Error(
      `platform_shell_forbidden_${target}_dependency:${unexpected.join(',')}`,
    );
}
