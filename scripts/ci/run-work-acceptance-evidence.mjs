#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const output = path.resolve(readOption('--output'));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('work_acceptance_evidence_missing_database_url', 2);

const candidate = command('git', ['rev-parse', 'HEAD']);
const parent = command('git', ['rev-parse', 'HEAD^']);
const expectedStatus = [' D apps/web/node_modules', ' D node_modules'];
const statusBefore = lines(command('git', ['status', '--short']));
if (JSON.stringify(statusBefore) !== JSON.stringify(expectedStatus))
  fail(`work_acceptance_status_invalid:${JSON.stringify(statusBefore)}`, 2);

const inputs = [
  'package.json',
  'pnpm-lock.yaml',
  'src/bootstrap.ts',
  'src/modules/work/work-module.ts',
  'src/entrypoints/api/routes/product-work-commands.ts',
  'src/entrypoints/mcp/direct-memory-mcp.ts',
  'src/entrypoints/mcp/product-work-mcp-tools.ts',
  'scripts/ci/check-work-import-boundary.mjs',
  'scripts/ci/check-work-bootstrap-boundary.mjs',
  'scripts/ci/classify-work-acceptance.mjs',
  'tests/integration/product-api-v1-oi38.integration.test.ts',
];
const inputHashes = Object.fromEntries(inputs.map((file) => [file, sha(file)]));
const arms = [];

arms.push(
  runArm('baseline-http', 'pnpm', ['modularization:acceptance:work-http'], 0),
);
arms.push(
  runArm('baseline-mcp', 'pnpm', ['modularization:acceptance:work-mcp'], 0),
);
arms.push(
  runArm(
    'baseline-product-subset',
    'pnpm',
    ['check:product-accepted-subset'],
    0,
  ),
);
arms.push(
  runArm(
    'baseline-eight-routes',
    'pnpm',
    ['guard:create-app-product-endpoints'],
    0,
  ),
);

mutate(
  'projection-installer-missing',
  'src/modules/work/work-module.ts',
  `  registerProductWorkRoutes(app, {\n    config,\n    productProjection: projection,\n  });`,
  `  void projection; // evidence mutation: omit projection installer`,
  () => {
    arms.push(
      runClassifiedArm(
        'projection-installer-missing',
        'http-projection',
        'pnpm',
        ['modularization:acceptance:work-http'],
        2,
        [
          'runs the real HTTP create, start, and read path',
          'work_http_projection_installer_missing',
        ],
      ),
    );
    arms.push(
      runFocusedTest(
        'projection-installer-command-control',
        'requires owner positive control',
        0,
      ),
    );
  },
);

mutate(
  'foreign-leak-fail',
  'src/entrypoints/api/routes/product-work-commands.ts',
  `            throw new HttpError(\n              404,\n              'work_not_found',\n              'The requested Work was not found.',\n            );`,
  `            throw new HttpError(\n              403,\n              'work_not_found',\n              'The requested Work was not found.',\n            );`,
  () => {
    arms.push(
      runArm(
        'foreign-leak-fail',
        'pnpm',
        ['modularization:acceptance:work-http'],
        1,
        [
          'requires owner positive control and makes foreign/missing Work indistinguishable',
          'work_http_foreign_scope_leak:status=403',
        ],
      ),
    );
    arms.push(
      runArm(
        'foreign-leak-mcp-control',
        'pnpm',
        ['modularization:acceptance:work-mcp'],
        0,
      ),
    );
  },
);

mutate(
  'work-registration-missing',
  'src/entrypoints/mcp/direct-memory-mcp.ts',
  `      input.contributeWorkRuntime?.({\n        server,\n        grant,\n        grants: input.grants,\n      });`,
  `      void input.contributeWorkRuntime; // evidence mutation: omit Work registration`,
  () => {
    arms.push(
      runClassifiedArm(
        'work-registration-missing',
        'mcp-registration',
        'pnpm',
        ['modularization:acceptance:work-mcp'],
        2,
        [
          'creates through real MCP and reads the same Work through HTTP',
          'work_mcp_registration_missing:product_work_create',
        ],
      ),
    );
    arms.push(
      runArm(
        'work-registration-http-control',
        'pnpm',
        ['modularization:acceptance:work-http'],
        0,
      ),
    );
  },
);

mutate(
  'wrong-work-id-fail',
  'src/entrypoints/mcp/product-work-mcp-tools.ts',
  `text: JSON.stringify({ work: toWorkResponse(work) }),`,
  `text: JSON.stringify({ work: { ...toWorkResponse(work), id: '00000000-0000-4000-8000-00000000dead' } }),`,
  () => {
    arms.push(
      runArm(
        'wrong-work-id-fail',
        'pnpm',
        ['modularization:acceptance:work-mcp'],
        1,
        [
          'creates through real MCP and reads the same Work through HTTP',
          'work_mcp_readback_missing:work_id=',
        ],
      ),
    );
    arms.push(
      runArm(
        'wrong-work-id-http-control',
        'pnpm',
        ['modularization:acceptance:work-http'],
        0,
      ),
    );
  },
);

