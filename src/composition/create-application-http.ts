import { createHttpApp, type AppDependencies } from '../entrypoints/api/app.js';

/** Owns HTTP endpoint registration after the application graph is composed. */
export function createApplicationHttp(dependencies: AppDependencies) {
  return createHttpApp(dependencies);
}
