#!/usr/bin/env node

import fs from 'node:fs';

const [source, output] = process.argv.slice(2);
if (!source || !output) {
  console.error('usage: mutate-work-import-boundary.mjs <source> <output>');
  process.exit(2);
}

const input = fs.readFileSync(source, 'utf8');
const importLine =
  "import type { WorkIdentityConnectable } from '../infrastructure/postgres/postgres-work-identity-repository.js';\n";
const typeLine =
  '\nexport type WorkBoundaryMutationProbe = WorkIdentityConnectable;\n';
if (
  input.includes('WorkIdentityConnectable') ||
  input.includes('WorkBoundaryMutationProbe')
) {
  console.error('work_boundary_mutation_target_not_clean');
  process.exit(2);
}
fs.writeFileSync(output, `${importLine}${input}${typeLine}`, 'utf8');
console.log(
  'work_boundary_mutation=direct_concrete_identity_import importer=src/platform/http-types.ts',
);
