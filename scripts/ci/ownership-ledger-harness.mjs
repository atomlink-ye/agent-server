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

function invoke(sourceRoot = repo, ledgerPath = ledger) {
  const result = spawnSync(process.execPath, [verifier], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, OWNERSHIP_SOURCE_ROOT: sourceRoot, OWNERSHIP_LEDGER: ledgerPath, OWNERSHIP_CANDIDATE_SHA: candidateSha },
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
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
arms.push({ name: 'baseline', ...baseline, expectedNonzero: false });

{
  const h = fresh(); const value = JSON.parse(fs.readFileSync(h.ledgerPath, 'utf8')); value.lockRows.pop(); fs.writeFileSync(h.ledgerPath, JSON.stringify(value));
  arms.push({ name: 'remove-known-bidirectional-for-update-row', ...invoke(h.dir, h.ledgerPath), expectedNonzero: true, inputHashes: { ledger: hashes(h.ledgerPath) } });
}
{
  const h = fresh(); const value = JSON.parse(fs.readFileSync(h.ledgerPath, 'utf8')); delete value.ports['run-dispatcher.ts']; fs.writeFileSync(h.ledgerPath, JSON.stringify(value));
  arms.push({ name: 'leave-port-ownerless', ...invoke(h.dir, h.ledgerPath), expectedNonzero: true, inputHashes: { ledger: hashes(h.ledgerPath) } });
}
{
  const h = fresh(); fs.writeFileSync(path.join(h.dir, 'src/infrastructure/postgres/migrations/9999_red_arm.sql'), 'CREATE TABLE red_arm_missing (id uuid);\n');
  arms.push({ name: 'add-unledgered-create-table', ...invoke(h.dir, h.ledgerPath), expectedNonzero: true, inputHashes: { migration: hashes(path.join(h.dir, 'src/infrastructure/postgres/migrations/9999_red_arm.sql')), ledger: hashes(h.ledgerPath) } });
}
{
  const h = fresh(); const file = path.join(h.dir, 'src/infrastructure/postgres/postgres-session-repository.ts'); let source = fs.readFileSync(file, 'utf8');
  const needle = 'const s = await c.query(\n        `SELECT s.*, l.generation';
  if (!source.includes(needle)) throw new Error('red-arm literal query fixture missing');
  source = source.replace(needle, 'const dynamicSql = `SELECT s.*, l.generation`;\n      const s = await c.query(dynamicSql);\n      /* red arm */\n      /*');
  fs.writeFileSync(file, source);
  arms.push({ name: 'convert-literal-query-to-variable-sql', ...invoke(h.dir, h.ledgerPath), expectedNonzero: true, inputHashes: { source: hashes(file), ledger: hashes(h.ledgerPath) } });
}

const result = { schema: 'ownership-ledger-harness.v1', candidateSha, inputs, arms, ok: arms.every((arm) => arm.exitCode !== 0 === arm.expectedNonzero) };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.ok ? 0 : 2;
