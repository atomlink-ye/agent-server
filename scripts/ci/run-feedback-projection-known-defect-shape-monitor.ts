#!/usr/bin/env node
// @ts-nocheck -- the runtime deliberately loads the legacy compiler API dynamically;
// TypeScript 7's package root exposes only its version shim for type resolution.

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
  | 'parser_unavailable'
  | 'equivalent_query_refactor'
  | 'decoy_ast_mutation'
  | 'dead_code_decoy';

type Mutation = {
  readonly target: string;
  readonly count: number;
  readonly before_source_sha256: string;
  readonly after_source_sha256: string;
  readonly before_target_sha256: string | null;
  readonly after_target_sha256: string | null;
};

type WindowReceipt = {
  readonly mutation_applied: boolean;
  readonly target_started: boolean;
  readonly target_observed_count: number;
  readonly target_skip0: boolean;
  readonly target_completed: boolean;
  readonly control_started: boolean;
  readonly control_observed_count: number;
  readonly control_skip0: boolean;
  readonly control_completed: boolean;
  readonly restore_started: boolean;
  readonly restore_hash_confirmed: boolean;
};

type ArmResult = {
  readonly arm: ArmName;
  readonly expected_exit_code: 0 | 1 | 2;
  readonly observed_exit_code: number;
  readonly observed_status: string | null;
  readonly expected_status: string;
  readonly observed_shape_states: {
    readonly shape1: string | null;
    readonly shape2: string | null;
  };
  readonly expected_shape_states: {
    readonly shape1: string;
    readonly shape2: string;
  };
  readonly observed_schedules_live_confirmation: boolean | null;
  readonly expected_schedules_live_confirmation: boolean;
  readonly mutations: { readonly query: Mutation; readonly mapper: Mutation };
  readonly window: WindowReceipt;
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function mutation(
  target: string,
  before: string,
  after: string,
  beforeTarget: string | null,
  afterTarget: string | null,
  count: number,
): Mutation {
  return {
    target,
    count,
    before_source_sha256: sha256(before),
    after_source_sha256: sha256(after),
    before_target_sha256: beforeTarget === null ? null : sha256(beforeTarget),
    after_target_sha256: afterTarget === null ? null : sha256(afterTarget),
  };
}

function reparsedMutation(
  ts: typeof import('typescript'),
  path: string,
  before: string,
  after: string,
  target: string,
  count: number,
): Mutation {
  const base = mutation(target, before, after, null, null, count);
  const targetNode = (
    source: import('typescript').SourceFile,
  ): import('typescript').Node | undefined => {
    let found: import('typescript').Node | undefined;
    const visit = (node: import('typescript').Node): void => {
      if (found) return;
      if (
        target.includes('shape1.successor.target_class') &&
        ts.isClassDeclaration(node) &&
        node.name?.text === 'PostgresWorkProjectionFactsQuery'
      ) {
        found = node;
      } else if (
        (target.startsWith('shape1.') ||
          target.startsWith('equivalent_query')) &&
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.name.text === 'query' &&
        node.expression.expression.name.text === 'database' &&
        node.expression.expression.expression.kind ===
          ts.SyntaxKind.ThisKeyword &&
        node.typeArguments?.[0] &&
        ts.isTypeReferenceNode(node.typeArguments[0]) &&
        ts.isIdentifier(node.typeArguments[0].typeName) &&
        node.typeArguments[0].typeName.text === 'AttemptRow'
      ) {
        found = node.arguments[0];
      } else if (target.includes('feedback_summary')) {
        if (
          ts.isPropertyAssignment(node) &&
          propertyName(ts, node.name) === 'feedback_summary'
        )
          found = node;
      } else if (target.includes('attempt_projection.object')) {
        if (
          ts.isObjectLiteralExpression(node) &&
          node.properties.some(
            (property) =>
              ts.isPropertyAssignment(property) &&
              propertyName(ts, property.name) === 'feedback_summary',
          ) &&
          node.properties.some(
            (property) =>
              ts.isPropertyAssignment(property) &&
              propertyName(ts, property.name) === 'feedback_capture_status',
          )
        )
          found = node;
      } else if (target.includes('result_summary')) {
        if (
          ts.isPropertyAssignment(node) &&
          propertyName(ts, node.name) === 'result_summary'
        )
          found = node;
      } else if (target.includes('decoy.query.target_class')) {
        if (
          ts.isClassDeclaration(node) &&
          node.name?.text === 'PostgresWorkProjectionFactsQuery'
        )
          found = node;
      } else if (target.includes('dead_code.actual_mapper')) {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name?.text === 'mapWorkProjectionFacts'
        )
          found = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };
  const beforeSource = parse(ts, path, before);
  const afterSource = parse(ts, path, after);
  const beforeNode = targetNode(beforeSource);
  const afterNode = targetNode(afterSource);
  if (!beforeNode || !afterNode)
    throw new Error(`mutation_target_reparse_failed:${target}`);
  return {
    ...base,
    before_target_sha256: sha256(beforeNode.getText(beforeSource)),
    after_target_sha256: sha256(afterNode.getText(afterSource)),
  };
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

function mutateQuery(
  ts: typeof import('typescript'),
  text: string,
): { readonly text: string; readonly mutation: Mutation } {
  const source = parse(ts, querySource, text);
  let count = 0;
  let beforeTarget: string | null = null;
  let afterTarget: string | null = null;
  const transformed = print(ts, source, (node) => {
    if (
      ts.isNoSubstitutionTemplateLiteral(node) &&
      node.text.includes('feedback_present') &&
      count === 0
    ) {
      count += 1;
      beforeTarget = node.getText(source);
      const replacement = node.text.replace(
        '(a.feedback IS NOT NULL) AS feedback_present',
        'NULL AS feedback_present',
      );
      const next = ts.factory.createNoSubstitutionTemplateLiteral(replacement);
      afterTarget = `\`${replacement}\``;
      return next;
    }
    return node;
  });
  return {
    text: transformed,
    mutation: reparsedMutation(
      ts,
      querySource,
      text,
      transformed,
      'shape1.query.feedback_projection.node',
      count,
    ),
  };
}

function mutateQuerySuccessor(
  ts: typeof import('typescript'),
  text: string,
): { readonly text: string; readonly mutation: Mutation } {
  const source = parse(ts, querySource, text);
  let classNode: import('typescript').ClassDeclaration | undefined;
  let interfaceNode: import('typescript').InterfaceDeclaration | undefined;
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === 'PostgresWorkProjectionFactsQuery'
    )
      classNode = node;
    if (ts.isInterfaceDeclaration(node) && node.name?.text === 'AttemptRow')
      interfaceNode = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!classNode || !interfaceNode)
    throw new Error('successor_target_class_missing');
  const beforeClass = classNode.getText(source);
  const afterClass = beforeClass.replace(
    "feedbackCapture: attempt.feedback_present ? 'present' : 'absent'",
    "feedbackCapture: attempt.feedback ? 'present' : 'absent'",
  );
  const beforeInterface = interfaceNode.getText(source);
  const afterInterface = beforeInterface.replace(
    'feedback_present: boolean;',
    'feedback: string | null;',
  );
  const firstNode =
    classNode.getStart(source) < interfaceNode.getStart(source)
      ? classNode
      : interfaceNode;
  const secondNode = firstNode === classNode ? interfaceNode : classNode;
  const firstReplacement =
    firstNode === classNode ? afterClass : afterInterface;
  const secondReplacement =
    secondNode === classNode ? afterClass : afterInterface;
  const classAndInterface =
    text.slice(0, firstNode.getStart(source)) +
    firstReplacement +
    text.slice(firstNode.end, secondNode.getStart(source)) +
    secondReplacement +
    text.slice(secondNode.end);
  const transformed = classAndInterface.replace(
    '(a.feedback IS NOT NULL) AS feedback_present',
    'a.feedback AS feedback_text',
  );
  return {
    text: transformed,
    mutation: reparsedMutation(
      ts,
      querySource,
      text,
      transformed,
      'shape1.successor.target_class',
      1,
    ),
  };
}

function mutateMapper(
  ts: typeof import('typescript'),
  text: string,
  target: 'shape2' | 'non-target',
): { readonly text: string; readonly mutation: Mutation } {
  const source = parse(ts, mapperSource, text);
  let count = 0;
  let beforeTarget: string | null = null;
  let afterTarget: string | null = null;
  const transformed = print(ts, source, (node) => {
    if (!ts.isPropertyAssignment(node)) return node;
    const name = propertyName(ts, node.name);
    if (target === 'non-target' && name === 'result_summary' && count === 0) {
      count += 1;
      beforeTarget = node.getText(source);
      const next = ts.factory.updatePropertyAssignment(
        node,
        node.name,
        ts.factory.createStringLiteral('non-target-ast-mutation'),
      );
      afterTarget = 'result_summary: "non-target-ast-mutation"';
      return next;
    }
    if (target === 'shape2' && name === 'feedback_summary' && count === 0) {
      count += 1;
      beforeTarget = node.getText(source);
      const next = ts.factory.updatePropertyAssignment(
        node,
        node.name,
        ts.factory.createIdentifier('attempt.feedbackSummary'),
      );
      afterTarget = 'feedback_summary: attempt.feedbackSummary';
      return next;
    }
    return node;
  });
  return {
    text: transformed,
    mutation: reparsedMutation(
      ts,
      mapperSource,
      text,
      transformed,
      target === 'shape2'
        ? 'shape2.feedback_summary.node'
        : 'non_target.result_summary.node',
      count,
    ),
  };
}

function mutateEquivalentQueryRefactor(
  ts: typeof import('typescript'),
  text: string,
): { readonly text: string; readonly mutation: Mutation } {
  const source = parse(ts, querySource, text);
  let argumentNode: import('typescript').Expression | undefined;
  let method: import('typescript').MethodDeclaration | undefined;
  let queryCount = 0;
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.name.text === 'query' &&
      node.expression.expression.name.text === 'database' &&
      node.expression.expression.expression.kind ===
        ts.SyntaxKind.ThisKeyword &&
      node.typeArguments?.[0] &&
      ts.isTypeReferenceNode(node.typeArguments[0]) &&
      ts.isIdentifier(node.typeArguments[0].typeName) &&
      node.typeArguments[0].typeName.text === 'AttemptRow' &&
      node.arguments.length > 0 &&
      (ts.isNoSubstitutionTemplateLiteral(node.arguments[0]) ||
        ts.isStringLiteral(node.arguments[0]))
    ) {
      queryCount += 1;
      argumentNode = node.arguments[0];
      let parent: import('typescript').Node | undefined = node;
      while (parent && !ts.isMethodDeclaration(parent)) parent = parent.parent;
      method = parent;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (queryCount !== 1 || !argumentNode || !method?.body)
    throw new Error('equivalent_refactor_target_missing');
  const oldTarget = argumentNode.getText(source);
  const identifier = 'attemptsQuerySql';
  const start = argumentNode.getStart(source);
  const end = argumentNode.end;
  const bodyStart = method.body.getStart(source) + 1;
  const replacement =
    text.slice(0, bodyStart) +
    `\n    const ${identifier} = ${oldTarget};` +
    text.slice(bodyStart, start) +
    identifier +
    text.slice(end);
  return {
    text: replacement,
    mutation: reparsedMutation(
      ts,
      querySource,
      text,
      replacement,
      'shape1.query.local_const_refactor.node',
      1,
    ),
  };
}

function mutateMapperSuccessor(
  ts: typeof import('typescript'),
  text: string,
): { readonly text: string; readonly mutation: Mutation } {
  const source = parse(ts, mapperSource, text);
  let count = 0;
  let beforeTarget: string | null = null;
  let afterTarget: string | null = null;
  const transformed = print(ts, source, (node) => {
    if (!ts.isObjectLiteralExpression(node) || count > 0) return node;
    const hasSummary = node.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        propertyName(ts, property.name) === 'feedback_summary',
    );
    if (!hasSummary) return node;
    count += 1;
    beforeTarget = node.getText(source);
    const properties = node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) return property;
      const name = propertyName(ts, property.name);
      if (name === 'feedback_summary')
        return ts.factory.updatePropertyAssignment(
          property,
          property.name,
          ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier('attempt'),
            'feedback',
          ),
        );
      if (name === 'feedback_capture_status')
        return ts.factory.updatePropertyAssignment(
          property,
          property.name,
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
            ts.factory.createStringLiteral('present'),
            ts.factory.createToken(ts.SyntaxKind.ColonToken),
            ts.factory.createStringLiteral('not_present'),
          ),
        );
      return property;
    });
    const next = ts.factory.updateObjectLiteralExpression(node, properties);
    afterTarget =
      '{ feedback_summary: attempt.feedback, feedback_capture_status: present }';
    return next;
  });
  return {
    text: transformed,
    mutation: reparsedMutation(
      ts,
      mapperSource,
      text,
      transformed,
      'shape2.successor.attempt_projection.object',
      count,
    ),
  };
}

