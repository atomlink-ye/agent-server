import { createHttpApp, type AppDependencies } from '../entrypoints/api/app.js';

/** The composition graph's only HTTP entrypoint. */
export function createHttpApi(dependencies: AppDependencies) {
  return createHttpApp(dependencies);
}
