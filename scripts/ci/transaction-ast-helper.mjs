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
const nativePackagePath = path.resolve(packageRoot, '..', nativePackageName, 'package.json');
if (!fs.existsSync(nativePackagePath)) throw new Error(`ownership AST native compiler package missing: ${nativePackagePath}`);
const executablePath = path.join(path.dirname(nativePackagePath), 'lib', 'tsc');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
  throw new Error(`ownership AST requires TypeScript 7.0.2, got ${compilerIdentity.typescriptVersion}`);
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
  return functionPredicateNames.some((name) => typeof ast[name] === 'function' && ast[name](node));
}

function queryReceiver(call) {
  const expression = call.expression;
  return ast.isPropertyAccessExpression(expression) ? expression.expression.getText() : null;
}

function sqlLiteral(node) {
  if (!node) return null;
  if (ast.isStringLiteral(node) || ast.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function operation(sql) {
  return sql?.trim().match(/^(BEGIN|COMMIT|ROLLBACK)\b/i)?.[1].toUpperCase() ?? null;
}

function start(node, sourceFile) {
  return node.getStart(sourceFile);
}

function end(node, sourceFile) {
  return node.getEnd();
}

function contains(node, child, sourceFile) {
  return start(node, sourceFile) <= start(child, sourceFile) && end(node, sourceFile) >= end(child, sourceFile);
}

function statementIndex(block, node, sourceFile) {
  if (!block?.statements) return -1;
  return [...block.statements].findIndex((statement) => contains(statement, node, sourceFile));
}

function explicitTransaction(calls, target, sourceFile) {
  const controls = calls.filter((call) => call.receiver === target.receiver && call.functionScope === target.functionScope);
  const begins = controls.filter((call) => call.sqlOperation === 'BEGIN' && start(call.node, sourceFile) < start(target.node, sourceFile));
  if (!begins.length) return 'out';
  const begin = begins.at(-1);
  const targetIndex = target.statementIndex;
  const beginIndex = begin.statementIndex;
  if (!target.blockScope || !begin.blockScope || targetIndex < 0 || beginIndex < 0) return 'unknown';
  const definiteEnd = controls.find((call) => {
    if (!['COMMIT', 'ROLLBACK'].includes(call.sqlOperation) || start(call.node, sourceFile) >= start(target.node, sourceFile)) return false;
    return call.blockScope === target.blockScope && call.statementIndex > beginIndex && call.statementIndex < targetIndex;
  });
  if (definiteEnd) return 'out';
  if (begin.blockScope === target.blockScope && beginIndex >= targetIndex) return 'out';
  return 'in';
}

function explicitControls(calls, target, sourceFile) {
  const controls = calls.filter((call) => call.receiver === target.receiver && call.functionScope === target.functionScope);
  const targetStart = start(target.node, sourceFile);
  return {
    beginBefore: controls.some((call) => call.sqlOperation === 'BEGIN' && start(call.node, sourceFile) < targetStart),
    controlAfter: controls.some((call) => ['COMMIT', 'ROLLBACK'].includes(call.sqlOperation) && start(call.node, sourceFile) > targetStart),
  };
}

function parseSource(fileName, source, consume) {
  const cwd = `/tmp/ownership-ledger-ast/${fileName.replaceAll('/', '_')}`;
  const virtualFile = `${cwd}/${fileName}`;
  const fsCallbacks = createVirtualFileSystem({ [virtualFile]: source });
  const api = new API({ tsserverPath: executablePath, cwd, fs: fsCallbacks });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({ openFiles: [virtualFile] });
    const project = snapshot.getDefaultProjectForFile(virtualFile);
    const sourceFile = project?.program.getSourceFile(virtualFile);
    if (!project || !sourceFile) throw new Error(`ownership AST could not materialize ${fileName}`);
    const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
    const sourceFileHash = crypto.createHash('sha256').update(sourceFile.text).digest('hex');
    if (sourceHash !== sourceFileHash) throw new Error(`ownership AST source hash mismatch for ${fileName}`);
    return consume(sourceFile, sourceHash);
  } finally {
    snapshot?.dispose();
    api.close();
  }
}

export function deriveTransactions(source, fileName = 'source.ts') {
  return parseSource(fileName, source, (sourceFile, sourceHash) => {
    const calls = [];
    const withTransactions = [];
    function visit(node, ancestors = []) {
      if (ast.isCallExpression(node) && ast.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'withTransaction') {
        for (const argument of node.arguments) {
          withTransactions.push({
            start: start(argument, sourceFile),
            end: end(argument, sourceFile),
          });
        }
      }
      if (ast.isCallExpression(node) && ast.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query') {
        const sql = sqlLiteral(node.arguments[0]);
        const functionNode = [...ancestors].reverse().find((ancestor) => isFunctionLike(ancestor));
        const blockNode = [...ancestors].reverse().find((ancestor) => ast.isBlock(ancestor) || ast.isSourceFile(ancestor));
        calls.push({
          node,
          file: fileName,
          line: sourceFile.getLineAndCharacterOfPosition(start(node, sourceFile)).line + 1,
          receiver: queryReceiver(node),
          sql,
          sqlOperation: operation(sql),
          typed: Boolean(node.typeArguments?.length),
          withTransactionScope: null,
          functionScope: functionNode ? `${start(functionNode, sourceFile)}:${end(functionNode, sourceFile)}` : null,
          blockScope: blockNode ? `${start(blockNode, sourceFile)}:${end(blockNode, sourceFile)}` : null,
          statementIndex: statementIndex(blockNode, node, sourceFile),
        });
      }
      node.forEachChild((child) => visit(child, [...ancestors, node]));
    }
    sourceFile.forEachChild(visit);
    for (const call of calls) {
      const callback = withTransactions.find((candidate) => start(call.node, sourceFile) >= candidate.start && end(call.node, sourceFile) <= candidate.end);
      call.withTransactionScope = callback ? `${callback.start}:${callback.end}` : null;
    }
    const derived = calls.map((call) => ({
      ...call,
      inWithTransaction: Boolean(call.withTransactionScope),
      explicitControls: explicitControls(calls, call, sourceFile),
      transaction: call.sqlOperation === 'BEGIN'
        ? 'in'
        : ['COMMIT', 'ROLLBACK'].includes(call.sqlOperation)
          ? 'out'
          : Boolean(call.withTransactionScope)
            ? 'in'
            : explicitTransaction(calls, call, sourceFile),
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
  return [call.receiver, call.sqlOperation, call.sql?.replace(/\s+/g, ' ').trim() ?? null, call.typed].join('|');
}