function appendDecoy(
  ts: typeof import('typescript'),
  text: string,
  dead: boolean,
): { readonly text: string; readonly mutation: Mutation } {
  const source = parse(ts, mapperSource, text);
  const decoy = ts.factory.createVariableStatement(
    undefined,
    ts.factory.createVariableDeclarationList(
      [
        ts.factory.createVariableDeclaration(
          'deadFeedbackProjectionDecoy',
          undefined,
          undefined,
          ts.factory.createObjectLiteralExpression(
            [
              ts.factory.createPropertyAssignment(
                'feedback_summary',
                ts.factory.createNull(),
              ),
              ts.factory.createPropertyAssignment(
                'feedback_capture_status',
                ts.factory.createStringLiteral('redacted'),
              ),
            ],
            true,
          ),
        ),
      ],
      true,
    ),
  );
  const statement = dead
    ? ts.factory.createIfStatement(
        ts.factory.createFalse(),
        ts.factory.createBlock([decoy], true),
      )
    : decoy;
  const updated = ts.factory.updateSourceFile(source, [
    ...source.statements,
    statement,
  ]);
  const transformed = ts.createPrinter().printFile(updated);
  return {
    text: transformed,
    mutation: reparsedMutation(
      ts,
      mapperSource,
      text,
      transformed,
      dead ? 'dead_code_decoy.statement' : 'decoy.statement',
      1,
    ),
  };
}

