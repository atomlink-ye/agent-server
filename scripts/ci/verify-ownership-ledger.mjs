#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { deriveTransactions } from './transaction-ast-helper.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../..');
const ledgerPath =
  process.env.OWNERSHIP_LEDGER ?? path.join(here, 'ownership-ledger.json');
const sourceRoot = process.env.OWNERSHIP_SOURCE_ROOT ?? repo;

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const failures = [];
const counts = {
  repositories: 0,
  rawQueryCallSites: 0,
  typedQueryCallSites: 0,
  classifiedCallSites: 0,
  missingCallSites: 0,
  ddlTables: 0,
  ledgerTables: Object.keys(ledger.tables ?? {}).length,
  ports: 0,
  contracts: 0,
  crossCapability: 0,
  sourceLockRows: 0,
  transactionCalls: 0,
  rawDefinitelyOut: 0,
  rawTreatAsIn: 0,
  typedDefinitelyOut: 0,
  typedTreatAsIn: 0,
};
const queryTruthSourceDiffs = [];
const ddlTruthSourceDiffs = [];
const classifiedRuntimeTables = new Set();
const typedRuntimeTables = new Set();
let compilerIdentity = null;
const astRepositoryFacts = [];
const transactionLedgerDisagreements = [];

function fail(code, detail) {
  failures.push({ code, detail });
}
function read(file) {
  return fs.readFileSync(path.join(sourceRoot, file), 'utf8');
}
function rel(p) {
  return path.relative(sourceRoot, p).split(path.sep).join('/');
}
function lineAt(s, index) {
  return s.slice(0, index).split('\n').length;
}
function sourceExcerpt(source, line) {
  const lines = source.split('\n');
  return lines
    .slice(Math.max(0, line - 2), Math.min(lines.length, line + 1))
    .join('\n');
}
function excerptHash(source, line) {
  return crypto
    .createHash('sha256')
    .update(sourceExcerpt(source, line))
    .digest('hex');
}

