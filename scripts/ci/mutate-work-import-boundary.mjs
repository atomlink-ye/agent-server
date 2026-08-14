#!/usr/bin/env node

import fs from 'node:fs';

const [source, output, kind = 'declaration'] = process.argv.slice(2);
if (
  !source ||
  !output ||
  !['declaration', 'import-type', 'template', 'create-require'].includes(kind)
) {
  console.error(
    'usage: mutate-work-import-boundary.mjs <source> <output> declaration|import-type|template|create-require',
  );
  process.exit(2);
}

const input = fs.readFileSync(source, 'utf8');
const additions = {
  declaration: {
    prefix:
      "import type { WorkIdentityConnectable } from '../infrastructure/postgres/postgres-work-identity-repository.js';\n",
    suffix:
      '\nexport type WorkBoundaryMutationProbe = WorkIdentityConnectable;\n',
  },
  'import-type': {
    prefix: '',
    suffix:
      "\nexport type WorkBoundaryMutationProbe = import('../infrastructure/postgres/postgres-work-identity-repository.js').WorkIdentityConnectable;\n",
  },
  template: {
    prefix: '',
    suffix:
      "\nexport const workBoundaryMutationProbe = () => import(`../infrastructure/postgres/postgres-work-projection-facts-query.js`);\n",
  },
  'create-require': {
    prefix: "import { createRequire as makeRequire } from 'node:module';\n",
    suffix:
      "\nconst loadWorkBoundaryMutation = makeRequire(import.meta.url);\nexport const workBoundaryMutationProbe = loadWorkBoundaryMutation('../infrastructure/postgres/postgres-work-identity-repository.js');\n",
  },
};
if (
  input.includes('WorkIdentityConnectable') ||
  input.includes('WorkBoundaryMutationProbe')
) {
  console.error('work_boundary_mutation_target_not_clean');
  process.exit(2);
}
const addition = additions[kind];
fs.writeFileSync(
  output,
  `${addition.prefix}${input}${addition.suffix}`,
  'utf8',
);
console.log(
  `work_boundary_mutation=${kind} importer=src/platform/http-types.ts`,
);
