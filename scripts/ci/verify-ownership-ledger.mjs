#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../..');
const ledgerPath = process.env.OWNERSHIP_LEDGER ?? path.join(here, 'ownership-ledger.json');
const sourceRoot = process.env.OWNERSHIP_SOURCE_ROOT ?? repo;

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const failures = [];
const counts = { repositories: 0, rawQueryCallSites: 0, classifiedCallSites: 0, missingCallSites: 0, ddlTables: 0, ledgerTables: Object.keys(ledger.tables ?? {}).length, ports: 0, contracts: 0, crossCapability: 0 };
const queryTruthSourceDiffs = [];
const ddlTruthSourceDiffs = [];
const classifiedRuntimeTables = new Set();

function fail(code, detail) { failures.push({ code, detail }); }
function read(file) { return fs.readFileSync(path.join(sourceRoot, file), 'utf8'); }
function rel(p) { return path.relative(sourceRoot, p).split(path.sep).join('/'); }
function lineAt(s, index) { return s.slice(0, index).split('\n').length; }

function matchingParen(s, start) {
  let depth = 0; let quote = null;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === quote) {
        if (quote === "'" && s[i + 1] === "'") { i += 1; continue; }
        quote = null;
      } else if (quote === '`' && c === '\\') i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

function literalSql(argument) {
  const a = argument.trim();
  if (a.startsWith("'")) {
    let out = '';
    for (let i = 1; i < a.length; i += 1) {
      if (a[i] === "'" && a[i + 1] === "'") { out += "'"; i += 1; continue; }
      if (a[i] === "'") return out;
      out += a[i];
    }
    return null;
  }
  if (a.startsWith('`') && !a.includes('${')) return a.slice(1, a.lastIndexOf('`'));
  return null;
}

function referencedTables(sql) {
  const names = new Set();
  for (const match of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM|USING)\s+(?:ONLY\s+)?(?:[A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)/gi)) {
    if (Object.hasOwn(ledger.tables ?? {}, match[1])) names.add(match[1]);
  }
  return [...names].sort();
}

function scanCalls(file) {
  const source = read(file); const calls = []; let transactionState = 'out';
  for (const match of source.matchAll(/\.query\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchingParen(source, open);
    const argument = close < 0 ? '' : source.slice(open + 1, close);
    const sql = literalSql(argument);
    const parsedOperation = sql?.trim().match(/^(SELECT|INSERT|UPDATE|DELETE|WITH|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i)?.[1].toUpperCase() ?? (sql ? 'OTHER' : 'MISSING');
    const operation = parsedOperation === 'BEGIN' ? 'BEGIN' : ['COMMIT', 'ROLLBACK'].includes(parsedOperation) ? 'CONTROL' : parsedOperation === 'SELECT' ? 'READ' : ['INSERT', 'UPDATE', 'DELETE', 'WITH'].includes(parsedOperation) ? 'WRITE' : (sql ? 'UNKNOWN' : 'MISSING');
    const lock = sql ? (/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i.test(sql) ? 'for_update' : /\bFOR\s+SHARE\b/i.test(sql) ? 'for_share' : 'none') : 'unknown';
    const readWrite = sql ? (parsedOperation === 'SELECT' ? 'read' : ['INSERT', 'UPDATE', 'DELETE'].includes(parsedOperation) ? 'write' : 'control') : 'unknown';
    const transaction = parsedOperation === 'BEGIN' ? 'in' : ['COMMIT', 'ROLLBACK'].includes(parsedOperation) ? 'out' : transactionState;
    if (parsedOperation === 'BEGIN') transactionState = 'in';
    else if (['COMMIT', 'ROLLBACK'].includes(parsedOperation)) transactionState = 'out';
    const tables = sql ? referencedTables(sql) : [];
    calls.push({ file: path.basename(file), line: lineAt(source, match.index), classification: sql ? 'classified' : 'MISSING', operation, readWrite, lock, transaction, tables });
  }
  return calls;
}

function scanSourceLocks(file) {
  const basename = path.basename(file); const source = read(`src/infrastructure/postgres/${basename}`); const rows = [];
  source.split('\n').forEach((line, index) => {
    const match = line.match(/\bFOR\s+(NO\s+KEY\s+UPDATE|UPDATE|SHARE)\b/i);
    if (match) rows.push({ file: basename, line: index + 1, lock: match[1].toLowerCase().startsWith('share') ? 'for_share' : 'for_update' });
  });
  return rows;
}

function migrationTables() {
  const dir = path.join(sourceRoot, 'src/infrastructure/postgres/migrations'); const result = [];
  for (const file of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)/gi)) result.push({ table: match[1], migration: file });
  }
  return result;
}