mutate(
  'bootstrap-direct-work-fail',
  'src/bootstrap.ts',
  `import { createWorkModule } from './modules/work/work-module.js';`,
  `import { createWorkModule } from './modules/work/work-module.js';\nimport { createPostgresWorkIdentityModule as forbiddenWorkIdentityFactory } from './infrastructure/postgres/postgres-work-identity-repository.js';`,
  () => {
    const source = path.join(repo, 'src/bootstrap.ts');
    const text = fs.readFileSync(source, 'utf8');
    const anchor = `  const runtimeMcpServer = new RuntimeMcpServer(`;
    const changed = text.replace(
      anchor,
      `  const forbiddenWorkIdentity = forbiddenWorkIdentityFactory({\n    database: pool,\n    definitions: new InvokableWorkDefinitionReadAdapter(invokableRepository),\n    execution: new InvokeTaskExecutionAdmission(invokeTask),\n  });\n  void forbiddenWorkIdentity;\n${anchor}`,
    );
    if (changed === text) fail('bootstrap_direct_work_call_anchor_missing', 2);
    fs.writeFileSync(source, changed);
    const structuralGuard = path.join(
      repo,
      'scripts/ci/check-work-import-boundary.mjs',
    );
    const structuralGuardOriginal = fs.readFileSync(structuralGuard, 'utf8');
    fs.writeFileSync(
      structuralGuard,
      `#!/usr/bin/env node\nconsole.log('work_import_boundary_bypassed:evidence_ownership_dual');\n`,
    );
    try {
      arms.push(
        runArm(
          'bootstrap-direct-work-independent-guard-bypassed',
          'pnpm',
          ['modularization:verify:work-boundary'],
          0,
          ['work_import_boundary_bypassed:evidence_ownership_dual'],
        ),
      );
      arms.push(
        runArm(
          'bootstrap-direct-work-e5-fail',
          'pnpm',
          ['modularization:acceptance:work-mcp'],
          1,
          [
            'work_bootstrap_boundary_violation:file=src/bootstrap.ts:marker=createPostgresWorkIdentityModule',
          ],
        ),
      );
      arms.push(
        runArm(
          'bootstrap-direct-work-type-control',
          'pnpm',
          ['check:types'],
          0,
        ),
      );
      arms.push(
        runArm(
          'bootstrap-direct-work-http-control',
          'pnpm',
          ['modularization:acceptance:work-http'],
          0,
        ),
      );
    } finally {
      try {
        fs.writeFileSync(structuralGuard, structuralGuardOriginal);
      } finally {
        fs.writeFileSync(source, text);
      }
    }
  },
);

const statusAfter = lines(command('git', ['status', '--short']));
const restoredHashes = Object.fromEntries(
  inputs.map((file) => [file, sha(file)]),
);
const ok =
  arms.every((arm) => arm.ok) &&
  JSON.stringify(statusAfter) === JSON.stringify(expectedStatus) &&
  JSON.stringify(restoredHashes) === JSON.stringify(inputHashes);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  `${JSON.stringify(
    {
      schema: 'mgr-b-work-e4-e5-runtime-v1',
      candidate,
      parent,
      repo,
      expected_status: expectedStatus,
      status_before: statusBefore,
      status_after: statusAfter,
      dependency_paths: {
        node_modules: dependencyState('node_modules'),
        web_node_modules: dependencyState('apps/web/node_modules'),
      },
      input_hashes: inputHashes,
      restored_hashes: restoredHashes,
      arms,
      ok,
    },
    null,
    2,
  )}\n`,
);
process.exit(ok ? 0 : 1);

function runArm(name, executable, argv, expectedExit, markers = []) {
  const result = spawnSync(executable, argv, {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const markerAssertions = Object.fromEntries(
    markers.map((marker) => [marker, `${stdout}\n${stderr}`.includes(marker)]),
  );
  return {
    name,
    argv: [executable, ...argv],
    cwd: repo,
    expected_exit: expectedExit,
    raw_exit: result.status ?? 125,
    stdout,
    stderr,
    marker_assertions: markerAssertions,
    ok:
      result.status === expectedExit &&
      Object.values(markerAssertions).every(Boolean),
  };
}

function runFocusedTest(name, pattern, expectedExit) {
  return runArm(
    name,
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.integration.config.ts',
      '--no-file-parallelism',
      'tests/integration/product-api-v1-oi38.integration.test.ts',
      '-t',
      pattern,
    ],
    expectedExit,
  );
}

function runClassifiedArm(name, kind, executable, argv, expectedExit, markers) {
  return runArm(
    name,
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      kind,
      '--',
      executable,
      ...argv,
    ],
    expectedExit,
    [...markers, `work_acceptance_missing:kind=${kind}`],
  );
}

function mutate(name, file, before, after, action) {
  const target = path.join(repo, file);
  const original = fs.readFileSync(target, 'utf8');
  const changed = original.replace(before, after);
  if (changed === original) fail(`${name}:mutation_anchor_missing`, 2);
  fs.writeFileSync(target, changed);
  try {
    action();
  } finally {
    fs.writeFileSync(target, original);
  }
}
function sha(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(repo, file)))
    .digest('hex');
}
function command(executable, argv) {
  const r = spawnSync(executable, argv, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) fail(`${executable}:${argv.join(':')}:${r.stderr}`, 2);
  return r.stdout.trimEnd();
}
function lines(value) {
  return value ? value.split('\n') : [];
}
function dependencyState(file) {
  const stat = fs.lstatSync(path.join(repo, file));
  return { directory: stat.isDirectory(), symlink: stat.isSymbolicLink() };
}
function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`missing_option:${name}`, 2);
  return process.argv[index + 1];
}
function fail(message, code) {
  console.error(message);
  process.exit(code);
}