function appendQueryDecoyClass(
  ts: typeof import('typescript'),
  text: string,
): { readonly text: string; readonly mutation: Mutation } {
  const source = parse(ts, querySource, text);
  const decoy = ts.factory.createClassDeclaration(
    undefined,
    'PostgresWorkProjectionFactsQuery',
    undefined,
    undefined,
    [
      ts.factory.createMethodDeclaration(
        undefined,
        undefined,
        'getByRootTask',
        undefined,
        undefined,
        [],
        undefined,
        ts.factory.createBlock([], true),
      ),
    ],
  );
  const updated = ts.factory.updateSourceFile(source, [
    ...source.statements,
    decoy,
  ]);
  const transformed = ts.createPrinter().printFile(updated);
  return {
    text: transformed,
    mutation: reparsedMutation(
      ts,
      querySource,
      text,
      transformed,
      'decoy.query.target_class.statement',
      1,
    ),
  };
}

function appendMapperDeadCode(
  ts: typeof import('typescript'),
  text: string,
): { readonly text: string; readonly mutation: Mutation } {
  const source = parse(ts, mapperSource, text);
  let fn: import('typescript').FunctionDeclaration | undefined;
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'mapWorkProjectionFacts'
    )
      fn = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!fn?.body) throw new Error('dead_code_target_function_missing');
  const dead = `if (false) { const deadAttempts = []; deadAttempts.map((attempt) => ({ feedback_summary: null, feedback_capture_status: 'redacted' })); }`;
  const bodyStart = fn.body.getStart(source) + 1;
  const transformed =
    text.slice(0, bodyStart) + `\n  ${dead}\n` + text.slice(bodyStart);
  return {
    text: transformed,
    mutation: reparsedMutation(
      ts,
      mapperSource,
      text,
      transformed,
      'dead_code.actual_mapper.statement',
      1,
    ),
  };
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