function checkRepositories() {
  const dir = path.join(sourceRoot, 'src/infrastructure/postgres');
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts')).sort();
  const ledgerFiles = Object.keys(ledger.repositories ?? {}).map((x) => path.basename(x)).sort();
  if (JSON.stringify(files) !== JSON.stringify(ledgerFiles)) fail('repository_ledger_files', { files, ledgerFiles });
  const lockRows = new Set((ledger.sourceLockRows ?? ledger.lockRows ?? []).map((x) => `${x.file}:${x.line}`));
  for (const file of files) {
    const calls = scanCalls(`src/infrastructure/postgres/${file}`); counts.repositories += 1; counts.rawQueryCallSites += calls.length;
    const expected = ledger.repositories[file];
    if (typeof expected !== 'string') { fail('repository_owner_missing', file); continue; }
    const ledgerCalls = ledger.callSites?.[file] ?? [];
    const ledgerByLine = new Map(ledgerCalls.map((row) => [row.line, row]));
    let fileClassified = 0; let fileMissing = 0;
    if (ledgerCalls.length !== calls.length) queryTruthSourceDiffs.push({ file, raw: calls.length, classified: null, missing: null, ledger: ledgerCalls.length });
    for (const call of calls) {
      const key = `${path.basename(file)}:${call.line}`;
      const row = ledgerByLine.get(call.line);
      if (!row) { fail('call_site_ledger_MISSING', key); continue; }
      const override = ledger.overrides?.[key];
      if (override && call.classification !== 'MISSING') fail('override_not_dynamic_source', key);
      if (override && (!override.sourceKind || !override.confidence || !override.evidence)) fail('override_metadata_missing', key);
      const actual = override ? { ...call, ...override, file, line: call.line } : call;
      actual.owner = ledger.repositories[path.basename(file)];
      if (actual.classification === 'classified') { counts.classifiedCallSites += 1; fileClassified += 1; for (const table of actual.tables) classifiedRuntimeTables.add(table); } else { counts.missingCallSites += 1; fileMissing += 1; }
      if (!row.owner) fail('call_site_owner_MISSING', key);
      if (row.owner !== actual.owner) fail('call_site_owner_drift', { key, ledger: row.owner, actual: actual.owner });
      if (actual.transaction === 'unknown') fail('call_site_transaction_unknown', key);
      for (const field of ['file', 'line', 'classification', 'operation', 'readWrite', 'lock', 'transaction', 'tables', 'owner']) if (JSON.stringify(row[field]) !== JSON.stringify(actual[field])) fail('call_site_field_drift', { key, field, ledger: row[field], actual: actual[field] });
      const owners = new Set(actual.tables.map((table) => typeof ledger.tables[table] === 'string' ? ledger.tables[table] : ledger.tables[table]?.owner));
      const repositoryOwner = ledger.repositories[path.basename(file)];
      const crossesCapability = [...owners].some((owner) => owner && owner !== repositoryOwner);
      if (actual.classification === 'classified' && crossesCapability) {
        counts.crossCapability += 1;
        if (!['(a)', '(b)', '(c)'].includes(row.disposition)) fail('cross_capability_disposition_MISSING', key);
        if (!row.reason || !ledger.crossCapability?.explanations?.[row.disposition]) fail('cross_capability_reason_missing', key);
      } else if (row.disposition !== null) fail('cross_capability_spurious_disposition', key);
    }
    if (fileClassified + fileMissing !== calls.length || fileClassified !== calls.length) queryTruthSourceDiffs.push({ file, raw: calls.length, classified: fileClassified, missing: fileMissing, ledger: ledgerCalls.length });
    for (const lock of scanSourceLocks(file)) if (!lockRows.has(`${lock.file}:${lock.line}`)) fail('source_lock_row_missing', `${lock.file}:${lock.line}`);
  }
  const ledgerCalls = counts.classifiedCallSites + counts.missingCallSites;
  if (ledgerCalls !== counts.rawQueryCallSites) fail('query_call_site_reconciliation', { raw: counts.rawQueryCallSites, classified: ledgerCalls });
  if (queryTruthSourceDiffs.length) fail('query_truth_source_diff', queryTruthSourceDiffs);
  if (counts.missingCallSites) fail('query_call_site_unclassified_MISSING', { actual: counts.missingCallSites });
}

