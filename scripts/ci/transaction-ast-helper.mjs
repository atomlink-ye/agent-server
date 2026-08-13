import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function queryReceiver(call) {
  const expression = call.expression;
  return ts.isPropertyAccessExpression(expression)
    ? expression.expression.getText()
    : null;
}

function sqlLiteral(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function operation(sql) {
  return sql?.trim().match(/^(BEGIN|COMMIT|ROLLBACK)\b/i)?.[1].toUpperCase() ?? null;
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return null;
}

function enclosingBlock(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isBlock(current) || ts.isSourceFile(current)) return current;
  }
  return null;
}

function isInWithTransactionCallback(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isCallExpression(current)) continue;
    const expression = current.expression;
    if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'withTransaction') continue;
    const callback = current.arguments.find((argument) => ts.isFunctionLike(argument));
    if (callback && callback.body && node.getStart() >= callback.body.getStart() && node.getEnd() <= callback.body.getEnd()) return true;
  }
  return false;
}

function contains(node, child) {
  return node.getStart() <= child.getStart() && node.getEnd() >= child.getEnd();
}

function statementIndex(block, node) {
  if (!block || !block.statements) return -1;
  return block.statements.findIndex((statement) => contains(statement, node));
}

function sameFunction(left, right) {
  return enclosingFunction(left) === enclosingFunction(right);
}

function explicitTransaction(calls, target) {
  const controls = calls.filter((call) => call.receiver === target.receiver && sameFunction(call.node, target.node));
  const begins = controls.filter((call) => call.sqlOperation === 'BEGIN' && call.node.getStart() < target.node.getStart());
  if (!begins.length) return 'out';
  const begin = begins.at(-1);
  const block = enclosingBlock(target.node);
  const beginBlock = enclosingBlock(begin.node);
  const targetIndex = statementIndex(block, target.node);
  const beginIndex = statementIndex(beginBlock, begin.node);
  if (!block || !beginBlock || targetIndex < 0 || beginIndex < 0) return 'unknown';

  // A control query in a sibling conditional branch does not end the transaction
  // on every path. Only a control in the same statement block, before the target,
  // is a definite end for this lexical derivation.
  const definiteEnd = controls.find((call) => {
    if (!['COMMIT', 'ROLLBACK'].includes(call.sqlOperation) || call.node.getStart() >= target.node.getStart()) return false;
    const controlBlock = enclosingBlock(call.node);
    return controlBlock === block && statementIndex(controlBlock, call.node) > beginIndex && statementIndex(controlBlock, call.node) < targetIndex;
  });
  if (definiteEnd) return 'out';
  if (beginBlock === block && beginIndex >= targetIndex) return 'out';
  return 'in';
}

export function deriveTransactions(source, fileName = 'source.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query') {
      const sql = sqlLiteral(node.arguments[0]);
      calls.push({
        node,
        file: fileName,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        receiver: queryReceiver(node),
        sql,
        sqlOperation: operation(sql),
        typed: Boolean(node.typeArguments?.length),
        inWithTransaction: isInWithTransactionCallback(node),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const derived = calls.map((call) => ({
    ...call,
    transaction: call.sqlOperation === 'BEGIN'
      ? 'in'
      : ['COMMIT', 'ROLLBACK'].includes(call.sqlOperation)
        ? 'out'
        : call.inWithTransaction
          ? 'in'
          : explicitTransaction(calls, call),
  }));
  return {
    calls: derived,
    rawCalls: derived.filter((call) => !call.typed),
    typedCalls: derived.filter((call) => call.typed),
  };
}

export function semanticIdentity(call) {
  return [call.receiver, call.sqlOperation, call.sql?.replace(/\s+/g, ' ').trim() ?? null, call.typed].join('|');
}