function matchingParen(s, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === quote) {
        if (quote === "'" && s[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      } else if (quote === '`' && c === '\\') i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

function literalSql(
  argument,
  { allowTemplateInterpolation = false, constants = {} } = {},
) {
  const a = argument.trim();
  if (a.startsWith("'")) {
    let out = '';
    for (let i = 1; i < a.length; i += 1) {
      if (a[i] === "'" && a[i + 1] === "'") {
        out += "'";
        i += 1;
        continue;
      }
      if (a[i] === "'") return out;
      out += a[i];
    }
    return null;
  }
  if (a.startsWith('`')) {
    const template = a.slice(1, a.lastIndexOf('`'));
    if (!allowTemplateInterpolation && template.includes('${')) return null;
    return template.replace(
      /\$\{([^}]*)\}/g,
      (_, expression) => constants[expression.trim()] ?? ' ',
    );
  }
  return null;
}

function referencedTables(sql) {
  const names = new Set();
  for (const match of sql.matchAll(
    /\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM|USING)\s+(?:ONLY\s+)?(?:[A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)/gi,
  )) {
    if (Object.hasOwn(ledger.tables ?? {}, match[1])) names.add(match[1]);
    if (
      match[1] === 'durable_kernel_schema_migrations' &&
      Object.hasOwn(ledger.tables ?? {}, 'durable_kernel_migration_registry')
    )
      names.add('durable_kernel_migration_registry');
  }
  return [...names].sort();
}

function scanCalls(file) {
  const source = read(file);
  const calls = [];
  for (const match of source.matchAll(/\.query\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchingParen(source, open);
    const argument = close < 0 ? '' : source.slice(open + 1, close);
    const sql = literalSql(argument);
    const parsedOperation =
      sql
        ?.trim()
        .match(
          /^(SELECT|INSERT|UPDATE|DELETE|WITH|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
        )?.[1]
        .toUpperCase() ?? (sql ? 'OTHER' : 'MISSING');
    const operation =
      parsedOperation === 'BEGIN'
        ? 'BEGIN'
        : ['COMMIT', 'ROLLBACK'].includes(parsedOperation)
          ? 'CONTROL'
          : parsedOperation === 'SELECT'
            ? 'READ'
            : ['INSERT', 'UPDATE', 'DELETE', 'WITH'].includes(parsedOperation)
              ? 'WRITE'
              : sql
                ? 'UNKNOWN'
                : 'MISSING';
    const lock = sql
      ? /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i.test(sql)
        ? 'for_update'
        : /\bFOR\s+SHARE\b/i.test(sql)
          ? 'for_share'
          : 'none'
      : 'unknown';
    const readWrite = sql
      ? parsedOperation === 'SELECT'
        ? 'read'
        : ['INSERT', 'UPDATE', 'DELETE'].includes(parsedOperation) ||
            (parsedOperation === 'WITH' &&
              /\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql))
          ? 'write'
          : 'control'
      : 'unknown';
    const transaction = parsedOperation === 'BEGIN' ? 'in' : 'out';
    const tables = sql ? referencedTables(sql) : [];
    calls.push({
      file: path.basename(file),
      line: lineAt(source, match.index),
      classification: sql ? 'classified' : 'MISSING',
      operation,
      readWrite,
      lock,
      transaction,
      tables,
      _start: match.index,
      _end: close < 0 ? source.length : close,
    });
  }
  return calls;
}

function scanTypedCalls(file) {
  const source = read(file);
  const calls = [];
  const constSql = {};
  for (const match of source.matchAll(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(['`])([\s\S]*?)\2\s*;/g,
  ))
    constSql[match[1]] = match[3];
  for (const match of source.matchAll(/\.query\s*</g)) {
    let cursor = match.index + match[0].length;
    let open = -1;
    while (cursor < source.length) {
      if (source[cursor] === '>' && /^\s*\(/.test(source.slice(cursor + 1))) {
        open = source.indexOf('(', cursor);
        break;
      }
      cursor += 1;
    }
    if (open < 0) continue;
    const close = matchingParen(source, open);
    const argument = close < 0 ? '' : source.slice(open + 1, close);
    const sql = literalSql(argument, {
      allowTemplateInterpolation: true,
      constants: constSql,
    });
    const parsedOperation =
      sql
        ?.trim()
        .match(
          /^(SELECT|INSERT|UPDATE|DELETE|WITH|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
        )?.[1]
        .toUpperCase() ?? (sql ? 'OTHER' : 'MISSING');
    const operation =
      parsedOperation === 'BEGIN'
        ? 'BEGIN'
        : ['COMMIT', 'ROLLBACK'].includes(parsedOperation)
          ? 'CONTROL'
          : parsedOperation === 'SELECT'
            ? 'READ'
            : ['INSERT', 'UPDATE', 'DELETE', 'WITH'].includes(parsedOperation)
              ? 'WRITE'
              : sql
                ? 'UNKNOWN'
                : 'MISSING';
    const lock = sql
      ? /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i.test(sql)
        ? 'for_update'
        : /\bFOR\s+SHARE\b/i.test(sql)
          ? 'for_share'
          : 'none'
      : 'unknown';
    const readWrite = sql
      ? parsedOperation === 'SELECT'
        ? 'read'
        : ['INSERT', 'UPDATE', 'DELETE'].includes(parsedOperation) ||
            (parsedOperation === 'WITH' &&
              /\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql))
          ? 'write'
          : 'control'
      : 'unknown';
    const tables = new Set(sql ? referencedTables(sql) : []);
    for (const [name, value] of Object.entries(constSql))
      if (
        source
          .slice(match.index, close < 0 ? source.length : close)
          .includes(name)
      )
        for (const table of referencedTables(value)) tables.add(table);
    const before = source.slice(0, match.index);
    const lastBegin = Math.max(
      before.lastIndexOf("query('BEGIN'"),
      before.lastIndexOf("query('BEGIN')"),
    );
    const lastEnd = Math.max(
      before.lastIndexOf("query('COMMIT'"),
      before.lastIndexOf("query('ROLLBACK'"),
    );
    const lastWith = before.lastIndexOf('withTransaction');
    const lastBrace = before.lastIndexOf('}');
    calls.push({
      file: path.basename(file),
      line: lineAt(source, match.index),
      classification: sql ? 'classified' : 'MISSING',
      operation,
      readWrite,
      lock,
      transaction:
        parsedOperation === 'BEGIN'
          ? 'in'
          : lastBegin > lastEnd || lastWith > lastBrace
            ? 'in'
            : 'out',
      tables: [...tables].sort(),
      sourceKind: 'typed',
      sourceExcerptHash: excerptHash(source, lineAt(source, match.index)),
      _start: match.index,
      _end: close < 0 ? source.length : close,
    });
  }
  return calls;
}

function scanSourceLocks(file, facts) {
  const basename = path.basename(file);
  const source = read(`src/infrastructure/postgres/${basename}`);
  const rows = [];
  source.split('\n').forEach((line, index) => {
    const match = line.match(/\bFOR\s+(NO\s+KEY\s+UPDATE|UPDATE|SHARE)\b/i);
    if (match) {
      const lineNumber = index + 1;
      const offset =
        source.split('\n').slice(0, index).join('\n').length + (index ? 1 : 0);
      const fact = facts.find(
        (item) => item._start <= offset && item._end >= offset,
      );
      rows.push({
        file: basename,
        line: lineNumber,
        lock: match[1].toLowerCase().startsWith('share')
          ? 'for_share'
          : 'for_update',
        tables:
          fact?.tables ?? referencedTables(sourceExcerpt(source, lineNumber)),
        transaction: fact?.transaction ?? 'out',
        sourceKind: fact?.sourceKind ?? (fact?.typed ? 'typed' : 'sql'),
      });
    }
  });
  for (const match of source.matchAll(/\bpg_advisory_(lock|unlock)\s*\(/gi))
    rows.push({
      file: basename,
      line: lineAt(source, match.index),
      lock: `pg_advisory_${match[1].toLowerCase()}`,
      tables: [],
      transaction: 'out',
      sourceKind: 'sql',
    });
  return rows;
}

function migrationTables() {
  const dir = path.join(sourceRoot, 'src/infrastructure/postgres/migrations');
  const result = [];
  for (const file of fs
    .readdirSync(dir)
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)/gi,
    ))
      result.push({ table: match[1], migration: file });
  }
  return result;
}

function migrationSourceHash() {
  const dir = path.join(sourceRoot, 'src/infrastructure/postgres/migrations');
  const hash = crypto.createHash('sha256');
  for (const file of fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    hash
      .update(file)
      .update('\0')
      .update(fs.readFileSync(path.join(dir, file)))
      .update('\0');
  return {
    count: fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).length,
    hash: hash.digest('hex'),
  };
}

function checkRepositories() {
  const dir = path.join(sourceRoot, 'src/infrastructure/postgres');
  const files = fs
    .readdirSync(dir)
    .filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))
    .sort();
  const ledgerFiles = Object.keys(ledger.repositories ?? {})
    .map((x) => path.basename(x))
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(ledgerFiles))
    fail('repository_ledger_files', { files, ledgerFiles });
  const lockRows = new Set(
    (ledger.sourceLockRows ?? ledger.lockRows ?? []).map(
      (x) => `${x.file}:${x.line}`,
    ),
  );
  for (const file of files) {
    const sourceFile = `src/infrastructure/postgres/${file}`;
    const source = read(sourceFile);
    const calls = scanCalls(sourceFile);
    const typedCalls = scanTypedCalls(sourceFile);
    let ast;
    try {
      ast = deriveTransactions(source, file);
    } catch (error) {
      fail('transaction_classification_MISSING', {
        file,
        error: String(error),
      });
      continue;
    }
    const astCalls = ast.rawCalls;
    const astTypedCalls = ast.typedCalls;
    counts.repositories += 1;
    counts.rawQueryCallSites += calls.length;
    counts.typedQueryCallSites += typedCalls.length;
    counts.transactionCalls += ast.calls.length;
    compilerIdentity ??= ast.compilerIdentity;
    if (
      ast.sourceHash !==
      crypto.createHash('sha256').update(source).digest('hex')
    )
      fail('ast_source_hash_MISMATCH', file);
    astRepositoryFacts.push({
      file,
      calls: ast.calls.map(({ node, ...call }) => call),
    });
    if (astCalls.length !== calls.length)
      fail('ast_raw_query_call_site_reconciliation', {
        file,
        ast: astCalls.length,
        raw: calls.length,
      });
    if (astTypedCalls.length !== typedCalls.length)
      fail('ast_typed_query_call_site_reconciliation', {
        file,
        ast: astTypedCalls.length,
        typed: typedCalls.length,
      });
    const astByLine = new Map(astCalls.map((call) => [call.line, call]));
    const astTypedByLine = new Map(
      astTypedCalls.map((call) => [call.line, call]),
    );
    for (const call of astCalls)
      call.transaction === 'DEFINITELY_OUT'
        ? (counts.rawDefinitelyOut += 1)
        : (counts.rawTreatAsIn += 1);
    for (const call of astTypedCalls)
      call.transaction === 'DEFINITELY_OUT'
        ? (counts.typedDefinitelyOut += 1)
        : (counts.typedTreatAsIn += 1);
    for (const typed of typedCalls)
      for (const table of typed.tables) typedRuntimeTables.add(table);
    const expected = ledger.repositories[file];
    if (typeof expected !== 'string') {
      fail('repository_owner_missing', file);
      continue;
    }
    const ledgerCalls = ledger.callSites?.[file] ?? [];
    const ledgerByLine = new Map(ledgerCalls.map((row) => [row.line, row]));
    let fileClassified = 0;
    let fileMissing = 0;
    if (ledgerCalls.length !== calls.length)
      queryTruthSourceDiffs.push({
        file,
        raw: calls.length,
        classified: null,
        missing: null,
        ledger: ledgerCalls.length,
      });
    for (const call of calls) {
      const key = `${path.basename(file)}:${call.line}`;
      const row = ledgerByLine.get(call.line);
      if (!row) {
        fail('call_site_ledger_MISSING', key);
        continue;
      }
      const override = ledger.overrides?.[key];
      if (override && call.classification !== 'MISSING')
        fail('override_not_dynamic_source', key);
      if (
        override &&
        (!['template', 'helper', 'dynamic'].includes(override.sourceKind) ||
          !override.confidence ||
          !override.evidence ||
          !override.sourceExcerptHash ||
          !override.definitionEvidence ||
          override.definitionEvidence.callsite !== key ||
          override.definitionEvidence.sourceExcerptHash !==
            override.sourceExcerptHash ||
          !override.definitionEvidence.definitionExcerptHash)
      )
        fail('override_metadata_missing', key);
      if (
        override &&
        override.sourceExcerptHash !== excerptHash(read(sourceFile), call.line)
      )
        fail('override_source_excerpt_hash_MISMATCH', key);
      if (override?.definitionEvidence?.definition?.locator) {
        const [definitionFile, definitionLine] =
          override.definitionEvidence.definition.locator.split(':');
        if (
          definitionFile !== file ||
          override.definitionEvidence.definitionExcerptHash !==
            excerptHash(read(sourceFile), Number(definitionLine))
        )
          fail('override_definition_evidence_hash_MISMATCH', key);
      }
      if (key === 'postgres.ts:214') {
        const chain = override.definitionEvidence;
        const source = read(sourceFile);
        if (
          !sourceExcerpt(source, 208).includes(
            'readDurableKernelMigration(filePath)',
          )
        )
          fail('migration_reader_callsite_MISSING', key);
        if (
          !chain.readerDefinition ||
          chain.readerDefinition.locator !== 'postgres.ts:132' ||
          chain.readerDefinition.sourceExcerptHash !== excerptHash(source, 132)
        )
          fail('migration_reader_definition_MISMATCH', key);
        if (
          !chain.migrationSource ||
          chain.migrationSource.directory !==
            'src/infrastructure/postgres/migrations'
        )
          fail('migration_source_directory_MISMATCH', key);
      }
      if (
        !row.transactionEvidence ||
        row.transactionEvidence.locator !== key ||
        row.transactionEvidence.sourceExcerptHash !==
          excerptHash(read(sourceFile), call.line)
      )
        fail('transaction_evidence_MISSING_OR_DRIFT', key);
      const astTransaction = astByLine.get(call.line)?.transaction;
      if (!astTransaction || astTransaction === 'unknown')
        fail('ast_transaction_MISSING', key);
      if (astTransaction && row.transaction !== astTransaction) {
        const disagreement = {
          key,
          ledger: row.transaction,
          derived: astTransaction,
          semanticIdentity: astByLine.get(call.line)?.transactionEvidence,
        };
        transactionLedgerDisagreements.push(disagreement);
        fail('ast_transaction_MISMATCH', disagreement);
      }
      const actual = override
        ? { ...call, ...override, file, line: call.line }
        : call;
      actual.transaction = astTransaction;
      actual.owner = ledger.repositories[path.basename(file)];
      if (actual.classification === 'classified') {
        counts.classifiedCallSites += 1;
        fileClassified += 1;
        for (const table of actual.tables) classifiedRuntimeTables.add(table);
      } else {
        counts.missingCallSites += 1;
        fileMissing += 1;
      }
      if (!row.owner) fail('call_site_owner_MISSING', key);
      if (row.owner !== actual.owner)
        fail('call_site_owner_drift', {
          key,
          ledger: row.owner,
          actual: actual.owner,
        });
      if (astTransaction === 'unknown')
        fail('call_site_transaction_unknown', key);
      for (const field of [
        'file',
        'line',
        'classification',
        'operation',
        'readWrite',
        'lock',
        'tables',
        'owner',
      ])
        if (JSON.stringify(row[field]) !== JSON.stringify(actual[field]))
          fail('call_site_field_drift', {
            key,
            field,
            ledger: row[field],
            actual: actual[field],
          });
      const owners = new Set(
        actual.tables.map((table) =>
          typeof ledger.tables[table] === 'string'
            ? ledger.tables[table]
            : ledger.tables[table]?.owner,
        ),
      );
      const repositoryOwner = ledger.repositories[path.basename(file)];
      const crossesCapability = [...owners].some(
        (owner) => owner && owner !== repositoryOwner,
      );
      if (actual.classification === 'classified' && crossesCapability) {
        counts.crossCapability += 1;
        if (!['(a)', '(b)', '(c)'].includes(row.disposition))
          fail('cross_capability_disposition_MISSING', key);
        if (
          !row.reason ||
          !ledger.crossCapability?.explanations?.[row.disposition]
        )
          fail('cross_capability_reason_missing', key);
      } else if (row.disposition !== null)
        fail('cross_capability_spurious_disposition', key);
    }
    for (const typed of typedCalls) {
      const key = `${file}:${typed.line}`;
      const row = ledger.typedCrossCapability?.[key];
      const typedTruth = ledger.typedCallTruth?.[key];
      const astTransaction = astTypedByLine.get(typed.line)?.transaction;
      if (!astTransaction || astTransaction === 'unknown')
        fail('ast_typed_transaction_MISSING', key);
      const actual = typedTruth ? { ...typed, ...typedTruth } : { ...typed };
      actual.transaction = astTransaction;
      if (
        typedTruth &&
        typedTruth.sourceExcerptHash !==
          excerptHash(read(sourceFile), typed.line)
      )
        fail('typed_call_truth_evidence_MISMATCH', key);
      if (actual.classification === 'MISSING')
        fail('typed_query_call_unclassified_MISSING', key);
      const typedFact = ledger.typedQueryFacts?.[key];
      if (!typedFact) fail('typed_query_fact_ledger_MISSING', key);
      if (astTransaction && typedFact?.transaction !== astTransaction) {
        const disagreement = {
          key,
          ledger: typedFact?.transaction,
          derived: astTransaction,
          semanticIdentity: astTypedByLine.get(typed.line)?.transactionEvidence,
        };
        transactionLedgerDisagreements.push(disagreement);
        fail('ast_typed_transaction_MISMATCH', disagreement);
      }
      if (row && row.transaction !== astTransaction) {
        const disagreement = {
          key,
          ledger: row.transaction,
          derived: astTransaction,
          semanticIdentity: astTypedByLine.get(typed.line)?.transactionEvidence,
        };
        transactionLedgerDisagreements.push(disagreement);
        fail('typed_cross_transaction_MISMATCH', disagreement);
      }
      actual.owner = ledger.repositories[file];
      for (const field of [
        'operation',
        'readWrite',
        'lock',
        'tables',
        'owner',
        'sourceKind',
        'sourceExcerptHash',
      ]) {
        if (
          actual[field] === undefined ||
          actual[field] === null ||
          (field === 'tables' && !Array.isArray(actual[field])) ||
          (field === 'sourceExcerptHash' &&
            actual[field] !== excerptHash(read(sourceFile), typed.line))
        )
          fail('typed_query_fact_MISSING', { key, field });
      }
      if (
        !['BEGIN', 'CONTROL'].includes(actual.operation) &&
        actual.tables.length === 0
      )
        fail('typed_query_fact_tables_MISSING', key);
      for (const field of [
        'operation',
        'readWrite',
        'lock',
        'tables',
        'owner',
        'sourceKind',
        'sourceExcerptHash',
      ]) {
        if (
          !typedFact ||
          JSON.stringify(typedFact[field]) !== JSON.stringify(actual[field])
        )
          fail('typed_query_fact_drift', {
            key,
            field,
            ledger: typedFact?.[field],
            actual: actual[field],
          });
      }
      if (
        row?.sourceExcerptHash &&
        row.sourceExcerptHash !== excerptHash(read(sourceFile), typed.line)
      )
        fail('typed_query_source_excerpt_hash_MISMATCH', key);
      const owners = new Set(
        actual.tables.map((table) =>
          typeof ledger.tables[table] === 'string'
            ? ledger.tables[table]
            : ledger.tables[table]?.owner,
        ),
      );
      const crossesCapability = [...owners].some(
        (owner) => owner && owner !== ledger.repositories[file],
      );
      if (crossesCapability) {
        counts.crossCapability += 1;
        if (
          !row ||
          !['(a)', '(b)', '(c)'].includes(row.disposition) ||
          !row.reason
        )
          fail('typed_cross_capability_disposition_MISSING', key);
      } else if (row) fail('typed_cross_capability_spurious_disposition', key);
    }
    if (
      Object.keys(ledger.typedQueryFacts ?? {}).filter((key) =>
        key.startsWith(`${file}:`),
      ).length !== typedCalls.length
    )
      fail('typed_query_fact_file_coverage', file);
    const lockFacts = [...calls].map((fact) => {
      const row = ledger.callSites?.[file]?.find(
        (item) => item.line === fact.line,
      );
      const key = `${file}:${fact.line}`;
      return row
        ? {
            ...fact,
            transaction: astByLine.get(fact.line)?.transaction,
            tables: row.tables,
            sourceKind: row.sourceKind ?? 'sql',
          }
        : fact;
    });
    if (
      fileClassified + fileMissing !== calls.length ||
      fileClassified !== calls.length
    )
      queryTruthSourceDiffs.push({
        file,
        raw: calls.length,
        classified: fileClassified,
        missing: fileMissing,
        ledger: ledgerCalls.length,
      });
    const typedLockFacts = typedCalls.map((typed) => {
      const truth = astTypedByLine.get(typed.line)?.transaction;
      return truth ? { ...typed, transaction: truth } : typed;
    });
    for (const lock of scanSourceLocks(file, [
      ...lockFacts,
      ...typedLockFacts,
    ])) {
      counts.sourceLockRows += 1;
      const key = `${lock.file}:${lock.line}`;
      const row = (ledger.sourceLockRows ?? []).find(
        (item) => `${item.file}:${item.line}` === key,
      );
      if (!lockRows.has(key)) fail('source_lock_row_missing', key);
      if (!row) continue;
      const fact = ledger.lockFacts?.[key];
      if (!fact) fail('source_lock_fact_MISSING', key);
      if (
        fact &&
        (fact.locator !== key ||
          fact.sourceExcerptHash !==
            excerptHash(read(`src/infrastructure/postgres/${file}`), lock.line))
      )
        fail('source_lock_fact_evidence_MISMATCH', key);
      for (const field of ['lock', 'tables', 'transaction', 'sourceKind'])
        if (
          JSON.stringify((fact ?? row)[field]) !== JSON.stringify(lock[field])
        )
          fail('source_lock_field_drift', {
            key,
            field,
            ledger: (fact ?? row)[field],
            actual: lock[field],
          });
      if (!row.disposition || !row.reason)
        fail('source_lock_disposition_missing', key);
    }
  }
  const migrationTruth = migrationSourceHash();
  const migrationDefinition =
    ledger.overrides?.['postgres.ts:214']?.definitionEvidence?.migrationSource;
  if (
    !migrationDefinition ||
    migrationDefinition.fileCount !== migrationTruth.count ||
    migrationDefinition.fileSetHash !== migrationTruth.hash
  )
    fail('migration_definition_chain_MISMATCH', {
      ledger: migrationDefinition,
      actual: migrationTruth,
    });
  const ledgerCalls = counts.classifiedCallSites + counts.missingCallSites;
  if (ledgerCalls !== counts.rawQueryCallSites)
    fail('query_call_site_reconciliation', {
      raw: counts.rawQueryCallSites,
      classified: ledgerCalls,
    });
  if (queryTruthSourceDiffs.length)
    fail('query_truth_source_diff', queryTruthSourceDiffs);
  if (counts.missingCallSites)
    fail('query_call_site_unclassified_MISSING', {
      actual: counts.missingCallSites,
    });
}

