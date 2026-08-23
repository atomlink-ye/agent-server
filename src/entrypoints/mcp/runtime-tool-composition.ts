import {
  createRuntimeToolCatalog as createCatalog,
  type RuntimeToolContributor,
  type RuntimeToolCatalog,
} from '../../application/extensions/runtime-tool-catalog.js';

export function createRuntimeToolCatalog(input: {
  readonly work: RuntimeToolContributor;
  readonly memory: RuntimeToolContributor;
  readonly collaboration: RuntimeToolContributor;
  readonly synthetic: RuntimeToolContributor;
}): RuntimeToolCatalog {
  return createCatalog([
    { ref: 'work', contribute: input.work },
    { ref: 'memory', contribute: input.memory },
    { ref: 'collaboration', contribute: input.collaboration },
    { ref: 'synthetic', contribute: input.synthetic },
  ]);
}
