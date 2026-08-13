#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  deriveTransactions,
  semanticIdentity,
} from './transaction-ast-helper.mjs';

const repo = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const verifier = path.join(repo, 'scripts/ci/verify-ownership-ledger.mjs');
const ledger = path.join(repo, 'scripts/ci/ownership-ledger.json');
const candidateSha =
  process.env.OWNERSHIP_CANDIDATE_SHA ??
  spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).stdout.trim();
const hashes = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs = { ledger: hashes(ledger), verifier: hashes(verifier) };

function treeHash(root) {
  const files = [];
  function walk(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(full);
      else files.push(path.relative(root, full));
    }
  }
  for (const relative of [
    'src/infrastructure/postgres',
    'src/application/ports',
    'src/contracts',
  ])
    walk(path.join(root, relative));
  const hash = crypto.createHash('sha256');
  for (const file of files)
    hash
      .update(file)
      .update('\0')
      .update(fs.readFileSync(path.join(root, file)))
      .update('\0');
  return hash.digest('hex');
}

function invoke(sourceRoot = repo, ledgerPath = ledger) {
  const env = {
    OWNERSHIP_SOURCE_ROOT: sourceRoot,
    OWNERSHIP_LEDGER: ledgerPath,
    OWNERSHIP_CANDIDATE_SHA: candidateSha,
  };
  const result = spawnSync(process.execPath, [verifier], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? 1,
    exactCommand: `${Object.entries(env)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ')} ${process.execPath} ${verifier}`,
    cwd: repo,
    inputHashes: {
      ledger: hashes(ledgerPath),
      verifier: hashes(verifier),
      sourceTree: treeHash(sourceRoot),
    },
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-ledger-'));
  for (const relative of [
    'src/infrastructure/postgres',
    'src/application/ports',
    'src/contracts',
  ])
    fs.cpSync(path.join(repo, relative), path.join(dir, relative), {
      recursive: true,
    });
  const ledgerPath = path.join(dir, 'ownership-ledger.json');
  fs.copyFileSync(ledger, ledgerPath);
  return { dir, ledgerPath };
}

function parseResult(run) {
  try {
    return JSON.parse(run.stdout.trim());
  } catch {
    return { failures: [{ code: 'harness_output_unparseable' }] };
  }
}

const arms = [];
const baseline = invoke();
const baselineJson = parseResult(baseline);
arms.push({
  name: 'staged-red-current-ledger',
  ...baseline,
  expectedNonzero: true,
  requiredFailureCodes: [
    'ast_transaction_MISMATCH',
    'manual_transaction_truth_source_MUST_REMOVE',
  ],
  fixtureCounts: baselineJson.fixtureMarkers?.counts,
  fixtureResults: baselineJson.fixtureMarkers?.exact,
  ledgerDisagreementCount:
    baselineJson.transactionLedgerDisagreements?.length ?? 0,
});

// Mutation dual: choose a genuine source-proven DEFINITELY_OUT call by semantic
// identity. The mutation moves that exact AST statement into a real callback
// body; this is AST-positioned, not a line/regex/braces heuristic.
{
  const h = fresh();
  const candidates = [];
  for (const file of fs
    .readdirSync(path.join(h.dir, 'src/infrastructure/postgres'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()) {
    const source = fs.readFileSync(
      path.join(h.dir, 'src/infrastructure/postgres', file),
      'utf8',
    );
    const facts = deriveTransactions(source, file);
    candidates.push(
      ...facts.rawCalls
        .filter(
          (call) =>
            call.transaction === 'DEFINITELY_OUT' &&
            call.receiver === 'this.database' &&
            !call.inWithTransaction &&
            call.functionBodyStart !== null,
        )
        .map((call) => ({ file, source, call, sourceHash: facts.sourceHash })),
    );
  }
  const candidate = candidates[0];
  if (!candidate) {
    arms.push({
      name: 'mutation-dual',
      exitCode: 2,
      expectedNonzero: false,
      failureCodeAssertion: false,
      error: 'no semantic DEFINITELY_OUT candidate',
    });
  } else {
    const beforeHash = hashes(
      path.join(h.dir, 'src/infrastructure/postgres', candidate.file),
    );
    const statement = candidate.source.slice(
      candidate.call.statementStart,
      candidate.call.statementEnd,
    );
    const mutated = `${candidate.source.slice(0, candidate.call.statementStart)}await this.withTransaction(async () => {\n${statement}\n    });${candidate.source.slice(candidate.call.statementEnd)}`;
    const target = path.join(
      h.dir,
      'src/infrastructure/postgres',
      candidate.file,
    );
    fs.writeFileSync(target, mutated);
    const mutatedFacts = deriveTransactions(mutated, candidate.file);
    const mutatedSourceHash = hashes(target);
    const mutatedCall = mutatedFacts.calls.find(
      (call) =>
        call.receiver === candidate.call.receiver &&
        call.functionName === candidate.call.functionName &&
        call.normalizedSql === candidate.call.normalizedSql &&
        call.start >= candidate.call.statementStart,
    );
    const run = invoke(h.dir, h.ledgerPath);
    const parsed = parseResult(run);
    fs.writeFileSync(target, candidate.source);
    const restoredHash = hashes(target);
    arms.push({
      name: 'mutation-dual',
      ...run,
      expectedNonzero: true,
      requiredFailureCodes: ['ast_transaction_MISMATCH'],
      candidate: {
        file: candidate.file,
        semanticIdentity: semanticIdentity(candidate.call),
        before: candidate.call.transaction,
        beforeHash,
        mutated: mutatedCall?.transaction ?? null,
        mutatedSourceHash,
        restoredHash,
        sourceHashRestored: beforeHash === restoredHash,
        markers: {
          before: 'DEFINITELY_OUT',
          mutated: 'TREAT_AS_IN',
          unchangedLedgerRejected: true,
        },
      },
      observedFailureCodes:
        parsed.failures?.map((failure) => failure.code) ?? [],
    });
  }
}

for (const arm of arms) {
  const observed =
    arm.observedFailureCodes ??
    parseResult(arm).failures?.map((failure) => failure.code) ??
    [];
  arm.observedFailureCodes = [...new Set(observed)];
  arm.failureCodeAssertion = (arm.requiredFailureCodes ?? []).every((code) =>
    observed.includes(code),
  );
}
let residualProcessCount = -1;
let residualCompilerProcessStates = null;
try {
  residualCompilerProcessStates = { active: 0, zombie: 0 };
  for (const pid of fs
    .readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))) {
    try {
      if (
        !/^(tsc|tsserver)$/.test(
          fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(),
        )
      )
        continue;
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ', 1)[0];
      if (state === 'Z') residualCompilerProcessStates.zombie += 1;
      else residualCompilerProcessStates.active += 1;
    } catch {
      /* process may exit while /proc is inspected */
    }
  }
  residualProcessCount = residualCompilerProcessStates.active;
} catch {
  /* environments without /proc report unavailable rather than zero */
}
const result = {
  schema: 'ownership-ledger-harness.v2',
  candidateSha,
  inputs,
  compilerIdentity: baselineJson.compilerIdentity ?? null,
  residualProcessCount,
  residualCompilerProcessStates,
  arms,
  ok: arms.every(
    (arm) =>
      (arm.exitCode !== 0) === arm.expectedNonzero && arm.failureCodeAssertion,
  ),
};
if (process.env.OWNERSHIP_EVIDENCE_PATH)
  fs.writeFileSync(
    process.env.OWNERSHIP_EVIDENCE_PATH,
    `${JSON.stringify(result)}\n`,
  );
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.ok ? 0 : 2;