function checkDdl() {
  const ddl = migrationTables();
  counts.ddlTables = ddl.length;
  const missing = ddl.filter(
    ({ table }) => !Object.hasOwn(ledger.tables ?? {}, table),
  );
  const malformed = Object.entries(ledger.tables ?? {}).filter(
    ([, entry]) => !entry || typeof entry !== 'object' || !entry.owner,
  );
  if (missing.length) fail('ddl_table_MISSING', missing);
  const ddlNames = new Set(ddl.map(({ table }) => table));
  for (const [table, entry] of Object.entries(ledger.tables ?? {}))
    if (!ddlNames.has(table) && entry.runtimeAccess !== 'runtime-created')
      ddlTruthSourceDiffs.push({
        table,
        reason: 'ledger extra lacks runtime-created source',
      });
  if (malformed.length)
    fail(
      'table_owner_missing',
      malformed.map(([table]) => table),
    );
  for (const [table, entry] of Object.entries(ledger.tables ?? {})) {
    if (!Object.hasOwn(entry, 'runtimeAccess'))
      fail('table_runtime_access_MISSING', table);
    if (!Object.hasOwn(entry, 'noRuntimeAccess'))
      fail('table_no_runtime_access_MISSING', table);
    if (entry.noRuntimeAccess && !entry.reason)
      fail('no_runtime_access_reason_missing', table);
    if (entry.noRuntimeAccess && entry.runtimeAccess !== 'none')
      fail('no_runtime_access_runtimeAccess_CONTRADICTION', table);
    if (entry.runtimeAccess === 'none' && !entry.noRuntimeAccess)
      fail('runtime_access_none_without_noRuntimeAccess', table);
  }
  for (const { table } of ddl) {
    const entry = ledger.tables[table];
    if (
      entry?.runtimeAccess === 'ledgered' &&
      !entry.noRuntimeAccess &&
      !classifiedRuntimeTables.has(table) &&
      !typedRuntimeTables.has(table)
    )
      fail('ddl_runtime_support_MISSING', table);
    if (
      entry?.noRuntimeAccess &&
      (classifiedRuntimeTables.has(table) || typedRuntimeTables.has(table))
    )
      fail('no_runtime_access_has_runtime_caller', table);
  }
  for (const table of typedRuntimeTables)
    if (
      !Array.isArray(ledger.typedRuntimeAccess?.[table]) ||
      ledger.typedRuntimeAccess[table].length === 0
    )
      fail('typed_runtime_access_evidence_MISSING', table);
  for (const [table, locators] of Object.entries(
    ledger.typedRuntimeAccess ?? {},
  )) {
    if (!Object.hasOwn(ledger.tables ?? {}, table))
      fail('typed_runtime_access_unknown_table', table);
    if (
      !Array.isArray(locators) ||
      locators.some(
        (locator) => typeof locator !== 'string' || !locator.includes(':'),
      )
    )
      fail('typed_runtime_access_locator_MISSING', table);
  }
}

