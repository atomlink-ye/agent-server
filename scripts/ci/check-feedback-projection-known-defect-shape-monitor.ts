#!/usr/bin/env node
// @ts-nocheck -- the runtime deliberately loads the legacy compiler API dynamically;
// TypeScript 7's package root exposes only its version shim for type resolution.

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR =
  'FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR' as const;
export const KNOWN_DEFECT_SHAPE_PRESENT = 1;
export const LIVE_CONFIRMATION_REQUIRED = 0;
export const MISSING = 2;

type TsApi = typeof import('typescript');
type ShapeState = 'PRESENT' | 'ABSENT' | 'AMBIGUOUS' | 'UNAVAILABLE';

export type ShapeResult = {
  readonly state: ShapeState;
  readonly reason: string;
};

export type StaticShapeResult = {
  readonly machine: typeof FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR;
  readonly status:
    'KNOWN_DEFECT_SHAPE_PRESENT' | 'LIVE_CONFIRMATION_REQUIRED' | 'MISSING';
  readonly exit_code: 0 | 1 | 2;
  readonly shape1: ShapeResult;
  readonly shape2: ShapeResult;
  readonly independent_of: readonly ['E11', 'LIVE'];
  readonly schedules_live_confirmation: boolean;
};

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const defaultQueryFile = resolve(
  repoRoot,
  'src/infrastructure/postgres/postgres-work-projection-facts-query.ts',
);
const defaultMapperFile = resolve(
  repoRoot,
  'src/application/product-projection/work-projection-facts-source.ts',
);

class MissingInput extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'MissingInput';
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new MissingInput(`argument_${name}_invalid`);
  return value;
}

function loadTypescript(specifier: string | undefined): TsApi {
  try {
    const require = createRequire(import.meta.url);
    const candidates = specifier
      ? [specifier]
      : [
          'typescript',
          resolve(
            repoRoot,
            'node_modules/.pnpm/typescript@5.9.2/node_modules/typescript/lib/typescript.js',
          ),
        ];
    for (const candidate of candidates) {
      try {
        const loaded = require(candidate) as Partial<TsApi>;
        if (typeof loaded.createSourceFile === 'function')
          return loaded as TsApi;
      } catch {
        // Try the next installed compiler API candidate.
      }
    }
    throw new Error('legacy_typescript_compiler_api_missing');
  } catch {
    throw new MissingInput('typescript_parser_unavailable');
  }
}

async function sourceFile(
  ts: TsApi,
  path: string,
): Promise<import('typescript').SourceFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new MissingInput(`source_file_missing:${path}`);
  }
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (source.parseDiagnostics.length > 0)
    throw new MissingInput(`source_parse_failed:${path}`);
  return source;
}

function identifierText(ts: TsApi, node: import('typescript').Node): string {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : '';
}

function propertyName(
  ts: TsApi,
  node: import('typescript').PropertyName | undefined,
): string {
  return node ? identifierText(ts, node) : '';
}

function isString(
  ts: TsApi,
  node: import('typescript').Expression | undefined,
  value: string,
): boolean {
  return (
    !!node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === value
  );
}

function queryText(
  ts: TsApi,
  node: import('typescript').Expression,
): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function hasAttemptRowType(
  ts: TsApi,
  call: import('typescript').CallExpression,
): boolean {
  const type = call.typeArguments?.[0];
  return (
    !!type &&
    ts.isTypeReferenceNode(type) &&
    identifierText(ts, type.typeName) === 'AttemptRow'
  );
}

