import {
  createResourceModule,
  type CreateResourceModuleOptions,
  type ResourceModule,
} from '../modules/resource/resource-module.js';

export type ResourceCapabilities = ResourceModule;

/** Creates the resource capabilities shared by the application graph. */
export function createResourceCapabilities(
  options: CreateResourceModuleOptions,
): Promise<ResourceCapabilities> {
  return createResourceModule(options);
}
