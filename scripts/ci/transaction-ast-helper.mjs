import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import * as ast from 'typescript/unstable/ast';
import * as tsVersion from 'typescript';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('typescript/package.json');
const packageRoot = path.dirname(packagePath);
const nativePackageName = `@typescript/typescript-${process.platform}-${process.arch}`;
const nativePackagePath = path.resolve(
  packageRoot,
  '..',
  nativePackageName,
  'package.json',
);
if (!fs.existsSync(nativePackagePath))
  throw new Error(
    `ownership AST native compiler package missing: ${nativePackagePath}`,
  );
const executablePath = path.join(path.dirname(nativePackagePath), 'lib', 'tsc');

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

export const compilerIdentity = Object.freeze({
  typescriptVersion: tsVersion.version,
  packagePath,
  packageHash: sha256(packagePath),
  nativePackageName,
  nativePackagePath,
  nativePackageHash: sha256(nativePackagePath),
  executablePath,
  executableHash: sha256(executablePath),
});

if (compilerIdentity.typescriptVersion !== '7.0.2') {
  throw new Error(
    `ownership AST requires TypeScript 7.0.2, got ${compilerIdentity.typescriptVersion}`,
  );
}

const functionPredicateNames = [
  'isConstructorDeclaration',
  'isFunctionDeclaration',
  'isFunctionExpression',
  'isGetAccessorDeclaration',
  'isMethodDeclaration',
  'isSetAccessorDeclaration',
  'isArrowFunction',
];

function isFunctionLike(node) {
  return functionPredicateNames.some(
    (name) => typeof ast[name] === 'function' && ast[name](node),
  );
}

function queryReceiver(call) {
  const expression = call.expression;
  return ast.isPropertyAccessExpression(expression)
    ? expression.expression.getText()
    : null;
}