function checkPorts() {
  const dir = path.join(sourceRoot, 'src/application/ports');
  const files = fs
    .readdirSync(dir)
    .filter((x) => x.endsWith('.ts'))
    .sort();
  counts.ports = files.length;
  const got = Object.keys(ledger.ports ?? {}).sort();
  if (files.length !== 28)
    fail('port_truth_source_count', { expected: 28, actual: files.length });
  if (JSON.stringify(files) !== JSON.stringify(got))
    fail('port_owner_coverage', { files, got });
  for (const file of files)
    if (!ledger.ports[file]) fail('port_owner_MISSING', file);
  if (ledger.ports['run-dispatcher.ts'] !== 'Execution')
    fail('run_dispatcher_owner', ledger.ports['run-dispatcher.ts']);
}

function checkContracts() {
  const dir = path.join(sourceRoot, 'src/contracts');
  const files = [];
  function walk(current, prefix = '') {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const r = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else if (
        (name.endsWith('.ts') || name.endsWith('.json')) &&
        !name.endsWith('.test.ts')
      )
        files.push(r);
    }
  }
  walk(dir);
  counts.contracts = files.length;
  const got = Object.keys(ledger.contracts ?? {}).sort();
  const expected = files.sort();
  if (JSON.stringify(expected) !== JSON.stringify(got))
    fail('contract_owner_coverage', { expected, got });
  for (const file of expected)
    if (!ledger.contracts[file] && !ledger.contracts[`src/contracts/${file}`])
      fail('contract_owner_MISSING', file);
}

