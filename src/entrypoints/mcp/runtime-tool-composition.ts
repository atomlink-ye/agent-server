import {
  RuntimeToolRegistry,
  type RuntimeToolContributor,
} from '../../platform/runtime-tool-registry.js';

export function createRuntimeToolRegistry(input: {
  readonly work: RuntimeToolContributor;
  readonly memory: RuntimeToolContributor;
  readonly legacy: RuntimeToolContributor;
}): RuntimeToolRegistry {
  return new RuntimeToolRegistry([input.work, input.memory, input.legacy]);
}
