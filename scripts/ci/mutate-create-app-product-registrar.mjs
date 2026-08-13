#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const [source, output, registrar] = process.argv.slice(2);
if (!source || !output || !['command', 'projection'].includes(registrar)) {
  console.error(
    'usage: mutate-create-app-product-registrar.mjs <source> <output> command|projection',
  );
  process.exit(2);
}

const blocks = {
  command: `  if (
    dependencies.workIdentity &&
    dependencies.startWorkRun &&
    dependencies.productProjection
  )
    registerProductWorkCommandRoutes(app, {
      config: dependencies.config,
      workIdentity: dependencies.workIdentity,
      startWorkRun: dependencies.startWorkRun,
      workListProjection: dependencies.productProjection.getWorkListItem,
      ...(dependencies.productProjection
        ? { workExists: dependencies.productProjection.getWork }
        : {}),
    });
`,
  projection: `  if (dependencies.productProjection)
    registerProductWorkRoutes(app, {
      config: dependencies.config,
      productProjection: dependencies.productProjection,
    });
`,
};

const input = readFileSync(source, 'utf8');
const target = blocks[registrar];
const first = input.indexOf(target);
if (first < 0 || input.indexOf(target, first + target.length) >= 0) {
  console.error(`mutation_target_not_unique:${registrar}`);
  process.exit(2);
}
writeFileSync(output, input.replace(target, ''), 'utf8');
console.log(`mutated_registrar=${registrar} output=${output}`);
