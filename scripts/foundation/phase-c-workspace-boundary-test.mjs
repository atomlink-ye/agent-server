import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  workspaceIsReadOnly,
  workspaceIsWritable,
} from './lib/phase-c-workspace-boundary.mjs';

const erofs = { write_exit: 1, error_code: 'EROFS', file_present: false };
const writable = { write_exit: 0, error_code: null, file_present: true };
assert.equal(workspaceIsReadOnly(erofs), true);
assert.equal(workspaceIsWritable(erofs), false);
assert.equal(workspaceIsReadOnly(writable), false);
assert.equal(workspaceIsWritable(writable), true);
assert.equal(
  workspaceIsReadOnly({
    write_exit: 1,
    error_code: 'EACCES',
    file_present: false,
  }),
  false,
);

const mutation = readFileSync(
  resolve(import.meta.dirname, 'phase-c-e4-workspace-rw-mutation.yaml'),
  'utf8',
);
assert.match(mutation, /^services:\n  paseo-runtime:\n/mu);
assert.doesNotMatch(mutation, /^  agent-server:/mu);
assert.match(mutation, /^    volumes: !override$/mu);
assert.match(mutation, /^      - \.:\/workspace$/mu);
assert.doesNotMatch(mutation, /^      - \.:\/workspace:ro$/mu);
assert.match(
  mutation,
  /^      - provider-toolchain:\/opt\/provider-toolchain-volume:ro$/mu,
);
assert.match(mutation, /^      - paseo-runtime-state:\/runtime-state$/mu);

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', erofs_boundary: true, rw_predicate_rejected: true, mutation_service: 'paseo-runtime' })}\n`,
);