function sqlLiteral(node) {
  if (!node) return null;
  if (ast.isStringLiteral(node) || ast.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (
    typeof ast.isTemplateExpression === 'function' &&
    ast.isTemplateExpression(node)
  )
    return node
      .getText()
      .replace(/^`|`$/g, '')
      .replace(/\$\{[\s\S]*?\}/g, '<expression>');
  return null;
}

function normalizeSql(sql) {
  return sql?.replace(/\s+/g, ' ').trim() ?? null;
}

function operation(sql) {
  return (
    normalizeSql(sql)
      ?.match(/^(BEGIN|COMMIT|ROLLBACK)\b/i)?.[1]
      .toUpperCase() ?? null
  );
}

function start(node, sourceFile) {
  return node.getStart(sourceFile);
}

function end(node) {
  return node.getEnd();
}

function contains(node, child, sourceFile) {
  return (
    start(node, sourceFile) <= start(child, sourceFile) &&
    end(node) >= end(child)
  );
}

function functionName(node) {
  if (!node) return null;
  if (node.name) return node.name.getText();
  const parent = node.parent;
  if (parent && ast.isVariableDeclaration(parent)) return parent.name.getText();
  return '<anonymous>';
}

function className(node) {
  for (let current = node?.parent; current; current = current.parent) {
    if (ast.isClassDeclaration(current) || ast.isClassExpression(current))
      return current.name?.getText() ?? '<anonymous-class>';
  }
  return null;
}

function functionScope(node, sourceFile) {
  if (!node) return null;
  return `${start(node, sourceFile)}:${end(node)}`;
}

function containingFunction(ancestors) {
  return (
    [...ancestors].reverse().find((ancestor) => isFunctionLike(ancestor)) ??
    null
  );
}

function containingNamedFunction(ancestors) {
  return (
    [...ancestors]
      .reverse()
      .find(
        (ancestor) =>
          isFunctionLike(ancestor) && functionName(ancestor) !== '<anonymous>',
      ) ?? null
  );
}

function enclosingStatement(ancestors) {
  return (
    [...ancestors]
      .reverse()
      .find(
        (ancestor) =>
          ast.isExpressionStatement(ancestor) ||
          ast.isVariableStatement(ancestor) ||
          ast.isReturnStatement(ancestor) ||
          ast.isThrowStatement(ancestor),
      ) ?? null
  );
}

function safeReceiver(receiver) {
  // Only an object-owned database field is provably non-transactional here.
  // Parameters, aliases, clients, and helper-returned receivers remain risky.
  return receiver === 'this.database';
}

function callbackBodies(sourceFile) {
  const callbacks = [];
  function visit(node) {
    if (
      ast.isCallExpression(node) &&
      ast.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'withTransaction'
    ) {
      for (const argument of node.arguments) {
        if (!isFunctionLike(argument) || !argument.body) continue;
        callbacks.push({
          start: start(argument.body, sourceFile),
          end: end(argument.body),
          callbackStart: start(argument, sourceFile),
          callbackEnd: end(argument),
        });
      }
    }
    node.forEachChild(visit);
  }
  sourceFile.forEachChild(visit);
  return callbacks;
}

function classify(call, sourceFile, functions, callbacks) {
  const fn = call.functionNode;
  const inCallback = callbacks.some(
    (candidate) =>
      start(call.node, sourceFile) >= candidate.start &&
      end(call.node) <= candidate.end,
  );
  const hasLiteralBegin = (functions.get(call.functionScope) ?? []).some(
    (candidate) => candidate.sqlOperation === 'BEGIN',
  );
  if (
    !call.sql ||
    call.sqlOperation ||
    inCallback ||
    hasLiteralBegin ||
    !safeReceiver(call.receiver)
  )
    return 'TREAT_AS_IN';
  return 'DEFINITELY_OUT';
}

function parseSource(fileName, source, consume) {
  const cwd = `/tmp/ownership-ledger-ast/${fileName.replaceAll('/', '_')}`;
  const virtualFile = `${cwd}/${fileName}`;
  const fsCallbacks = createVirtualFileSystem({ [virtualFile]: source });
  const api = new API({ tsserverPath: executablePath, cwd, fs: fsCallbacks });
  let snapshot;
  let result;
  let operationError;
  try {
    snapshot = api.updateSnapshot({ openFiles: [virtualFile] });
    const project = snapshot.getDefaultProjectForFile(virtualFile);
    const sourceFile = project?.program.getSourceFile(virtualFile);
    if (!project || !sourceFile)
      throw new Error(`ownership AST could not materialize ${fileName}`);
    const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
    const sourceFileHash = crypto
      .createHash('sha256')
      .update(sourceFile.text)
      .digest('hex');
    if (sourceHash !== sourceFileHash)
      throw new Error(`ownership AST source hash mismatch for ${fileName}`);
    result = consume(sourceFile, sourceHash);
  } catch (error) {
    operationError = error;
  }
  const cleanupErrors = [];
  try {
    snapshot?.dispose();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    api.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (operationError || cleanupErrors.length) {
    const errors = [operationError, ...cleanupErrors].filter(Boolean);
    throw errors.length === 1
      ? errors[0]
      : new AggregateError(
          errors,
          `ownership AST cleanup/classification failed for ${fileName}`,
        );
  }
  return result;
}

export function deriveTransactions(source, fileName = 'source.ts') {
  return parseSource(fileName, source, (sourceFile, sourceHash) => {
    const calls = [];
    const functions = new Map();
    const callbacks = callbackBodies(sourceFile);
    function visit(node, ancestors = []) {
      const fn = containingFunction(ancestors);
      const namedFn = containingNamedFunction(ancestors);
      const statement = enclosingStatement(ancestors);
      const functionScopeId = functionScope(fn, sourceFile);
      if (isFunctionLike(node))
        functions.set(functionScope(node, sourceFile), []);
      if (
        ast.isCallExpression(node) &&
        ast.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'query'
      ) {
        const sql = sqlLiteral(node.arguments[0]);
        const call = {
          node,
          file: fileName,
          line:
            sourceFile.getLineAndCharacterOfPosition(start(node, sourceFile))
              .line + 1,
          start: start(node, sourceFile),
          end: end(node),
          statementStart: statement
            ? start(statement, sourceFile)
            : start(node, sourceFile),
          statementEnd: statement ? end(statement) : end(node),
          functionBodyStart: fn?.body ? start(fn.body, sourceFile) : null,
          receiver: queryReceiver(node),
          sql,
          normalizedSql: normalizeSql(sql),
          sqlFingerprint: normalizeSql(sql)
            ? crypto
                .createHash('sha256')
                .update(normalizeSql(sql))
                .digest('hex')
            : null,
          sqlOperation: operation(sql),
          typed: Boolean(node.typeArguments?.length),
          functionScope: functionScopeId,
          functionName: functionName(namedFn),
          className: className(namedFn),
          queryOrdinal: 0,
          withTransactionScope: null,
          functionNode: fn,
        };
        calls.push(call);
        if (functionScopeId) (functions.get(functionScopeId) ?? []).push(call);
      }
      node.forEachChild((child) => visit(child, [...ancestors, node]));
    }
    sourceFile.forEachChild(visit);
    for (const group of functions.values())
      group.forEach((call, index) => {
        call.queryOrdinal = index + 1;
      });
    for (const call of calls) {
      const callback = callbacks.find(
        (candidate) =>
          start(call.node, sourceFile) >= candidate.start &&
          end(call.node) <= candidate.end,
      );
      call.withTransactionScope = callback
        ? `${callback.callbackStart}:${callback.callbackEnd}`
        : null;
    }
    const derived = calls.map((call) => ({
      ...call,
      inWithTransaction: Boolean(call.withTransactionScope),
      transaction: classify(call, sourceFile, functions, callbacks),
      transactionClassification: classify(
        call,
        sourceFile,
        functions,
        callbacks,
      ),
      transactionEvidence: {
        sourceHash,
        functionName: call.functionName,
        className: call.className,
        queryOrdinal: call.queryOrdinal,
        receiver: call.receiver,
        normalizedSql: call.normalizedSql,
        sqlFingerprint: call.sqlFingerprint,
      },
    }));
    return {
      calls: derived,
      rawCalls: derived.filter((call) => !call.typed),
      typedCalls: derived.filter((call) => call.typed),
      sourceHash,
      compilerIdentity,
    };
  });
}

export function semanticIdentity(call) {
  return [
    call.file,
    call.className,
    call.functionName,
    call.queryOrdinal,
    call.receiver,
    call.normalizedSql ?? normalizeSql(call.sql),
    call.typed,
  ].join('|');
}
