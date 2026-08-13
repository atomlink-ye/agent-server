#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const defaultPackage = path.join(repo, 'package.json');

function fail(code) {
  throw new Error(`guard_wiring_invalid:${code}`);
}

function packagePath(argv) {
  const index = argv.indexOf('--package');
  if (index < 0) return defaultPackage;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail('missing_package_path');
  return path.resolve(value);
}

function readPackage(filename) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch {
    fail('package_invalid');
  }
  if (!value || typeof value !== 'object' || !value.scripts)
    fail('scripts_missing');
  return value;
}

function chain(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label}_missing`);
  if (/\|\||\b(?:if|then|else|fi|case|for|while|until)\b|[;?]/u.test(value))
    fail(`${label}_conditional`);
  const parts = value.split(/\s+&&\s+/u).map((part) => part.trim());
  if (parts.some((part) => !part || part.includes('||')))
    fail(`${label}_chain_invalid`);
  return parts;
}

function requireExactSequence(parts, expected, label) {
  if (
    parts.length !== expected.length ||
    parts.some((part, index) => part !== expected[index])
  )
    fail(`${label}_order_or_membership`);
}

function requireExactLeaf(scripts, name, expected) {
  const actual = scripts[name];
  if (typeof actual !== 'string' || actual !== expected)
    fail(`${name.replaceAll(':', '_')}_definition`);
  if (/\btrue\b|\|\||&&/u.test(actual))
    fail(`${name.replaceAll(':', '_')}_conditional`);
}

function main() {
  const filename = packagePath(process.argv.slice(2));
  const pkg = readPackage(filename);
  const backend = chain(pkg.scripts['check:backend'], 'check_backend');
  if (!backend.includes('pnpm guard:product-accepted-subset'))
    fail('check_backend_guard_missing');
  if (
    backend.filter((part) => part === 'pnpm guard:product-accepted-subset')
      .length !== 1
  )
    fail('check_backend_guard_not_unique');

  const aggregate = chain(
    pkg.scripts['guard:product-accepted-subset'],
    'accepted_guard',
  );
  requireExactSequence(
    aggregate,
    [
      'pnpm guard:product-accepted-gate-lineage',
      'pnpm check:product-accepted-subset',
      'pnpm modularization:verify:product-routes',
    ],
    'accepted_guard',
  );
  requireExactLeaf(
    pkg.scripts,
    'guard:product-accepted-gate-lineage',
    'node scripts/ci/verify-product-accepted-gate-lineage.mjs',
  );
  requireExactLeaf(
    pkg.scripts,
    'check:product-accepted-subset',
    'node --import tsx scripts/ci/check-product-accepted-subset.ts --check',
  );
  requireExactLeaf(
    pkg.scripts,
    'modularization:verify:product-routes',
    'pnpm guard:create-app-product-endpoints',
  );
  requireExactLeaf(
    pkg.scripts,
    'guard:create-app-product-endpoints',
    'node --import tsx scripts/ci/guard-create-app-product-endpoints.mjs',
  );
  const message = [
    `guard_wiring_ok package=${filename}`,
    `check_backend=${backend.length}`,
    `accepted_guard=${aggregate.length}`,
  ].join(' ');
  process.stdout.write(`${message}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
