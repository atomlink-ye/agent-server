#!/usr/bin/env node
// @ts-nocheck -- the runtime deliberately loads the legacy compiler API dynamically;
// TypeScript 7's package root exposes only its version shim for type resolution.

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR,
  KNOWN_DEFECT_SHAPE_PRESENT,
  LIVE_CONFIRMATION_REQUIRED,
  MISSING,
} from './check-feedback-projection-known-defect-shape-monitor.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const checker = fileURLToPath(
  new URL(
    './check-feedback-projection-known-defect-shape-monitor.ts',
    import.meta.url,
  ),
);
const querySource = resolve(
  repoRoot,
  'src/infrastructure/postgres/postgres-work-projection-facts-query.ts',
);
const mapperSource = resolve(
  repoRoot,
  'src/application/product-projection/work-projection-facts-source.ts',
);

type ArmName =
  | 'baseline'
  | 'non_target_ast_mutation'
  | 'shape1_target_mutation'
  | 'shape2_target_mutation'
  | 'both_target_mutation'
  | 'parser_unavailable';

type ArmResult = {
  readonly arm: ArmName;
  readonly expected_exit_code: 0 | 1 | 2;
  readonly observed_exit_code: number;
  readonly observed_status: string | null;
  readonly stdout: string;
  readonly passed: boolean;
};

function loadTypescript(): typeof import('typescript') {
  const require = createRequire(import.meta.url);
  try {
    const loaded = require('typescript') as typeof import('typescript');
    if (typeof loaded.createSourceFile === 'function') return loaded;
  } catch {
    // Fall through to the installed legacy compiler API.
  }
  return require(
    resolve(
      repoRoot,
      'node_modules/.pnpm/typescript@5.9.2/node_modules/typescript/lib/typescript.js',
    ),
  ) as typeof import('typescript');
}

function parse(
  ts: typeof import('typescript'),
  path: string,
  text: string,
): import('typescript').SourceFile {
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function print(
  ts: typeof import('typescript'),
  source: import('typescript').SourceFile,
  transform: (node: import('typescript').Node) => import('typescript').Node,
): string {
  const result = ts.transform(source, [
    (context) => (root) => {
      const visit = (
        node: import('typescript').Node,
      ): import('typescript').Node =>
        ts.visitEachChild(transform(node), visit, context);
      return ts.visitNode(root, visit) as import('typescript').SourceFile;
    },
  ]);
  try {
    return ts
      .createPrinter()
      .printFile(result.transformed[0] as import('typescript').SourceFile);
  } finally {
    result.dispose();
  }
}

function propertyName(
  ts: typeof import('typescript'),
  node: import('typescript').PropertyName,
): string {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : '';
}

function mutateQuery(ts: typeof import('typescript'), text: string): string {
  const source = parse(ts, querySource, text);
  return print(ts, source, (node) => {
    if (
      ts.isNoSubstitutionTemplateLiteral(node) &&
      node.text.includes('feedback_present')
    ) {
      return ts.factory.createNoSubstitutionTemplateLiteral(
        node.text.replace(
          '(a.feedback IS NOT NULL) AS feedback_present',
          'a.feedback AS feedback_text',
        ),
      );
    }
    return node;
  });
}

function mutateMapper(
  ts: typeof import('typescript'),
  text: string,
  target: 'shape2' | 'non-target',
): string {
  const source = parse(ts, mapperSource, text);
  return print(ts, source, (node) => {
    if (!ts.isPropertyAssignment(node)) return node;
    const name = propertyName(ts, node.name);
    if (target === 'non-target' && name === 'result_summary') {
      return ts.factory.updatePropertyAssignment(
        node,
        node.name,
        ts.factory.createStringLiteral('non-target-ast-mutation'),
      );
    }
    if (target === 'shape2' && name === 'feedback_summary') {
      return ts.factory.updatePropertyAssignment(
        node,
        node.name,
        ts.factory.createIdentifier('attempt.feedbackSummary'),
      );
    }
    if (target === 'shape2' && name === 'feedback_capture_status') {
      return ts.factory.updatePropertyAssignment(
        node,
        node.name,
        ts.factory.createConditionalExpression(
          ts.factory.createBinaryExpression(
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier('attempt'),
              'feedbackCapture',
            ),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.factory.createStringLiteral('present'),
          ),
          ts.factory.createToken(ts.SyntaxKind.QuestionToken),
          ts.factory.createStringLiteral('captured'),
          ts.factory.createToken(ts.SyntaxKind.ColonToken),
          ts.factory.createStringLiteral('not_present'),
        ),
      );
    }
    return node;
  });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`invalid_argument:${name}`);
  return value;
}

