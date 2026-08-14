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
type ShapeState = 'PRESENT' | 'ABSENT' | 'UNKNOWN' | 'UNAVAILABLE';

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

function unwrap(
  ts: TsApi,
  node: import('typescript').Expression | undefined,
): import('typescript').Expression | undefined {
  let current = node;
  while (current) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current))
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
  return undefined;
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

function isThisDatabaseQuery(
  ts: TsApi,
  call: import('typescript').CallExpression,
): boolean {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'query' &&
    ts.isPropertyAccessExpression(call.expression.expression) &&
    call.expression.expression.name.text === 'database' &&
    call.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

function findTargetClass(
  ts: TsApi,
  source: import('typescript').SourceFile,
): readonly import('typescript').ClassDeclaration[] {
  const matches: import('typescript').ClassDeclaration[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isClassDeclaration(node) &&
      identifierText(ts, node.name) === 'PostgresWorkProjectionFactsQuery'
    )
      matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches;
}

function targetMethod(
  ts: TsApi,
  declaration: import('typescript').ClassDeclaration,
): readonly import('typescript').MethodDeclaration[] {
  return declaration.members.filter(
    (member): member is import('typescript').MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      propertyName(ts, member.name) === 'getByRootTask',
  );
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

function interfaceProperty(
  ts: TsApi,
  declaration: import('typescript').InterfaceDeclaration,
  name: string,
): import('typescript').PropertySignature | undefined {
  return declaration.members.find(
    (member): member is import('typescript').PropertySignature =>
      ts.isPropertySignature(member) && propertyName(ts, member.name) === name,
  );
}

function interfaceDurableFeedbackProperty(
  ts: TsApi,
  declaration: import('typescript').InterfaceDeclaration,
): boolean {
  const property = interfaceProperty(ts, declaration, 'feedback');
  if (!property?.type) return false;
  const type = property.type;
  if (ts.isUnionTypeNode(type)) {
    return (
      type.types.some(
        (member) => member.kind === ts.SyntaxKind.StringKeyword,
      ) &&
      type.types.some(
        (member) =>
          member.kind === ts.SyntaxKind.NullKeyword ||
          (ts.isLiteralTypeNode(member) &&
            member.literal.kind === ts.SyntaxKind.NullKeyword),
      )
    );
  }
  return type.kind === ts.SyntaxKind.StringKeyword;
}

function queryCallInMethod(
  ts: TsApi,
  method: import('typescript').MethodDeclaration,
): readonly import('typescript').CallExpression[] {
  const calls: import('typescript').CallExpression[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isCallExpression(node) &&
      isThisDatabaseQuery(ts, node) &&
      hasAttemptRowType(ts, node) &&
      node.arguments.length >= 1
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  if (method.body) visit(method.body);
  return calls;
}

function localStringArgument(
  ts: TsApi,
  call: import('typescript').CallExpression,
): import('typescript').Expression | undefined {
  const argument = unwrap(ts, call.arguments[0]);
  if (!argument) return undefined;
  if (
    ts.isStringLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument)
  )
    return argument;
  if (!ts.isIdentifier(argument)) return undefined;
  const method = call.parent;
  let scope: import('typescript').Node | undefined = method;
  while (scope && !ts.isMethodDeclaration(scope)) scope = scope.parent;
  if (!scope || !scope.body) return undefined;
  let found: import('typescript').Expression | undefined;
  let definitions = 0;
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === argument.text &&
      node.initializer
    ) {
      definitions += 1;
      found = unwrap(ts, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope.body);
  return definitions === 1 ? found : undefined;
}

function sqlHasKnownProjection(
  ts: TsApi,
  call: import('typescript').CallExpression,
): boolean {
  const sql = queryText(ts, localStringArgument(ts, call));
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

function sqlHasDurableProjection(
  ts: TsApi,
  call: import('typescript').CallExpression,
): boolean {
  const sql = queryText(ts, localStringArgument(ts, call));
  if (sql === null) return false;
  const normalized = sql.replace(/\s+/gu, ' ').trim().toLowerCase();
  const selectEnd = normalized.indexOf(' from ');
  if (!normalized.startsWith('select ') || selectEnd < 0) return false;
  const projection = normalized.slice('select '.length, selectEnd);
  return (
    /(?:^|,)\s*a\.feedback\s*(?:,|$)/u.test(projection) ||
    /a\.feedback\s+as\s+(?!feedback_present\b)[a-z_][a-z0-9_]*/u.test(
      projection,
    )
  );
}

function mappingHasPresenceStructure(
  ts: TsApi,
  method: import('typescript').MethodDeclaration,
  query: import('typescript').CallExpression,
): { readonly presence: boolean; readonly durable: boolean } {
  const resultName = queryResultName(ts, query);
  if (!resultName) return { presence: false, durable: false };
  let attemptsName: string | undefined;
  let attemptsDeclarations = 0;
  const visitDeclarations = (node: import('typescript').Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = unwrap(
        ts,
        node.initializer as import('typescript').Expression,
      );
      if (
        initializer &&
        ts.isBinaryExpression(initializer) &&
        initializer.operatorToken.kind ===
          ts.SyntaxKind.QuestionQuestionToken &&
        ts.isPropertyAccessExpression(initializer.left) &&
        ts.isIdentifier(initializer.left.expression) &&
        initializer.left.expression.text === resultName &&
        initializer.left.name.text === 'rows'
      ) {
        attemptsDeclarations += 1;
        attemptsName = node.name.text;
      }
    }
    ts.forEachChild(node, visitDeclarations);
  };
  if (method.body) visitDeclarations(method.body);
  if (!attemptsName || attemptsDeclarations !== 1)
    return { presence: false, durable: false };
  const objects: {
    object: import('typescript').ObjectLiteralExpression;
    loopName: string;
  }[] = [];
  const visitLoops = (node: import('typescript').Node): void => {
    if (
      ts.isForOfStatement(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === attemptsName &&
      ts.isVariableDeclarationList(node.initializer) &&
      node.initializer.declarations.length === 1 &&
      ts.isIdentifier(node.initializer.declarations[0].name)
    ) {
      const loopName = node.initializer.declarations[0].name.text;
      const visitBody = (child: import('typescript').Node): void => {
        if (ts.isObjectLiteralExpression(child))
          objects.push({ object: child, loopName });
        ts.forEachChild(child, visitBody);
      };
      visitBody(node.statement);
    }
    ts.forEachChild(node, visitLoops);
  };
  if (method.body) visitLoops(method.body);
  const object = objects.find(({ object }) =>
    object.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        propertyName(ts, property.name) === 'feedbackCapture',
    ),
  );
  if (!object) return { presence: false, durable: false };
  const feedbackCapture = object.object.properties.find(
    (property): property is import('typescript').PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      propertyName(ts, property.name) === 'feedbackCapture',
  );
  if (
    !feedbackCapture ||
    !ts.isConditionalExpression(feedbackCapture.initializer)
  )
    return { presence: false, durable: false };
  const condition = feedbackCapture.initializer.condition;
  const directPresence =
    ts.isPropertyAccessExpression(condition) &&
    ts.isIdentifier(condition.expression) &&
    condition.expression.text === object.loopName &&
    condition.name.text === 'feedback_present';
  const comparedPresence =
    ts.isBinaryExpression(condition) &&
    condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isPropertyAccessExpression(condition.left) &&
    ts.isIdentifier(condition.left.expression) &&
    condition.left.expression.text === object.loopName &&
    condition.left.name.text === 'feedback_present' &&
    isString(ts, condition.right, 'present');
  const presence =
    (directPresence || comparedPresence) &&
    isString(ts, feedbackCapture.initializer.whenTrue, 'present') &&
    isString(ts, feedbackCapture.initializer.whenFalse, 'absent');
  let durable = false;
  const scanDurable = (node: import('typescript').Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === object.loopName &&
      node.name.text === 'feedback'
    )
      durable = true;
    ts.forEachChild(node, scanDurable);
  };
  scanDurable(object.object);
  return { presence, durable };
}

function queryResultName(
  ts: TsApi,
  query: import('typescript').CallExpression,
): string | undefined {
  let array: import('typescript').ArrayLiteralExpression | undefined;
  let node: import('typescript').Node | undefined = query;
  while (node) {
    if (ts.isArrayLiteralExpression(node)) {
      array = node;
      break;
    }
    node = node.parent;
  }
  if (!array) return undefined;
  const index = array.elements.findIndex((element) => element === query);
  if (index < 0) return undefined;
  node = array.parent;
  while (node && !ts.isVariableDeclaration(node)) node = node.parent;
  if (!node || !ts.isVariableDeclaration(node)) return undefined;
  if (!ts.isArrayBindingPattern(node.name)) return undefined;
  const element = node.name.elements[index];
  return element &&
    ts.isBindingElement(element) &&
    ts.isIdentifier(element.name)
    ? element.name.text
    : undefined;
}

function inspectShape1(
  ts: TsApi,
  source: import('typescript').SourceFile,
): ShapeResult {
  const classes = findTargetClass(ts, source);
  const interfaces = findInterface(ts, source, 'AttemptRow');
  if (classes.length !== 1 || interfaces.length !== 1)
    return {
      state: 'UNKNOWN',
      reason: 'target_class_or_AttemptRow_not_unique',
    };
  const methods = targetMethod(ts, classes[0]);
  if (methods.length !== 1)
    return { state: 'UNKNOWN', reason: 'target_getByRootTask_not_unique' };
  const calls = queryCallInMethod(ts, methods[0]);
  if (calls.length !== 1)
    return {
      state: 'UNKNOWN',
      reason: 'target_AttemptRow_query_call_not_unique',
    };
  const presenceField = interfaceBooleanProperty(
    ts,
    interfaces[0],
    'feedback_present',
  );
  const durableField = interfaceProperty(ts, interfaces[0], 'feedback');
  const durableFieldShape = interfaceDurableFeedbackProperty(ts, interfaces[0]);
  const mapping = mappingHasPresenceStructure(ts, methods[0], calls[0]);
  const knownPresence = sqlHasKnownProjection(ts, calls[0]);
  const durableProjection = sqlHasDurableProjection(ts, calls[0]);
  if (
    knownPresence &&
    presenceField &&
    mapping.presence &&
    !durableField &&
    !mapping.durable
  )
    return {
      state: 'PRESENT',
      reason: 'presence_only_query_and_presence_mapping',
    };
  if (
    durableProjection &&
    !knownPresence &&
    durableFieldShape &&
    mapping.durable &&
    !presenceField &&
    !mapping.presence
  )
    return {
      state: 'ABSENT',
      reason: 'durable_feedback_query_replaces_presence_only_projection',
    };
  return {
    state: 'UNKNOWN',
    reason: `target_shape_not_explicitly_classified:${[
      !knownPresence ? 'query_projection' : '',
      !presenceField ? 'AttemptRow.feedback_present' : '',
      !mapping.presence ? 'bound_presence_mapping' : '',
      !durableProjection ? 'durable_query_projection' : '',
      !durableFieldShape ? 'AttemptRow.feedback:string_nullable' : '',
      !mapping.durable ? 'bound_durable_mapping' : '',
    ]
      .filter(Boolean)
      .join(',')}`,
  };
}

function actualAttemptObject(
  ts: TsApi,
  fn: import('typescript').FunctionDeclaration,
):
  | {
      readonly object: import('typescript').ObjectLiteralExpression;
      readonly parameter: string;
    }
  | undefined {
  const directReturns =
    fn.body?.statements.filter((statement) =>
      ts.isReturnStatement(statement),
    ) ?? [];
  if (directReturns.length !== 1) return undefined;
  let outer: import('typescript').ObjectLiteralExpression | undefined;
  const expression = unwrap(ts, directReturns[0].expression);
  if (
    expression &&
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'parse' &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text ===
      'ProductProjectionIdentitySchema' &&
    expression.arguments.length === 1
  ) {
    const argument = unwrap(ts, expression.arguments[0]);
    if (argument && ts.isObjectLiteralExpression(argument)) outer = argument;
  }
  if (!outer) return undefined;
  const work = outer.properties.find(
    (property): property is import('typescript').PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      propertyName(ts, property.name) === 'work_items',
  );
  if (!work) return undefined;
  const workMap = unwrap(ts, work.initializer);
  if (
    !workMap ||
    !ts.isCallExpression(workMap) ||
    !ts.isPropertyAccessExpression(workMap.expression) ||
    workMap.expression.name.text !== 'map' ||
    !ts.isPropertyAccessExpression(workMap.expression.expression) ||
    !ts.isIdentifier(workMap.expression.expression.expression) ||
    workMap.expression.expression.expression.text !== 'facts' ||
    workMap.expression.expression.name.text !== 'workItems'
  )
    return undefined;
  const workCallback = workMap.arguments[0];
  if (
    !workCallback ||
    !ts.isArrowFunction(workCallback) ||
    workCallback.parameters.length !== 1 ||
    !ts.isIdentifier(workCallback.parameters[0].name)
  )
    return undefined;
  const workObject = unwrap(
    ts,
    workCallback.body as import('typescript').Expression,
  );
  if (!workObject || !ts.isObjectLiteralExpression(workObject))
    return undefined;
  const attempts = workObject.properties.find(
    (property): property is import('typescript').PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      propertyName(ts, property.name) === 'attempts',
  );
  if (!attempts) return undefined;
  const attemptsMap = unwrap(ts, attempts.initializer);
  if (
    !attemptsMap ||
    !ts.isCallExpression(attemptsMap) ||
    !ts.isPropertyAccessExpression(attemptsMap.expression) ||
    attemptsMap.expression.name.text !== 'map' ||
    !ts.isPropertyAccessExpression(attemptsMap.expression.expression) ||
    !ts.isIdentifier(attemptsMap.expression.expression.expression) ||
    attemptsMap.expression.expression.expression.text !==
      workCallback.parameters[0].name.text ||
    attemptsMap.expression.expression.name.text !== 'attempts'
  )
    return undefined;
  const callback = attemptsMap.arguments[0];
  if (
    !callback ||
    !ts.isArrowFunction(callback) ||
    callback.parameters.length !== 1 ||
    !ts.isIdentifier(callback.parameters[0].name)
  )
    return undefined;
  const object = unwrap(ts, callback.body as import('typescript').Expression);
  return object && ts.isObjectLiteralExpression(object)
    ? { object, parameter: callback.parameters[0].name.text }
    : undefined;
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
    return { state: 'UNKNOWN', reason: 'mapWorkProjectionFacts_not_unique' };
  const actual = actualAttemptObject(ts, functions[0]);
  if (!actual)
    return {
      state: 'UNKNOWN',
      reason: 'actual_product_parse_attempt_map_not_found',
    };
  const { object, parameter } = actual;
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
  const summaryValue = summary && unwrap(ts, summary.initializer);
  const summaryPresent =
    !!summaryValue && summaryValue.kind === ts.SyntaxKind.NullKeyword;
  const summaryDurable =
    !!summaryValue &&
    (() => {
      let found = false;
      const visit = (node: import('typescript').Node): void => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === parameter &&
          node.name.text === 'feedback'
        )
          found = true;
        ts.forEachChild(node, visit);
      };
      visit(summaryValue);
      return found;
    })();
  let statusPresent = false;
  if (status && ts.isConditionalExpression(status.initializer)) {
    const condition = status.initializer.condition;
    statusPresent =
      ts.isBinaryExpression(condition) &&
      condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isPropertyAccessExpression(condition.left) &&
      ts.isIdentifier(condition.left.expression) &&
      condition.left.expression.text === parameter &&
      condition.left.name.text === 'feedbackCapture' &&
      isString(ts, condition.right, 'present') &&
      isString(ts, status.initializer.whenTrue, 'redacted') &&
      isString(ts, status.initializer.whenFalse, 'not_present');
  }
  if (summaryPresent && statusPresent && !summaryDurable)
    return {
      state: 'PRESENT',
      reason: 'null_summary_and_presence_to_status_mapping',
    };
  const successorStatus =
    !!status &&
    ts.isConditionalExpression(status.initializer) &&
    (() => {
      const condition = status.initializer.condition;
      return (
        ts.isBinaryExpression(condition) &&
        condition.operatorToken.kind ===
          ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isPropertyAccessExpression(condition.left) &&
        ts.isIdentifier(condition.left.expression) &&
        condition.left.expression.text === parameter &&
        condition.left.name.text === 'feedbackCapture' &&
        isString(ts, condition.right, 'present') &&
        ts.isStringLiteral(status.initializer.whenTrue) &&
        ['present', 'captured', 'available'].includes(
          status.initializer.whenTrue.text,
        ) &&
        isString(ts, status.initializer.whenFalse, 'not_present')
      );
    })();
  if (summaryDurable && successorStatus)
    return {
      state: 'ABSENT',
      reason: 'durable_feedback_summary_and_non_redacted_status_mapping',
    };
  return {
    state: 'UNKNOWN',
    reason: `target_shape_not_explicitly_classified:${[
      !summaryPresent ? 'feedback_summary_null' : '',
      !summaryDurable ? 'durable_feedback_summary' : '',
      !statusPresent ? 'feedback_capture_status_mapping' : '',
      !successorStatus ? 'non_redacted_status_mapping' : '',
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