function runNonTargetControl(
  ts: typeof import('typescript'),
  mapperFile: string,
): { readonly observedCount: number; readonly completed: boolean } {
  try {
    const source = parse(ts, mapperSource, readFileSync(mapperFile, 'utf8'));
    let observedCount = 0;
    const visit = (node: import('typescript').Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        propertyName(ts, node.name) === 'result_summary'
      )
        observedCount += 1;
      ts.forEachChild(node, visit);
    };
    visit(source);
    return { observedCount, completed: true };
  } catch {
    return { observedCount: 0, completed: false };
  }
}

async function main(): Promise<void> {
  const artifactDir = argument('--artifact-dir');
  const temp = await mkdtemp(join(tmpdir(), 'feedback-projection-shape-'));
  const queryText = await readFile(querySource, 'utf8');
  const mapperText = await readFile(mapperSource, 'utf8');
  const tempQuery = join(temp, 'query.ts');
  const tempMapper = join(temp, 'mapper.ts');
  const ts = loadTypescript();
  const noQueryMutation = mutation('none', queryText, queryText, null, null, 0);
  const noMapperMutation = mutation(
    'none',
    mapperText,
    mapperText,
    null,
    null,
    0,
  );
  const shape1 = mutateQuery(ts, queryText);
  const shape1Successor = mutateQuerySuccessor(ts, queryText);
  const shape2 = mutateMapper(ts, mapperText, 'shape2');
  const shape2Successor = mutateMapperSuccessor(ts, mapperText);
  const nonTarget = mutateMapper(ts, mapperText, 'non-target');
  const equivalent = mutateEquivalentQueryRefactor(ts, queryText);
  const decoyClass = appendQueryDecoyClass(ts, queryText);
  const deadDecoy = appendMapperDeadCode(ts, mapperText);
  const cases: readonly {
    readonly arm: ArmName;
    readonly query: string;
    readonly mapper: string;
    readonly expected: 0 | 1 | 2;
    readonly expectedStatus: string;
    readonly expectedShapeStates: {
      readonly shape1: string;
      readonly shape2: string;
    };
    readonly expectedSchedules: boolean;
    readonly queryMutation: Mutation;
    readonly mapperMutation: Mutation;
    readonly parser?: string;
  }[] = [
    {
      arm: 'baseline',
      query: queryText,
      mapper: mapperText,
      expected: KNOWN_DEFECT_SHAPE_PRESENT,
      expectedStatus: 'KNOWN_DEFECT_SHAPE_PRESENT',
      expectedShapeStates: { shape1: 'PRESENT', shape2: 'PRESENT' },
      expectedSchedules: false,
      queryMutation: noQueryMutation,
      mapperMutation: noMapperMutation,
    },
    {
      arm: 'non_target_ast_mutation',
      query: queryText,
      mapper: nonTarget.text,
      expected: KNOWN_DEFECT_SHAPE_PRESENT,
      expectedStatus: 'KNOWN_DEFECT_SHAPE_PRESENT',
      expectedShapeStates: { shape1: 'PRESENT', shape2: 'PRESENT' },
      expectedSchedules: false,
      queryMutation: noQueryMutation,
      mapperMutation: nonTarget.mutation,
    },
    {
      arm: 'shape1_target_mutation',
      query: shape1.text,
      mapper: mapperText,
      expected: MISSING,
      expectedStatus: 'MISSING',
      expectedShapeStates: { shape1: 'UNKNOWN', shape2: 'PRESENT' },
      expectedSchedules: false,
      queryMutation: shape1.mutation,
      mapperMutation: noMapperMutation,
    },
    {
      arm: 'shape2_target_mutation',
      query: queryText,
      mapper: shape2.text,
      expected: MISSING,
      expectedStatus: 'MISSING',
      expectedShapeStates: { shape1: 'PRESENT', shape2: 'UNKNOWN' },
      expectedSchedules: false,
      queryMutation: noQueryMutation,
      mapperMutation: shape2.mutation,
    },
    {
      arm: 'both_target_mutation',
      query: shape1Successor.text,
      mapper: shape2Successor.text,
      expected: LIVE_CONFIRMATION_REQUIRED,
      expectedStatus: 'LIVE_CONFIRMATION_REQUIRED',
      expectedShapeStates: { shape1: 'ABSENT', shape2: 'ABSENT' },
      expectedSchedules: true,
      queryMutation: shape1Successor.mutation,
      mapperMutation: shape2Successor.mutation,
    },
    {
      arm: 'parser_unavailable',
      query: queryText,
      mapper: mapperText,
      expected: MISSING,
      expectedStatus: 'MISSING',
      expectedShapeStates: { shape1: 'UNAVAILABLE', shape2: 'UNAVAILABLE' },
      expectedSchedules: false,
      queryMutation: noQueryMutation,
      mapperMutation: noMapperMutation,
      parser: '/definitely/missing/typescript-parser-module',
    },
    {
      arm: 'equivalent_query_refactor',
      query: equivalent.text,
      mapper: mapperText,
      expected: KNOWN_DEFECT_SHAPE_PRESENT,
      expectedStatus: 'KNOWN_DEFECT_SHAPE_PRESENT',
      expectedShapeStates: { shape1: 'PRESENT', shape2: 'PRESENT' },
      expectedSchedules: false,
      queryMutation: equivalent.mutation,
      mapperMutation: noMapperMutation,
    },
    {
      arm: 'decoy_ast_mutation',
      query: decoyClass.text,
      mapper: mapperText,
      expected: MISSING,
      expectedStatus: 'MISSING',
      expectedShapeStates: { shape1: 'UNKNOWN', shape2: 'PRESENT' },
      expectedSchedules: false,
      queryMutation: decoyClass.mutation,
      mapperMutation: noMapperMutation,
    },
    {
      arm: 'dead_code_decoy',
      query: queryText,
      mapper: deadDecoy.text,
      expected: KNOWN_DEFECT_SHAPE_PRESENT,
      expectedStatus: 'KNOWN_DEFECT_SHAPE_PRESENT',
      expectedShapeStates: { shape1: 'PRESENT', shape2: 'PRESENT' },
      expectedSchedules: false,
      queryMutation: noQueryMutation,
      mapperMutation: deadDecoy.mutation,
    },
  ];
  const results: ArmResult[] = [];
  try {
    for (const test of cases) {
      await writeFile(tempQuery, queryText);
      await writeFile(tempMapper, mapperText);
      const mutationApplied =
        test.query !== queryText || test.mapper !== mapperText;
      await writeFile(tempQuery, test.query);
      await writeFile(tempMapper, test.mapper);
      const observed = runChecker(tempQuery, tempMapper, test.parser);
      const targetObservedCount = (() => {
        try {
          JSON.parse(observed.stdout);
          return 1;
        } catch {
          return 0;
        }
      })();
      const control = runNonTargetControl(ts, tempMapper);
      const restoreStarted = true;
      await writeFile(tempQuery, queryText);
      await writeFile(tempMapper, mapperText);
      const restoreHashConfirmed =
        sha256(await readFile(tempQuery, 'utf8')) === sha256(queryText) &&
        sha256(await readFile(tempMapper, 'utf8')) === sha256(mapperText);
      let observedStatus: string | null = null;
      let observedShapeStates = {
        shape1: null as string | null,
        shape2: null as string | null,
      };
      let observedSchedules: boolean | null = null;
      try {
        const parsed = JSON.parse(observed.stdout) as {
          status?: unknown;
          shape1?: { state?: unknown };
          shape2?: { state?: unknown };
          schedules_live_confirmation?: unknown;
        };
        observedStatus =
          typeof parsed.status === 'string' ? parsed.status : null;
        observedShapeStates = {
          shape1:
            typeof parsed.shape1?.state === 'string'
              ? parsed.shape1.state
              : null,
          shape2:
            typeof parsed.shape2?.state === 'string'
              ? parsed.shape2.state
              : null,
        };
        observedSchedules =
          typeof parsed.schedules_live_confirmation === 'boolean'
            ? parsed.schedules_live_confirmation
            : null;
      } catch {
        observedStatus = null;
      }
      const validMutation = (entry: Mutation): boolean =>
        entry.target === 'none'
          ? entry.count === 0 &&
            entry.before_target_sha256 === null &&
            entry.after_target_sha256 === null &&
            entry.before_source_sha256 === entry.after_source_sha256
          : entry.count === 1 &&
            entry.before_target_sha256 !== null &&
            entry.after_target_sha256 !== null &&
            entry.before_target_sha256 !== entry.after_target_sha256 &&
            entry.before_source_sha256 !== entry.after_source_sha256;
      const mutationIdentity =
        validMutation(test.queryMutation) && validMutation(test.mapperMutation);
      const window: WindowReceipt = {
        mutation_applied: mutationApplied,
        target_started: true,
        target_observed_count: targetObservedCount,
        target_skip0: targetObservedCount === 0,
        target_completed: targetObservedCount === 1,
        control_started: true,
        control_observed_count: control.observedCount,
        control_skip0: control.observedCount === 0,
        control_completed: control.completed,
        restore_started: restoreStarted,
        restore_hash_confirmed: restoreHashConfirmed,
      };
      const windowValid =
        window.mutation_applied ===
          (test.queryMutation.count > 0 || test.mapperMutation.count > 0) &&
        window.target_started &&
        window.target_observed_count > 0 &&
        !window.target_skip0 &&
        window.target_completed &&
        window.control_started &&
        window.control_observed_count > 0 &&
        !window.control_skip0 &&
        window.control_completed &&
        window.restore_started &&
        window.restore_hash_confirmed;
      const result: ArmResult = {
        arm: test.arm,
        expected_exit_code: test.expected,
        observed_exit_code: observed.exitCode,
        observed_status: observedStatus,
        expected_status: test.expectedStatus,
        observed_shape_states: observedShapeStates,
        expected_shape_states: test.expectedShapeStates,
        observed_schedules_live_confirmation: observedSchedules,
        expected_schedules_live_confirmation: test.expectedSchedules,
        mutations: { query: test.queryMutation, mapper: test.mapperMutation },
        window,
        stdout: observed.stdout,
        passed:
          observed.exitCode === test.expected &&
          observedStatus === test.expectedStatus &&
          observedShapeStates.shape1 === test.expectedShapeStates.shape1 &&
          observedShapeStates.shape2 === test.expectedShapeStates.shape2 &&
          observedSchedules === test.expectedSchedules &&
          mutationIdentity &&
          windowValid,
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
