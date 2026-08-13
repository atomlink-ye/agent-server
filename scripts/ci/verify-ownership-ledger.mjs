#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../..');
const ledgerPath = process.env.OWNERSHIP_LEDGER ?? path.join(here, 'ownership-ledger.json');
const sourceRoot = process.env.OWNERSHIP_SOURCE_ROOT ?? repo;

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const failures = [];
const counts = { repositories: 0, rawQueryCallSites: 0, classifiedCallSites: 0, missingCallSites: 0, ddlTables: 0, ledgerTables: Object.keys(ledger.tables ?? {}).length, ports: 0, contracts: 0, crossCapability: 0 };
const queryTruthSourceDiffs = [];

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
  return [...names];
}

function scanCalls(file) {
  const source = read(file); const calls = [];
  for (const match of source.matchAll(/\.query\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchingParen(source, open);
    const argument = close < 0 ? '' : source.slice(open + 1, close);
    const sql = literalSql(argument);
    const operation = sql?.trim().match(/^(SELECT|INSERT|UPDATE|DELETE|WITH|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i)?.[1].toUpperCase() ?? (sql ? 'OTHER' : 'MISSING');
    const lock = sql && /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i.test(sql) ? 'for_update' : 'none';
    calls.push({ line: lineAt(source, match.index), classification: sql ? 'classified' : 'MISSING', operation, lock, tables: sql ? referencedTables(sql) : [] });
  }
  return calls;
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
  const lockRows = new Set((ledger.lockRows ?? []).map((x) => `${x.file}:${x.line}`));
  for (const file of files) {
    const calls = scanCalls(`src/infrastructure/postgres/${file}`); counts.repositories += 1; counts.rawQueryCallSites += calls.length;
    const expected = ledger.repositories[file];
    if (typeof expected !== 'string') { fail('repository_owner_missing', file); continue; }
    if (calls.length !== ledger.callSiteCounts?.[file]) queryTruthSourceDiffs.push({ file, expected: ledger.callSiteCounts?.[file], actual: calls.length });
    // The ledger's compact callSitePolicy expands to one R/W/lock/transaction row per call.
    for (const call of calls) {
      if (call.classification === 'classified') counts.classifiedCallSites += 1; else counts.missingCallSites += 1;
      const key = `${file}:${call.line}`;
      if (call.lock === 'for_update' && !lockRows.has(key)) fail('lock_row_missing', key);
      const owners = new Set(call.tables.map((table) => ledger.tables[table]));
      if (call.classification === 'classified' && owners.size > 1) {
        const disposition = call.operation === 'SELECT' ? '(a)' : '(c)';
        counts.crossCapability += 1;
        if (!ledger.crossCapability?.allowed?.includes(disposition)) fail('cross_capability_disposition_MISSING', key);
        if (!ledger.crossCapability?.explanations?.[disposition]) fail('cross_capability_reason_missing', key);
      }
    }
  }
  const ledgerCalls = counts.classifiedCallSites + counts.missingCallSites;
  if (ledgerCalls !== counts.rawQueryCallSites) fail('query_call_site_reconciliation', { raw: counts.rawQueryCallSites, classified: ledgerCalls });
  if (queryTruthSourceDiffs.length) fail('query_truth_source_diff', queryTruthSourceDiffs);
  const knownMissing = ledger.callSiteScan?.knownMissingCallSiteCount;
  if (typeof knownMissing !== 'number' || counts.missingCallSites > knownMissing) fail('query_call_site_unclassified_MISSING', { knownMissing, actual: counts.missingCallSites });
}

function checkDdl() {
  const ddl = migrationTables(); counts.ddlTables = ddl.length;
  const missing = ddl.filter(({ table }) => !Object.hasOwn(ledger.tables ?? {}, table));
  const malformed = Object.entries(ledger.tables ?? {}).filter(([, owner]) => typeof owner !== 'string' || !owner);
  if (missing.length) fail('ddl_table_MISSING', missing);
  if (malformed.length) fail('table_owner_missing', malformed.map(([table]) => table));
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
}

checkRepositories(); checkDdl(); checkPorts(); checkContracts(); checkCrossCapability();
const result = { ok: failures.length === 0, candidate: process.env.OWNERSHIP_CANDIDATE_SHA ?? 'unmeasured', counts, truthSourceDiffs: { ddl: counts.ddlTables === counts.ledgerTables ? [] : ['table-count'], query: queryTruthSourceDiffs }, failures };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = failures.length ? 2 : 0;
