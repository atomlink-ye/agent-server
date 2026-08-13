#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const verifier = path.join(repo, 'scripts/ci/verify-ownership-ledger.mjs');
const ledger = path.join(repo, 'scripts/ci/ownership-ledger.json');
const candidateSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
const hashes = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs = { ledger: hashes(ledger), verifier: hashes(verifier) };
const canonicalEvidenceInput = process.env.OWNERSHIP_CANONICAL_EVIDENCE_INPUT;
function treeHash(root) {
  const files = [];
  function walk(current) { for (const name of fs.readdirSync(current).sort()) { const full = path.join(current, name); const stat = fs.lstatSync(full); if (stat.isSymbolicLink()) continue; if (stat.isDirectory()) walk(full); else files.push(path.relative(root, full)); } }
  for (const relative of ['src/infrastructure/postgres', 'src/application/ports', 'src/contracts']) walk(path.join(root, relative));
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  return hash.digest('hex');
}

function invoke(sourceRoot = repo, ledgerPath = ledger) {
  const env = { OWNERSHIP_SOURCE_ROOT: sourceRoot, OWNERSHIP_LEDGER: ledgerPath, OWNERSHIP_CANDIDATE_SHA: candidateSha };
  const result = spawnSync(process.execPath, [verifier], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { exitCode: result.status ?? 1, exactCommand: `${Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ')} ${process.execPath} ${verifier}`, cwd: repo, inputHashes: { ledger: hashes(ledgerPath), verifier: hashes(verifier), sourceTree: treeHash(sourceRoot) }, stdout: result.stdout, stderr: result.stderr };
}

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-ledger-'));
  fs.cpSync(path.join(repo, 'src/infrastructure/postgres'), path.join(dir, 'src/infrastructure/postgres'), { recursive: true });
  fs.cpSync(path.join(repo, 'src/application/ports'), path.join(dir, 'src/application/ports'), { recursive: true });
  fs.cpSync(path.join(repo, 'src/contracts'), path.join(dir, 'src/contracts'), { recursive: true });
  const ledgerPath = path.join(dir, 'ownership-ledger.json'); fs.copyFileSync(ledger, ledgerPath);
  return { dir, ledgerPath };
}

const arms = [];
const baseline = invoke();
arms.push({ name: 'baseline', ...baseline, expectedNonzero: false, requiredFailureCodes: [] });

