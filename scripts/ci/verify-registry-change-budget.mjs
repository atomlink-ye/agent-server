#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const BASELINE = '888630a8a730ce6bcdfe2e5fb679a3620ac171aa';
const candidate = git(['rev-parse', 'HEAD']);
if (!candidate) missing('candidate_unavailable');
if (candidate === BASELINE) missing('baseline_equals_candidate');
if (gitStatus(['cat-file', '-t', BASELINE]) !== 0)
  missing('fixed_baseline_unavailable');

const baselinePackage = parse(git(['show', `${BASELINE}:package.json`]));
const currentPackage = parse(fs.readFileSync('package.json', 'utf8'));
const baselineMigrations = migrationMap(BASELINE);
const currentMigrations = Object.fromEntries(
  fs
    .readdirSync('src/infrastructure/postgres/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const target = `src/infrastructure/postgres/migrations/${file}`;
      return [target, sha(fs.readFileSync(target))];
    }),
);
if (
  Object.keys(baselineMigrations).length === 0 ||
  Object.keys(currentMigrations).length === 0 ||
  Object.keys(baselinePackage.dependencies ?? {}).length === 0 ||
  Object.keys(currentPackage.dependencies ?? {}).length === 0 ||
  Object.keys(baselinePackage.exports ?? {}).length === 0 ||
  Object.keys(currentPackage.exports ?? {}).length === 0
)
  missing('compare_set_empty');

const result = {
  guard: 'registry-change-budget',
  baseline: BASELINE,
  candidate,
  migrations: compare(baselineMigrations, currentMigrations),
  dependencies: compare(
    baselinePackage.dependencies,
    currentPackage.dependencies,
  ),
  exports: compare(baselinePackage.exports, currentPackage.exports),
};
const failures = Object.entries(result)
  .filter(([, value]) => value && typeof value === 'object' && 'equal' in value)
  .filter(([, value]) => !value.equal)
  .map(([name]) => name);
console.log(JSON.stringify({ ...result, failures }));
if (failures.length) {
  for (const failure of failures)
    console.error(`registry_change_budget_violation:target=${failure}`);
  process.exit(1);
}

function migrationMap(ref) {
  const files = git([
    'ls-tree',
    '-r',
    '--name-only',
    ref,
    '--',
    'src/infrastructure/postgres/migrations',
  ])
    .split('\n')
    .filter(Boolean);
  return Object.fromEntries(
    files.map((file) => [file, sha(git(['show', `${ref}:${file}`], false))]),
  );
}

function compare(before, after) {
  const beforeEntries = Object.entries(before).map(([key, value]) =>
    JSON.stringify([key, value]),
  );
  const afterEntries = Object.entries(after).map(([key, value]) =>
    JSON.stringify([key, value]),
  );
  return {
    before_count: beforeEntries.length,
    after_count: afterEntries.length,
    removed: beforeEntries.filter((entry) => !afterEntries.includes(entry)),
    added: afterEntries.filter((entry) => !beforeEntries.includes(entry)),
    equal:
      beforeEntries.length === afterEntries.length &&
      beforeEntries.every((entry) => afterEntries.includes(entry)),
  };
}

function parse(value) {
  try {
    return JSON.parse(value);
  } catch {
    missing('package_json_invalid');
  }
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(argv, trim = true) {
  const result = spawnSync('git', argv, { encoding: 'utf8' });
  if (result.status !== 0) missing(`git_failed:${argv.join(':')}`);
  return trim ? result.stdout.trimEnd() : result.stdout;
}

function gitStatus(argv) {
  return spawnSync('git', argv, { encoding: 'utf8' }).status;
}

function missing(reason) {
  console.error(`registry_change_budget_missing:${reason}`);
  process.exit(2);
}
