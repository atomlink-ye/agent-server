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
const expectedStatus = [];
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
  'scripts/ci/work-acceptance-outcome.mjs',
  'scripts/ci/check-work-acceptance-outcome-matrix.mjs',
  'scripts/ci/run-work-http-acceptance-raw.mjs',
  'scripts/ci/run-work-mcp-acceptance-raw.mjs',
  'scripts/ci/work-acceptance-raw-support.mjs',
  'tests/integration/product-api-v1-oi38.integration.test.ts',
];
const inputHashes = Object.fromEntries(inputs.map((file) => [file, sha(file)]));
const arms = [];

arms.push(
  runArm(
    'classifier-outcome-matrix',
    'node',
    ['scripts/ci/check-work-acceptance-outcome-matrix.mjs'],
    0,
    [
      '"theoretical_points":64',
      '"mutually_exclusive_and_exhaustive":true',
      'STRUCTURALLY_UNREACHABLE',
      '"ok":true',
    ],
  ),
);
arms.push(
  runArmWithoutDatabase(
    'canonical-http-database-missing',
    ['modularization:acceptance:work-http'],
    2,
    [
      'WORK_ACCEPTANCE_MISSING[work_http_database_unavailable]',
      'work_acceptance_missing:kind=http-projection:marker=work_http_database_unavailable',
    ],
  ),
);
mutate(
  'canonical-http-zero-execution',
  'scripts/ci/run-work-http-acceptance-raw.mjs',
  `'requires owner positive control|fails closed|runs the real HTTP'`,
  `'mgr-b-deliberately-no-matching-http-test'`,
  () => {
    arms.push(
      runArm(
        'canonical-http-zero-execution',
        'pnpm',
        ['modularization:acceptance:work-http'],
        2,
        [
          '"executed":0',
          'WORK_ACCEPTANCE_MISSING[work_http_zero_execution]',
          'work_acceptance_missing:kind=http-projection:marker=work_http_zero_execution',
        ],
      ),
    );
    arms.push(
      runArm(
        'canonical-http-zero-execution-mcp-control',
        'pnpm',
        ['modularization:acceptance:work-mcp'],
        0,
        ['"kind":"mcp-registration"', '"executed":1'],
      ),
    );
  },
);
arms.push(
  runArmWithoutDatabase(
    'canonical-mcp-database-missing',
    ['modularization:acceptance:work-mcp'],
    2,
    [
      'WORK_ACCEPTANCE_MISSING[work_mcp_database_unavailable]',
      'work_acceptance_missing:kind=mcp-registration:marker=work_mcp_database_unavailable',
    ],
  ),
);
arms.push(
  runArm(
    'classifier-success',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.log('classifier_child_success');process.exit(0)`,
    ],
    0,
    [
      'classifier_child_success',
      'work_acceptance_child_result:status=0:signal=none:error=none',
    ],
  ),
);
arms.push(
  runArm(
    'classifier-registered-marker-raw-three-fail',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.error('WORK_ACCEPTANCE_MISSING[work_http_projection_installer_missing]');process.exit(3)`,
    ],
    1,
    [
      'WORK_ACCEPTANCE_MISSING[work_http_projection_installer_missing]',
      'work_acceptance_child_result:status=3:signal=none:error=none',
    ],
  ),
);
arms.push(
  runArm(
    'classifier-registered-marker-signal-fail',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.error('WORK_ACCEPTANCE_MISSING[work_http_projection_installer_missing]');process.kill(process.pid, 'SIGTERM')`,
    ],
    1,
    [
      'WORK_ACCEPTANCE_MISSING[work_http_projection_installer_missing]',
      'work_acceptance_child_result:status=null:signal=SIGTERM:error=none',
    ],
  ),
);
arms.push(
  runArm(
    'classifier-recognized-missing',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.error('WORK_ACCEPTANCE_MISSING[work_http_projection_installer_missing]');process.exit(1)`,
    ],
    2,
    ['work_acceptance_missing:kind=http-projection'],
  ),
);
arms.push(
  runArm(
    'classifier-near-miss-fail',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.error('not_WORK_ACCEPTANCE_MISSING[work_http_projection_installer_missing]_suffix');process.exit(1)`,
    ],
    1,
    ['not_WORK_ACCEPTANCE_MISSING'],
  ),
);
arms.push(
  runArm(
    'verifier-input-missing',
    'node',
    [
      'scripts/ci/verify-work-acceptance-evidence.mjs',
      '--input',
      '/tmp/mgr-b-work-e45-deliberately-absent.json',
    ],
    2,
    ['work_acceptance_evidence_missing:path='],
  ),
);
arms.push(
  runArm(
    'classifier-unmarked-exit-two-fail',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.error('unmarked');process.exit(2)`,
    ],
    1,
    ['unmarked'],
  ),
);
arms.push(
  runArm(
    'classifier-raw-three-fail',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.error('raw_three');process.exit(3)`,
    ],
    1,
    [
      'raw_three',
      'work_acceptance_child_result:status=3:signal=none:error=none',
    ],
  ),
);
arms.push(
  runArm(
    'classifier-wrong-kind-marker-fail',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.error('WORK_ACCEPTANCE_MISSING[work_mcp_registration_missing:product_work_create]');process.exit(1)`,
    ],
    1,
    [
      'WORK_ACCEPTANCE_MISSING[work_mcp_registration_missing:product_work_create]',
      'work_acceptance_child_result:status=1:signal=none:error=none',
    ],
  ),
);
arms.push(
  runArm(
    'classifier-child-signal-fail',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      `console.error('classifier_child_signal');process.kill(process.pid, 'SIGTERM')`,
    ],
    1,
    [
      'classifier_child_signal',
      'work_acceptance_child_result:status=null:signal=SIGTERM:error=none',
    ],
  ),
);
arms.push(
  runArm(
    'classifier-spawn-unavailable-fail',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      '/tmp/mgr-b-deliberately-absent-work-acceptance-command',
    ],
    1,
    ['work_acceptance_child_result:status=null:signal=none:error=ENOENT'],
  ),
);
arms.push(
  runArm(
    'classifier-missing-kind-option',
    'node',
    ['scripts/ci/classify-work-acceptance.mjs', '--', 'node', '-e', ''],
    2,
    ['work_acceptance_classifier_invalid:missing_option:--kind'],
  ),
);
arms.push(
  runArm(
    'classifier-missing-command',
    'node',
    ['scripts/ci/classify-work-acceptance.mjs', '--kind', 'http-projection'],
    2,
    ['work_acceptance_classifier_invalid:missing_command'],
  ),
);
arms.push(
  runArm(
    'classifier-unknown-kind',
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'deliberately-unknown',
      '--',
      'node',
      '-e',
      '',
    ],
    2,
    [
      'work_acceptance_classifier_invalid:unknown_classification:deliberately-unknown',
    ],
  ),
);

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
      runArm(
        'projection-installer-missing',
        'pnpm',
        ['modularization:acceptance:work-http'],
        2,
        [
          'runs the real HTTP create, start, and read path',
          'WORK_ACCEPTANCE_MISSING[work_http_projection_installer_missing]',
          'work_acceptance_missing:kind=http-projection',
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
      runArm(
        'work-registration-missing',
        'pnpm',
        ['modularization:acceptance:work-mcp'],
        2,
        [
          'creates through real MCP and reads the same Work through HTTP',
          'WORK_ACCEPTANCE_MISSING[work_mcp_registration_missing:product_work_create]',
          'work_acceptance_missing:kind=mcp-registration',
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
            'work_bootstrap_boundary_violation:file=src/bootstrap.ts:identifier=createPostgresWorkIdentityModule',
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

mutate(
  'bootstrap-direct-transfer-fail',
  'src/bootstrap.ts',
  `import { createWorkModule } from './modules/work/work-module.js';`,
  `import { createWorkModule } from './modules/work/work-module.js';\nimport { createPostgresWorkIdentityModule as forbiddenWorkIdentityModule } from './infrastructure/postgres/postgres-work-identity-repository.js';\nimport { registerProductWorkMcpTools as forbiddenWorkMcpRegistration } from './entrypoints/mcp/product-work-mcp-tools.js';`,
  () => {
    const source = path.join(repo, 'src/bootstrap.ts');
    const imported = fs.readFileSync(source, 'utf8');
    const anchor = `  const runtimeMcpServer = new RuntimeMcpServer(`;
    const construction = `  const forbiddenWorkInternals = forbiddenWorkIdentityModule({\n    database: pool,\n    definitions: new InvokableWorkDefinitionReadAdapter(invokableRepository),\n    execution: new InvokeTaskExecutionAdmission(invokeTask),\n  });\n  const forbiddenWorkContributor: typeof workModule.contributeRuntime =\n    (context) => forbiddenWorkMcpRegistration({\n      ...context,\n      workIdentity: forbiddenWorkInternals.workIdentity,\n      startWorkRun: forbiddenWorkInternals.startWorkRun,\n    });\n${anchor}`;
    let changed = imported.replace(anchor, construction);
    changed = changed.replace(
      `    workModule.contributeRuntime,\n  );`,
      `    forbiddenWorkContributor,\n  );`,
    );
    if (changed === imported || !changed.includes('forbiddenWorkContributor,'))
      fail('bootstrap_direct_transfer_anchor_missing', 2);
    fs.writeFileSync(source, changed);
    try {
      withIndependentBoundaryBypassed(() => {
        arms.push(
          runArm(
            'bootstrap-direct-transfer-independent-guard-bypassed',
            'pnpm',
            ['modularization:verify:work-boundary'],
            0,
            ['work_import_boundary_bypassed:evidence_ownership_dual'],
          ),
        );
        arms.push(
          runArm(
            'bootstrap-direct-transfer-e5-fail',
            'pnpm',
            ['modularization:acceptance:work-mcp'],
            1,
            [
              'work_bootstrap_boundary_violation:file=src/bootstrap.ts:identifier=createPostgresWorkIdentityModule',
              'work_bootstrap_boundary_violation:file=src/bootstrap.ts:identifier=workIdentity',
              'work_bootstrap_boundary_violation:file=src/bootstrap.ts:identifier=startWorkRun',
            ],
          ),
        );
        arms.push(
          runArm(
            'bootstrap-direct-transfer-type-control',
            'pnpm',
            ['check:types'],
            0,
          ),
        );
        arms.push(
          runArm(
            'bootstrap-direct-transfer-http-control',
            'pnpm',
            ['modularization:acceptance:work-http'],
            0,
          ),
        );
      });
    } finally {
      fs.writeFileSync(source, imported);
    }
  },
);

mutate(
  'bootstrap-parser-api-missing',
  'scripts/ci/check-work-bootstrap-boundary.mjs',
  `    import('typescript/unstable/sync'),`,
  `    import('typescript/unstable/sync-deliberately-missing'),`,
  () => {
    arms.push(
      runArm(
        'bootstrap-parser-api-missing-e5',
        'pnpm',
        ['modularization:acceptance:work-mcp'],
        2,
        ['work_bootstrap_boundary_missing:'],
      ),
    );
    arms.push(
      runArm(
        'bootstrap-parser-api-missing-type-control',
        'pnpm',
        ['check:types'],
        0,
      ),
    );
    arms.push(
      runArm(
        'bootstrap-parser-api-missing-http-control',
        'pnpm',
        ['modularization:acceptance:work-http'],
        0,
      ),
    );
  },
);

mutate(
  'bootstrap-template-static-text-control',
  'src/bootstrap.ts',
  `  const runtimeMcpServer = new RuntimeMcpServer(`,
  `  const safeTemplate = \`static workIdentity startWorkRun createPostgresWorkIdentityModule createProductProjection\`;\n  void safeTemplate;\n  const runtimeMcpServer = new RuntimeMcpServer(`,
  () => {
    arms.push(
      runArm(
        'bootstrap-template-static-text-e5-control',
        'pnpm',
        ['modularization:acceptance:work-mcp'],
        0,
      ),
    );
    arms.push(
      runArm(
        'bootstrap-template-static-text-type-control',
        'pnpm',
        ['check:types'],
        0,
      ),
    );
    arms.push(
      runArm(
        'bootstrap-template-static-text-http-control',
        'pnpm',
        ['modularization:acceptance:work-http'],
        0,
      ),
    );
  },
);

mutate(
  'bootstrap-template-interpolation-fail',
  'src/bootstrap.ts',
  `  const runtimeMcpServer = new RuntimeMcpServer(`,
  `  const forbiddenTemplate = \`${'${/}/.test("x") ? ({ startWorkRun: workModule.contributeRuntime }).startWorkRun : undefined}'}\`;\n  void forbiddenTemplate;\n  const runtimeMcpServer = new RuntimeMcpServer(`,
  () => {
    withIndependentBoundaryBypassed(() => {
      arms.push(
        runArm(
          'bootstrap-template-independent-guard-bypassed',
          'pnpm',
          ['modularization:verify:work-boundary'],
          0,
          ['work_import_boundary_bypassed:evidence_ownership_dual'],
        ),
      );
      arms.push(
        runArm(
          'bootstrap-template-e5-fail',
          'pnpm',
          ['modularization:acceptance:work-mcp'],
          1,
          [
            'work_bootstrap_boundary_violation:file=src/bootstrap.ts:identifier=startWorkRun',
          ],
        ),
      );
      arms.push(
        runArm('bootstrap-template-type-control', 'pnpm', ['check:types'], 0),
      );
      arms.push(
        runArm(
          'bootstrap-template-http-control',
          'pnpm',
          ['modularization:acceptance:work-http'],
          0,
        ),
      );
    });
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

function runArmWithoutDatabase(name, argv, expectedExit, markers) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.POSTGRES_URL;
  const result = spawnSync('pnpm', argv, { cwd: repo, env, encoding: 'utf8' });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const markerAssertions = Object.fromEntries(
    markers.map((marker) => [marker, `${stdout}\n${stderr}`.includes(marker)]),
  );
  return {
    name,
    argv: ['env', '-u', 'DATABASE_URL', '-u', 'POSTGRES_URL', 'pnpm', ...argv],
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

function withIndependentBoundaryBypassed(action) {
  const guard = path.join(repo, 'scripts/ci/check-work-import-boundary.mjs');
  const original = fs.readFileSync(guard, 'utf8');
  fs.writeFileSync(
    guard,
    `#!/usr/bin/env node\nconsole.log('work_import_boundary_bypassed:evidence_ownership_dual');\n`,
  );
  try {
    action();
  } finally {
    fs.writeFileSync(guard, original);
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