{
  const h = fresh(); const value = JSON.parse(fs.readFileSync(h.ledgerPath, 'utf8')); const target = (row) => row.file === 'postgres-workspace-memory-repository.ts' && row.line === 289; value.lockRows = value.lockRows.filter((row) => !target(row)); value.sourceLockRows = value.sourceLockRows.filter((row) => !target(row)); fs.writeFileSync(h.ledgerPath, JSON.stringify(value));
  const run = invoke(h.dir, h.ledgerPath); arms.push({ name: 'remove-known-bidirectional-for-update-row', ...run, expectedNonzero: true, requiredFailureCodes: ['source_lock_row_missing'], inputHashes: { ...run.inputHashes, mutatedLedger: hashes(h.ledgerPath) } });
}
{
  const h = fresh(); const value = JSON.parse(fs.readFileSync(h.ledgerPath, 'utf8')); value.transactionTruth['postgres-collaborative-team-repository.ts:628'] = 'out'; fs.writeFileSync(h.ledgerPath, JSON.stringify(value));
  const run = invoke(h.dir, h.ledgerPath); arms.push({ name: 'change-independent-transaction-truth', ...run, expectedNonzero: true, requiredFailureCodes: ['transaction_truth_MISMATCH'], inputHashes: { ...run.inputHashes, mutatedLedger: hashes(h.ledgerPath) } });
}
{
  const h = fresh(); const value = JSON.parse(fs.readFileSync(h.ledgerPath, 'utf8')); value.typedCallTruth['postgres-invokable-repository.ts:545'].sourceExcerptHash = 'typed-fact-red-arm'; fs.writeFileSync(h.ledgerPath, JSON.stringify(value));
  const run = invoke(h.dir, h.ledgerPath); arms.push({ name: 'change-typed-query-fact', ...run, expectedNonzero: true, requiredFailureCodes: ['typed_call_truth_evidence_MISMATCH'], inputHashes: { ...run.inputHashes, mutatedLedger: hashes(h.ledgerPath) } });
}
{
  const h = fresh(); const value = JSON.parse(fs.readFileSync(h.ledgerPath, 'utf8')); value.typedQueryFacts['postgres-lark-review-surface-repository.ts:80'].transaction = 'out'; fs.writeFileSync(h.ledgerPath, JSON.stringify(value));
  const run = invoke(h.dir, h.ledgerPath); arms.push({ name: 'change-independent-typed-transaction-truth', ...run, expectedNonzero: true, requiredFailureCodes: ['typed_transaction_truth_MISMATCH'], inputHashes: { ...run.inputHashes, mutatedLedger: hashes(h.ledgerPath) } });
}
{
  const h = fresh(); const value = JSON.parse(fs.readFileSync(h.ledgerPath, 'utf8')); delete value.ports['run-dispatcher.ts']; fs.writeFileSync(h.ledgerPath, JSON.stringify(value));
  const run = invoke(h.dir, h.ledgerPath); arms.push({ name: 'leave-port-ownerless', ...run, expectedNonzero: true, requiredFailureCodes: ['port_owner_MISSING', 'run_dispatcher_owner'], inputHashes: { ...run.inputHashes, mutatedLedger: hashes(h.ledgerPath) } });
}
{
  const h = fresh(); fs.writeFileSync(path.join(h.dir, 'src/infrastructure/postgres/migrations/9999_red_arm.sql'), 'CREATE TABLE red_arm_missing (id uuid);\n');
  const run = invoke(h.dir, h.ledgerPath); arms.push({ name: 'add-unledgered-create-table', ...run, expectedNonzero: true, requiredFailureCodes: ['ddl_table_MISSING'], inputHashes: { ...run.inputHashes, mutatedMigration: hashes(path.join(h.dir, 'src/infrastructure/postgres/migrations/9999_red_arm.sql')) } });
}
{
  const h = fresh(); const file = path.join(h.dir, 'src/infrastructure/postgres/postgres-session-repository.ts'); let source = fs.readFileSync(file, 'utf8');
  const needle = 'const s = await c.query(\n        `SELECT s.*, l.generation';
  if (!source.includes(needle)) throw new Error('red-arm literal query fixture missing');
  source = source.replace(needle, 'const s = await c.query(\n        dynamicSql /* SELECT s.*, l.generation');
  fs.writeFileSync(file, source);
  const run = invoke(h.dir, h.ledgerPath); arms.push({ name: 'convert-literal-query-to-variable-sql', ...run, expectedNonzero: true, requiredFailureCodes: ['query_truth_source_diff', 'query_call_site_unclassified_MISSING'], inputHashes: { ...run.inputHashes, mutatedSource: hashes(file) } });
}

for (const arm of arms) {
  let observedFailureCodes = [];
  try { observedFailureCodes = JSON.parse(arm.stdout).failures.map((failure) => failure.code); } catch { observedFailureCodes = ['harness_output_unparseable']; }
  arm.observedFailureCodes = observedFailureCodes;
  arm.failureCodeAssertion = (arm.requiredFailureCodes ?? []).every((code) => observedFailureCodes.includes(code));
}
const result = { schema: 'ownership-ledger-harness.v1', candidateSha, inputs, arms, ok: arms.every((arm) => (arm.exitCode !== 0) === arm.expectedNonzero && arm.failureCodeAssertion) };
if (canonicalEvidenceInput) result.canonical = JSON.parse(fs.readFileSync(canonicalEvidenceInput, 'utf8'));
if (process.env.OWNERSHIP_REQUIRE_CANONICAL === '1') {
  const canonical = result.canonical;
  const expectedLedgerHash = inputs.ledger; const expectedVerifierHash = inputs.verifier;
  if (!canonical || canonical.candidateSha !== candidateSha || canonical.exitCode !== 0 || !canonical.exactCommand || !canonical.exactCommand.includes('pnpm') || canonical.inputHashes?.ledger !== expectedLedgerHash || canonical.inputHashes?.verifier !== expectedVerifierHash) result.ok = false;
}
if (process.env.OWNERSHIP_EVIDENCE_PATH) fs.writeFileSync(process.env.OWNERSHIP_EVIDENCE_PATH, `${JSON.stringify(result)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.ok ? 0 : 2;
