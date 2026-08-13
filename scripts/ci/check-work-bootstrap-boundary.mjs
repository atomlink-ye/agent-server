#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repo = process.cwd();
const bootstrapPath = path.join(repo, 'src/bootstrap.ts');
const source = fs.readFileSync(bootstrapPath, 'utf8');
const forbidden = [
  'createPostgresWorkIdentityModule',
  'PostgresWorkIdentityRepository',
  'PostgresWorkProjectionFactsQuery',
  'registerProductWorkCommandRoutes',
  'registerProductWorkRoutes',
  'registerProductWorkMcpTools',
  'workIdentity:',
  'startWorkRun:',
];
const violations = forbidden.filter((marker) => source.includes(marker));
if (violations.length) {
  for (const marker of violations)
    console.error(
      `work_bootstrap_boundary_violation:file=src/bootstrap.ts:marker=${marker}`,
    );
  process.exit(1);
}
console.log(
  JSON.stringify({
    guard: 'work-bootstrap-boundary',
    file: 'src/bootstrap.ts',
    allowed_surface: ['createWorkModule', 'workModule'],
    forbidden_markers: forbidden,
    violations: 0,
  }),
);