function checkCrossCapability() {
  const allowed = new Set(ledger.crossCapability?.allowed ?? []);
  if (allowed.size !== 3 || !['(a)', '(b)', '(c)'].every((x) => allowed.has(x)))
    fail('cross_capability_disposition_set', [...allowed]);
  const reasons = ledger.crossCapability?.explanations ?? {};
  for (const disposition of ['(a)', '(b)', '(c)'])
    if (!reasons[disposition])
      fail('cross_capability_reason_missing', disposition);
  // At least one concrete cross-capability read is required; this prevents a vacuous ledger.
  const observed = [...(ledger.lockRows ?? [])].filter((x) =>
    allowed.has(x.disposition),
  );
  if (!observed.length && counts.crossCapability === 0)
    fail('cross_capability_empty', 'no concrete (a)/(b)/(c) ledger row');
  for (const row of ledger.sourceLockRows ?? []) {
    if (!allowed.has(row.disposition) || !row.reason)
      fail('source_lock_disposition_missing', `${row.file}:${row.line}`);
  }
  for (const [key, assertion] of Object.entries(
    ledger.crossCapabilityAssertions ?? {},
  )) {
    const [file, lineText] = key.split(':');
    const line = Number(lineText);
    const exact = ledger.callSites?.[file]?.find((row) => row.line === line);
    const typed = ledger.typedCrossCapability?.[key];
    const observed = exact?.disposition ? exact : typed;
    if (
      !observed ||
      observed.disposition !== assertion.disposition ||
      !assertion.reason
    )
      fail('cross_capability_assertion_MISMATCH', key);
  }
  const larkMemoryQueries = [
    '80',
    '306',
    '486',
    '703',
    '784',
    '895',
    '1271',
  ].map((line) => `postgres-lark-review-surface-repository.ts:${line}`);
  for (const key of larkMemoryQueries) {
    const query = ledger.typedCrossCapability?.[key];
    const lockRows = (ledger.sourceLockRows ?? []).filter(
      (row) =>
        row.file === 'postgres-lark-review-surface-repository.ts' &&
        row.disposition === '(c)',
    );
    if (!query || query.disposition !== '(c)' || !lockRows.length)
      fail('lark_memory_query_lock_disposition_MISMATCH', key);
  }
}