function runChecker(
  queryFile: string,
  mapperFile: string,
  typescriptModule?: string,
): { readonly exitCode: number; readonly stdout: string } {
  const args = [
    '--import',
    'tsx',
    checker,
    '--query-file',
    queryFile,
    '--mapper-file',
    mapperFile,
  ];
  if (typescriptModule) args.push('--typescript-module', typescriptModule);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    exitCode: result.status ?? 2,
    stdout: result.stdout.trim(),
  };
}

async function main(): Promise<void> {
  const artifactDir = argument('--artifact-dir');
  const temp = await mkdtemp(join(tmpdir(), 'feedback-projection-shape-'));
  const queryText = await readFile(querySource, 'utf8');
  const mapperText = await readFile(mapperSource, 'utf8');
  const tempQuery = join(temp, 'query.ts');
  const tempMapper = join(temp, 'mapper.ts');
  const ts = loadTypescript();
  const cases: readonly {
    readonly arm: ArmName;
    readonly query: string;
    readonly mapper: string;
    readonly expected: 0 | 1 | 2;
    readonly parser?: string;
  }[] = [
    {
      arm: 'baseline',
      query: queryText,
      mapper: mapperText,
      expected: KNOWN_DEFECT_SHAPE_PRESENT,
    },
    {
      arm: 'non_target_ast_mutation',
      query: queryText,
      mapper: mutateMapper(ts, mapperText, 'non-target'),
      expected: KNOWN_DEFECT_SHAPE_PRESENT,
    },
    {
      arm: 'shape1_target_mutation',
      query: mutateQuery(ts, queryText),
      mapper: mapperText,
      expected: MISSING,
    },
    {
      arm: 'shape2_target_mutation',
      query: queryText,
      mapper: mutateMapper(ts, mapperText, 'shape2'),
      expected: MISSING,
    },
    {
      arm: 'both_target_mutation',
      query: mutateQuery(ts, queryText),
      mapper: mutateMapper(ts, mapperText, 'shape2'),
      expected: LIVE_CONFIRMATION_REQUIRED,
    },
    {
      arm: 'parser_unavailable',
      query: queryText,
      mapper: mapperText,
      expected: MISSING,
      parser: '/definitely/missing/typescript-parser-module',
    },
  ];
  const results: ArmResult[] = [];
  try {
    for (const test of cases) {
      await writeFile(tempQuery, test.query);
      await writeFile(tempMapper, test.mapper);
      const observed = runChecker(tempQuery, tempMapper, test.parser);
      let observedStatus: string | null = null;
      try {
        const parsed = JSON.parse(observed.stdout) as { status?: unknown };
        observedStatus =
          typeof parsed.status === 'string' ? parsed.status : null;
      } catch {
        observedStatus = null;
      }
      const result: ArmResult = {
        arm: test.arm,
        expected_exit_code: test.expected,
        observed_exit_code: observed.exitCode,
        observed_status: observedStatus,
        stdout: observed.stdout,
        passed: observed.exitCode === test.expected,
      };
      results.push(result);
      if (artifactDir) {
        await mkdir(artifactDir, { recursive: true });
        await writeFile(
          join(artifactDir, `${test.arm}.json`),
          `${JSON.stringify(result, null, 2)}\n`,
        );
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  const passed = results.every((result) => result.passed);
  const summary = {
    machine: FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR,
    status: passed ? 'SELF_TEST_PASS' : 'SELF_TEST_FAIL',
    exit_code: passed ? 0 : 1,
    independent_of: ['E11', 'LIVE'],
    cases: results,
  };
  if (artifactDir)
    await writeFile(
      join(artifactDir, 'summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = summary.exit_code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
