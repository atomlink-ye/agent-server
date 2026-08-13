import { readFile } from 'node:fs/promises';

const TARGET_RE = /^([A-Za-z0-9_.:-]+):(?:[^=]|$)/gm;
const PACKAGE_LEAF_RE = /\bpnpm\s+(?:run\s+)?([A-Za-z][A-Za-z0-9_.:-]*)/g;

export const REQUIRED_LEAVES = [
  'test:unit',
  'test:contract',
  'test:integration',
  'test:web',
  'test:e2e',
  'test:real-pg',
  'build',
];

export const REQUIRED_LINEAGE_OBLIGATION =
  'src/contracts/product-projection/lineage-manifest.test.ts';

export async function readWorkflowSources(root) {
  const [makefile, packageJson, dockerCompose, dockerRun] = await Promise.all([
    readFile(`${root}/Makefile`, 'utf8'),
    readFile(`${root}/package.json`, 'utf8'),
    readFile(`${root}/scripts/dev/docker-compose`, 'utf8'),
    readFile(`${root}/scripts/dev/docker-run`, 'utf8'),
  ]);
  return { makefile, packageJson: JSON.parse(packageJson), dockerCompose, dockerRun };
}

export function extractMakeTargets(makefile) {
  return [...makefile.matchAll(TARGET_RE)].map((match) => match[1]);
}

export function extractPackageLeaves(packageJson) {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== 'object') return { missing: true, leaves: new Set() };
  const leaves = new Set();
  for (const command of Object.values(scripts)) {
    if (typeof command !== 'string') continue;
    for (const match of command.matchAll(PACKAGE_LEAF_RE)) leaves.add(match[1]);
  }
  return { missing: false, leaves };
}

export function evaluateRequiredLeaves({ makefile, packageJson }) {
  const targetSet = new Set(extractMakeTargets(makefile));
  const packageGraph = extractPackageLeaves(packageJson);
  const missing = [];
  for (const leaf of REQUIRED_LEAVES) {
    if (!packageJson?.scripts?.[leaf]) missing.push(`package script ${leaf}`);
  }
  if (!targetSet.has('test-real-pg')) missing.push('Make target test-real-pg');
  if (packageGraph.missing) missing.push('package scripts');
  if (!makefile.includes('docker-compose build runner')) missing.push('base runner build selector');
  return { missing, leaves: packageGraph.leaves, targets: targetSet };
}

export function hasUnsupportedDynamicDispatch(sources) {
  const dynamic = [sources.makefile, JSON.stringify(sources.packageJson), sources.dockerCompose ?? '', sources.dockerRun ?? ''].some((source) =>
    /\beval\s|\bxargs\s|pnpm\s+--filter\s+\$|\bmake\s+\$\(/.test(source),
  );
  return dynamic;
}

export function status(code, reason, facts = {}) {
  return { status: code === 0 ? 'PASS' : code === 1 ? 'FAIL' : 'MISSING', code, reason, ...facts };
}