function checkTransactionFixtures() {
  const fixtures = {};
  const expected = [
    {
      name: 'lark-authorize-card-action-ingress-update',
      file: 'postgres-lark-review-surface-repository.ts',
      className: 'PostgresLarkReviewSurfaceRepository',
      functionName: 'authorizeCardAction',
      queryOrdinal: 4,
      receiver: 'database',
      sql: /SELECT .*FROM channel_ingress_events .*lease_expires_at > now\(\).*FOR UPDATE/i,
      tables: ['channel_ingress_events'],
      lock: 'for_update',
    },
    {
      name: 'lark-authorize-card-action-ingress-share',
      file: 'postgres-lark-review-surface-repository.ts',
      className: 'PostgresLarkReviewSurfaceRepository',
      functionName: 'authorizeCardAction',
      queryOrdinal: 5,
      receiver: 'database',
      sql: /SELECT .*FROM channel_ingress_events .*FOR SHARE/i,
      tables: ['channel_ingress_events'],
      lock: 'for_share',
    },
    {
      name: 'channel-binding-for-update',
      file: 'postgres-channel-repository.ts',
      className: 'PostgresChannelRepository',
      functionName: 'resolveBindingWithSession',
      queryOrdinal: 2,
      receiver: 'database',
      sql: /SELECT .*FROM channel_conversation_bindings .*FOR UPDATE/i,
      tables: ['channel_conversation_bindings'],
      lock: 'for_update',
    },
    {
      name: 'channel-session-for-share',
      file: 'postgres-channel-repository.ts',
      className: 'PostgresChannelRepository',
      functionName: 'resolveBindingWithSession',
      queryOrdinal: 3,
      receiver: 'database',
      sql: /SELECT id FROM product_sessions .*FOR SHARE/i,
      tables: ['product_sessions'],
      lock: 'for_share',
    },
    // The dispatch names the repository PostgresCollaborativeTeamRepository, but the
    // authoritative source declaration is PostgresTeamExecutionRepository. Keep the
    // source class in the semantic key and expose the declared name as evidence.
    {
      name: 'collaborative-recovery-child-update',
      file: 'postgres-collaborative-team-repository.ts',
      className: 'PostgresTeamExecutionRepository',
      declaredClassName: 'PostgresCollaborativeTeamRepository',
      functionName: 'recoverExpiredTeamRuns',
      queryOrdinal: 5,
      receiver: 'client',
      sql: /UPDATE runs .*RETURNING id,task_id/i,
      tables: ['runs', 'tasks'],
      lock: 'none',
    },
    {
      name: 'collaborative-recovery-sibling-update',
      file: 'postgres-collaborative-team-repository.ts',
      className: 'PostgresTeamExecutionRepository',
      declaredClassName: 'PostgresCollaborativeTeamRepository',
      functionName: 'recoverExpiredTeamRuns',
      queryOrdinal: 7,
      receiver: 'client',
      sql: /UPDATE runs .*RETURNING id,task_id/i,
      tables: ['runs', 'tasks', 'team_runs'],
      lock: 'none',
    },
  ];
  const fixtureResults = [];
  for (const fixture of expected) {
    const entry = astRepositoryFacts.find((item) => item.file === fixture.file);
    const call = entry?.calls.find(
      (item) =>
        item.className === fixture.className &&
        item.functionName === fixture.functionName &&
        item.queryOrdinal === fixture.queryOrdinal,
    );
    const normalizedSql = call?.normalizedSql ?? '';
    const tables = referencedTables(normalizedSql);
    const lock = /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i.test(normalizedSql)
      ? 'for_update'
      : /\bFOR\s+SHARE\b/i.test(normalizedSql)
        ? 'for_share'
        : 'none';
    const result = {
      name: fixture.name,
      identity: call?.transactionEvidence ?? null,
      line: call?.line ?? null,
      derived: call?.transaction ?? null,
      expected: 'TREAT_AS_IN',
      receiver: call?.receiver ?? null,
      normalizedSql,
      tables,
      lock,
      declaredClassName: fixture.declaredClassName ?? fixture.className,
      sourceClassName: call?.className ?? null,
      classNameMismatch: Boolean(
        fixture.declaredClassName &&
        fixture.declaredClassName !== call?.className,
      ),
      semanticMatch: Boolean(
        call &&
        call.receiver === fixture.receiver &&
        fixture.sql.test(normalizedSql) &&
        JSON.stringify(tables) === JSON.stringify(fixture.tables) &&
        lock === fixture.lock,
      ),
    };
    fixtureResults.push(result);
    if (!result.semanticMatch)
      fail('fixture_semantic_identity_MISSING', result);
    else if (result.derived !== 'TREAT_AS_IN')
      fail('fixture_derived_DEFINITELY_OUT', result);
  }
  fixtures.exact = fixtureResults;
  const allCalls = astRepositoryFacts.flatMap((entry) => entry.calls);
  fixtures.counts = {
    raw: {
      DEFINITELY_OUT: counts.rawDefinitelyOut,
      TREAT_AS_IN: counts.rawTreatAsIn,
      total: counts.rawQueryCallSites,
    },
    typed: {
      DEFINITELY_OUT: counts.typedDefinitelyOut,
      TREAT_AS_IN: counts.typedTreatAsIn,
      total: counts.typedQueryCallSites,
    },
    allAst: {
      DEFINITELY_OUT: allCalls.filter(
        (call) => call.transaction === 'DEFINITELY_OUT',
      ).length,
      TREAT_AS_IN: allCalls.filter((call) => call.transaction === 'TREAT_AS_IN')
        .length,
      total: allCalls.length,
    },
  };
  const rawOut = astRepositoryFacts
    .flatMap((entry) => entry.calls)
    .filter((call) => !call.typed && call.transaction === 'DEFINITELY_OUT');
  fixtures.rawDefinitelyOutByRepository = Object.fromEntries(
    [...new Set(rawOut.map((call) => call.file))].sort().map((file) => [
      file,
      rawOut
        .filter((call) => call.file === file)
        .map((call) => ({
          line: call.line,
          identity: call.transactionEvidence,
        })),
    ]),
  );
  const repositoryOwners = new Map(
    Object.entries(ledger.repositories ?? {}).map(([file, owner]) => [
      path.basename(file),
      owner,
    ]),
  );
  const ownerGroups = new Map();
  for (const call of rawOut) {
    const owner = repositoryOwners.get(call.file) ?? 'UNMAPPED';
    if (!ownerGroups.has(owner)) ownerGroups.set(owner, []);
    ownerGroups.get(owner).push({
      file: call.file,
      line: call.line,
      identity: call.transactionEvidence,
    });
  }
  fixtures.rawDefinitelyOutByRepositoryOwner = Object.fromEntries(
    [...ownerGroups.keys()]
      .sort()
      .map((owner) => [owner, ownerGroups.get(owner)]),
  );
  fixtures.rawDefinitelyOutWork = rawOut
    .filter((call) => repositoryOwners.get(call.file) === 'Work')
    .map((call) => ({
      file: call.file,
      line: call.line,
      identity: call.transactionEvidence,
    }));
  fixtures.rawDefinitelyOutWorkCount = fixtures.rawDefinitelyOutWork.length;
  fixtures.currentLedgerDisagreements = transactionLedgerDisagreements;
  if (
    ledger.transactionTruthSource ||
    ledger.transactionTruth ||
    ledger.typedTransactionTruth
  )
    fail('manual_transaction_truth_source_MUST_REMOVE', {
      transactionTruthSource: Boolean(ledger.transactionTruthSource),
      transactionTruth: Boolean(ledger.transactionTruth),
      typedTransactionTruth: Boolean(ledger.typedTransactionTruth),
    });
  return fixtures;
}

checkRepositories();
checkDdl();
checkPorts();
checkContracts();
checkCrossCapability();
const fixtureMarkers = checkTransactionFixtures();
const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
}).stdout.trim();
const result = {
  ok: failures.length === 0,
  candidate: process.env.OWNERSHIP_CANDIDATE_SHA ?? gitSha,
  compilerIdentity,
  fixtureMarkers,
  counts,
  transactionLedgerDisagreements,
  truthSourceDiffs: { ddl: ddlTruthSourceDiffs, query: queryTruthSourceDiffs },
  failures,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = failures.length ? 2 : 0;