function checkDdl() {
  const ddl = migrationTables(); counts.ddlTables = ddl.length;
  const missing = ddl.filter(({ table }) => !Object.hasOwn(ledger.tables ?? {}, table));
  const malformed = Object.entries(ledger.tables ?? {}).filter(([, entry]) => !entry || typeof entry !== 'object' || !entry.owner);
  if (missing.length) fail('ddl_table_MISSING', missing);
  const ddlNames = new Set(ddl.map(({ table }) => table));
  for (const [table, entry] of Object.entries(ledger.tables ?? {})) if (!ddlNames.has(table) && entry.runtimeAccess !== 'runtime-created') ddlTruthSourceDiffs.push({ table, reason: 'ledger extra lacks runtime-created source' });
  if (malformed.length) fail('table_owner_missing', malformed.map(([table]) => table));
  for (const [table, entry] of Object.entries(ledger.tables ?? {})) {
    if (!Object.hasOwn(entry, 'runtimeAccess')) fail('table_runtime_access_MISSING', table);
    if (!Object.hasOwn(entry, 'noRuntimeAccess')) fail('table_no_runtime_access_MISSING', table);
    if (entry.noRuntimeAccess && !entry.reason) fail('no_runtime_access_reason_missing', table);
  }
  for (const { table } of ddl) {
    const entry = ledger.tables[table];
    if (entry?.runtimeAccess === 'ledgered' && !entry.noRuntimeAccess && !classifiedRuntimeTables.has(table)) fail('ddl_runtime_support_MISSING', table);
    if (entry?.noRuntimeAccess && classifiedRuntimeTables.has(table)) fail('no_runtime_access_has_runtime_caller', table);
  }
  if (ddl.length !== 53) fail('ddl_truth_source_count', { expected: 53, actual: ddl.length });
}

function checkPorts() {
  const dir = path.join(sourceRoot, 'src/application/ports');
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.ts')).sort(); counts.ports = files.length;
  const got = Object.keys(ledger.ports ?? {}).sort();
  if (files.length !== 28) fail('port_truth_source_count', { expected: 28, actual: files.length });
  if (JSON.stringify(files) !== JSON.stringify(got)) fail('port_owner_coverage', { files, got });
  for (const file of files) if (!ledger.ports[file]) fail('port_owner_MISSING', file);
  if (ledger.ports['run-dispatcher.ts'] !== 'Execution') fail('run_dispatcher_owner', ledger.ports['run-dispatcher.ts']);
}

function checkContracts() {
  const dir = path.join(sourceRoot, 'src/contracts'); const files = [];
  function walk(current, prefix = '') { for (const name of fs.readdirSync(current).sort()) { const full = path.join(current, name); const r = prefix ? `${prefix}/${name}` : name; if (fs.statSync(full).isDirectory()) walk(full, r); else if ((name.endsWith('.ts') || name.endsWith('.json')) && !name.endsWith('.test.ts')) files.push(r); } }
  walk(dir); counts.contracts = files.length;
  const got = Object.keys(ledger.contracts ?? {}).sort();
  const expected = files.sort();
  if (JSON.stringify(expected) !== JSON.stringify(got)) fail('contract_owner_coverage', { expected, got });
  for (const file of expected) if (!ledger.contracts[file] && !ledger.contracts[`src/contracts/${file}`]) fail('contract_owner_MISSING', file);
}

function checkCrossCapability() {
  const allowed = new Set(ledger.crossCapability?.allowed ?? []);
  if (allowed.size !== 3 || !['(a)', '(b)', '(c)'].every((x) => allowed.has(x))) fail('cross_capability_disposition_set', [...allowed]);
  const reasons = ledger.crossCapability?.explanations ?? {};
  for (const disposition of ['(a)', '(b)', '(c)']) if (!reasons[disposition]) fail('cross_capability_reason_missing', disposition);
  // At least one concrete cross-capability read is required; this prevents a vacuous ledger.
  const observed = [...(ledger.lockRows ?? [])].filter((x) => allowed.has(x.disposition));
  if (!observed.length && counts.crossCapability === 0) fail('cross_capability_empty', 'no concrete (a)/(b)/(c) ledger row');
  for (const row of ledger.sourceLockRows ?? []) {
    if (!allowed.has(row.disposition) || !row.reason) fail('source_lock_disposition_missing', `${row.file}:${row.line}`);
  }
}

checkRepositories(); checkDdl(); checkPorts(); checkContracts(); checkCrossCapability();
const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
const result = { ok: failures.length === 0, candidate: process.env.OWNERSHIP_CANDIDATE_SHA ?? gitSha, counts, truthSourceDiffs: { ddl: ddlTruthSourceDiffs, query: queryTruthSourceDiffs }, failures };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = failures.length ? 2 : 0;