function findMethod(
  ts: TsApi,
  source: import('typescript').SourceFile,
  name: string,
): readonly import('typescript').MethodDeclaration[] {
  const matches: import('typescript').MethodDeclaration[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (ts.isMethodDeclaration(node) && propertyName(ts, node.name) === name)
      matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches;
}

function findInterface(
  ts: TsApi,
  source: import('typescript').SourceFile,
  name: string,
): readonly import('typescript').InterfaceDeclaration[] {
  const matches: import('typescript').InterfaceDeclaration[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isInterfaceDeclaration(node) &&
      identifierText(ts, node.name) === name
    )
      matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches;
}

function interfaceBooleanProperty(
  ts: TsApi,
  declaration: import('typescript').InterfaceDeclaration,
  name: string,
): boolean {
  const property = declaration.members.find(
    (member): member is import('typescript').PropertySignature =>
      ts.isPropertySignature(member) && propertyName(ts, member.name) === name,
  );
  return (
    !!property?.type && property.type.kind === ts.SyntaxKind.BooleanKeyword
  );
}

function queryCallInMethod(
  ts: TsApi,
  method: import('typescript').MethodDeclaration,
): readonly import('typescript').CallExpression[] {
  const calls: import('typescript').CallExpression[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'query' &&
      hasAttemptRowType(ts, node) &&
      node.arguments.length >= 1
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  if (method.body) visit(method.body);
  return calls;
}

function sqlHasKnownProjection(
  ts: TsApi,
  call: import('typescript').CallExpression,
): boolean {
  const sql = queryText(ts, call.arguments[0]);
  if (sql === null) return false;
  const normalized = sql.replace(/\s+/gu, ' ').trim().toLowerCase();
  const selectEnd = normalized.indexOf(' from ');
  if (!normalized.startsWith('select ') || selectEnd < 0) return false;
  const projection = normalized.slice('select '.length, selectEnd);
  const presenceProjection =
    /\(\s*a\.feedback\s+is\s+not\s+null\s*\)\s+as\s+feedback_present\b/u.test(
      projection,
    );
  const durableTextProjection =
    /(?:^|,)\s*a\.feedback\s*(?:,|$)/u.test(projection) ||
    /a\.feedback\s+as\s+(?!feedback_present\b)[a-z_][a-z0-9_]*/u.test(
      projection,
    );
  return presenceProjection && !durableTextProjection;
}

function mappingHasPresenceStructure(
  ts: TsApi,
  method: import('typescript').MethodDeclaration,
): boolean {
  const objects: import('typescript').ObjectLiteralExpression[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (ts.isObjectLiteralExpression(node)) objects.push(node);
    ts.forEachChild(node, visit);
  };
  if (method.body) visit(method.body);
  return objects.some((object) => {
    const feedbackCapture = object.properties.find(
      (property): property is import('typescript').PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        propertyName(ts, property.name) === 'feedbackCapture',
    );
    if (
      !feedbackCapture ||
      !ts.isConditionalExpression(feedbackCapture.initializer)
    )
      return false;
    const condition = feedbackCapture.initializer.condition;
    const directPresence =
      ts.isPropertyAccessExpression(condition) &&
      condition.name.text === 'feedback_present';
    const comparedPresence =
      ts.isBinaryExpression(condition) &&
      condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isPropertyAccessExpression(condition.left) &&
      condition.left.name.text === 'feedback_present' &&
      isString(ts, condition.right, 'present');
    if (!directPresence && !comparedPresence) return false;
    return (
      isString(ts, feedbackCapture.initializer.whenTrue, 'present') &&
      isString(ts, feedbackCapture.initializer.whenFalse, 'absent')
    );
  });
}

function inspectShape1(
  ts: TsApi,
  source: import('typescript').SourceFile,
): ShapeResult {
  const methods = findMethod(ts, source, 'getByRootTask');
  const interfaces = findInterface(ts, source, 'AttemptRow');
  if (methods.length !== 1 || interfaces.length !== 1)
    return {
      state: 'AMBIGUOUS',
      reason: 'getByRootTask_or_AttemptRow_not_unique',
    };
  const calls = queryCallInMethod(ts, methods[0]);
  if (calls.length !== 1)
    return { state: 'AMBIGUOUS', reason: 'AttemptRow_query_call_not_unique' };
  const presenceField = interfaceBooleanProperty(
    ts,
    interfaces[0],
    'feedback_present',
  );
  const mapping = mappingHasPresenceStructure(ts, methods[0]);
  if (sqlHasKnownProjection(ts, calls[0]) && presenceField && mapping)
    return {
      state: 'PRESENT',
      reason: 'presence_only_query_and_presence_mapping',
    };
  return {
    state: 'ABSENT',
    reason: `known_shape_not_found:${[
      !sqlHasKnownProjection(ts, calls[0]) ? 'query_projection' : '',
      !presenceField ? 'AttemptRow.feedback_present' : '',
      !mapping ? 'feedbackCapture_mapping' : '',
    ]
      .filter(Boolean)
      .join(',')}`,
  };
}

function mapAttemptObject(
  ts: TsApi,
  source: import('typescript').SourceFile,
): readonly import('typescript').ObjectLiteralExpression[] {
  const objects: import('typescript').ObjectLiteralExpression[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(ts, node.name) === 'attempts' &&
      ts.isCallExpression(node.initializer) &&
      ts.isPropertyAccessExpression(node.initializer.expression) &&
      node.initializer.expression.name.text === 'map'
    ) {
      const callback = node.initializer.arguments[0];
      if (
        callback &&
        ts.isArrowFunction(callback) &&
        callback.body &&
        ts.isParenthesizedExpression(callback.body)
      ) {
        if (ts.isObjectLiteralExpression(callback.body.expression))
          objects.push(callback.body.expression);
      } else if (
        callback &&
        ts.isArrowFunction(callback) &&
        ts.isObjectLiteralExpression(callback.body)
      ) {
        objects.push(callback.body);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return objects;
}

function inspectShape2(
  ts: TsApi,
  source: import('typescript').SourceFile,
): ShapeResult {
  const functions: import('typescript').FunctionDeclaration[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      identifierText(ts, node.name) === 'mapWorkProjectionFacts'
    )
      functions.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (functions.length !== 1)
    return { state: 'AMBIGUOUS', reason: 'mapWorkProjectionFacts_not_unique' };
  const objects = mapAttemptObject(ts, functions[0]);
  if (objects.length !== 1)
    return { state: 'AMBIGUOUS', reason: 'attempt_map_object_not_unique' };
  const object = objects[0];
  const summary = object.properties.find(
    (property): property is import('typescript').PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      propertyName(ts, property.name) === 'feedback_summary',
  );
  const status = object.properties.find(
    (property): property is import('typescript').PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      propertyName(ts, property.name) === 'feedback_capture_status',
  );
  const summaryPresent =
    !!summary && summary.initializer.kind === ts.SyntaxKind.NullKeyword;
  let statusPresent = false;
  if (status && ts.isConditionalExpression(status.initializer)) {
    const condition = status.initializer.condition;
    statusPresent =
      ts.isBinaryExpression(condition) &&
      condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isPropertyAccessExpression(condition.left) &&
      condition.left.name.text === 'feedbackCapture' &&
      isString(ts, condition.right, 'present') &&
      isString(ts, status.initializer.whenTrue, 'redacted') &&
      isString(ts, status.initializer.whenFalse, 'not_present');
  }
  if (summaryPresent && statusPresent)
    return {
      state: 'PRESENT',
      reason: 'null_summary_and_presence_to_status_mapping',
    };
  return {
    state: 'ABSENT',
    reason: `known_shape_not_found:${[
      !summaryPresent ? 'feedback_summary_null' : '',
      !statusPresent ? 'feedback_capture_status_mapping' : '',
    ]
      .filter(Boolean)
      .join(',')}`,
  };
}

export async function inspectStaticShape(
  options: {
    readonly queryFile?: string;
    readonly mapperFile?: string;
    readonly typescriptModule?: string;
  } = {},
): Promise<StaticShapeResult> {
  let ts: TsApi;
  try {
    ts = loadTypescript(options.typescriptModule);
    const query = await sourceFile(ts, options.queryFile ?? defaultQueryFile);
    const mapper = await sourceFile(
      ts,
      options.mapperFile ?? defaultMapperFile,
    );
    const shape1 = inspectShape1(ts, query);
    const shape2 = inspectShape2(ts, mapper);
    if (shape1.state === 'PRESENT' && shape2.state === 'PRESENT')
      return {
        machine: FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR,
        status: 'KNOWN_DEFECT_SHAPE_PRESENT',
        exit_code: KNOWN_DEFECT_SHAPE_PRESENT,
        shape1,
        shape2,
        independent_of: ['E11', 'LIVE'],
        schedules_live_confirmation: false,
      };
    if (shape1.state === 'ABSENT' && shape2.state === 'ABSENT')
      return {
        machine: FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR,
        status: 'LIVE_CONFIRMATION_REQUIRED',
        exit_code: LIVE_CONFIRMATION_REQUIRED,
        shape1,
        shape2,
        independent_of: ['E11', 'LIVE'],
        schedules_live_confirmation: true,
      };
    return {
      machine: FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR,
      status: 'MISSING',
      exit_code: MISSING,
      shape1,
      shape2,
      independent_of: ['E11', 'LIVE'],
      schedules_live_confirmation: false,
    };
  } catch (error) {
    const missing =
      error instanceof MissingInput
        ? error.reason
        : 'static_shape_check_failed';
    const unavailable: ShapeResult = { state: 'UNAVAILABLE', reason: missing };
    return {
      machine: FEEDBACK_PROJECTION_KNOWN_DEFECT_SHAPE_MONITOR,
      status: 'MISSING',
      exit_code: MISSING,
      shape1: unavailable,
      shape2: unavailable,
      independent_of: ['E11', 'LIVE'],
      schedules_live_confirmation: false,
    };
  }
}

async function main(): Promise<void> {
  const result = await inspectStaticShape({
    queryFile: argument('--query-file'),
    mapperFile: argument('--mapper-file'),
    typescriptModule: argument('--typescript-module'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exit_code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
