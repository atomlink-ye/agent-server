import { readFile } from 'node:fs/promises';

export const CANDIDATE_ROOTS = [
  'candidate-deterministic',
  'candidate-real-postgres',
];

export const REQUIRED_LINEAGE_ID =
  'test/backend-unit/src/contracts/product-projection/lineage-manifest.test.ts';
export const REQUIRED_LINEAGE_SOURCE =
  'src/contracts/product-projection/lineage-manifest.test.ts';

const MAKE_TARGET = /^([A-Za-z0-9_.:-]+):(?:\s*#.*)?$/gm;
const RUN_LINE = /^\s*-\s*run:\s*(.+)$/gm;

export async function readWorkflowSources(root) {
  const [workflow, makefile, packageText, dockerCompose, dockerRun] =
    await Promise.all([
      readFile(`${root}/.github/workflows/ci.yml`, 'utf8'),
      readFile(`${root}/Makefile`, 'utf8'),
      readFile(`${root}/package.json`, 'utf8'),
      readFile(`${root}/scripts/dev/docker-compose`, 'utf8'),
      readFile(`${root}/scripts/dev/docker-run`, 'utf8'),
    ]);
  return {
    workflowText: workflow,
    workflow: parseWorkflow(workflow),
    makefile,
    packageJson: JSON.parse(packageText),
    dockerCompose,
    dockerRun,
  };
}

export function parseWorkflow(text) {
  const jobs = {};
  let currentJob = null;
  let currentStep = null;
  let inJobs = false;
  for (const line of text.split(/\r?\n/u)) {
    if (/^jobs:\s*$/u.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const job = line.match(/^  ([A-Za-z0-9_-]+):\s*$/u);
    if (job && job[1] !== 'on') {
      currentJob = job[1];
      jobs[currentJob] = { runs: [] };
      currentStep = null;
      continue;
    }
    if (!currentJob) continue;
    const run = line.match(/^\s{6}-\s+run:\s*(.*)$/u);
    if (run) {
      currentStep = { run: unquote(run[1]) };
      jobs[currentJob].runs.push(currentStep.run);
      continue;
    }
    const multiline = line.match(/^\s{6}-\s+run:\s*\|\s*$/u);
    if (multiline) {
      currentStep = { run: '' };
      jobs[currentJob].runs.push(currentStep.run);
    }
  }
  // A YAML parser is preferred when installed, but the strict fallback above
  // intentionally accepts only the workflow shape used by this repository.
  return { jobs };
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function makeTargets(makefile) {
  const targets = new Map();
  const lines = makefile.split(/\r?\n/u);
  let target = null;
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_.:-]+):(?:\s*[^=].*)?$/u);
    if (match) {
      target = match[1];
      targets.set(target, []);
      continue;
    }
    if (target && /^\t/u.test(line)) targets.get(target).push(line.slice(1));
  }
  return targets;
}

export function packageClosure(packageJson, roots) {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== 'object')
    return { missing: ['package scripts'], scripts: [], commands: [] };
  const seen = new Set();
  const commands = [];
  const missing = [];
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const command = scripts[name];
    if (typeof command !== 'string') {
      missing.push(name);
      return;
    }
    commands.push({ name, command });
    for (const ref of command.matchAll(
      /\bpnpm\s+(?:run\s+)?([A-Za-z][A-Za-z0-9_.:-]*)/gu,
    )) {
      const child = ref[1];
      if (scripts[child]) visit(child);
    }
  };
  for (const root of roots) visit(root);
  return { missing, scripts: [...seen].sort(), commands };
}

export function workflowMakeRoots(sources) {
  const jobs = sources.workflow?.jobs ?? {};
  return CANDIDATE_ROOTS.flatMap((job) => {
    const runs = jobs[job]?.runs ?? [];
    return runs
      .filter((run) => /^make\s+[A-Za-z0-9_.:-]+\s*$/u.test(run))
      .map((run) => ({
        job,
        target: run.replace(/^make\s+/u, '').trim(),
        run,
      }));
  });
}

export function targetPackageRoots(makefile, roots) {
  const targets = makeTargets(makefile);
  const missing = [];
  const commands = [];
  const packageRoots = [];
  const visited = new Set();
  const visit = (target) => {
    if (visited.has(target)) return;
    visited.add(target);
    const recipes = targets.get(target);
    if (!recipes) {
      missing.push(`Make target ${target}`);
      return;
    }
    for (const recipe of recipes) {
      commands.push({ target, recipe });
      const pnpm = recipe.match(
        /\bpnpm\s+(?:run\s+)?([A-Za-z][A-Za-z0-9_.:-]*)/u,
      );
      if (pnpm) packageRoots.push(pnpm[1]);
      const nested = recipe.match(/^\$\(?MAKE\)?\s+([A-Za-z0-9_.:-]+)/u);
      if (nested) visit(nested[1]);
    }
  };
  for (const root of roots) visit(root.target);
  return {
    targets,
    missing,
    commands,
    packageRoots: [...new Set(packageRoots)],
  };
}

export function evaluateRequiredLeaves({ makefile, packageJson }) {
  const targets = makeTargets(makefile);
  const missing = [];
  for (const name of [
    'test:unit',
    'test:contract',
    'test:integration',
    'test:web',
    'test:e2e',
    'test:real-pg',
    'build',
  ]) {
    if (typeof packageJson?.scripts?.[name] !== 'string')
      missing.push(`package script ${name}`);
  }
  if (!targets.has('test-real-pg')) missing.push('Make target test-real-pg');
  return { missing, targets };
}

export function forbiddenCandidateFindings(sources, roots, packageGraph) {
  const findings = [];
  const workflowRuns = roots.map((root) => root.run).join('\n');
  if (/\bmake\s+setup\b/u.test(workflowRuns))
    findings.push('workflow make setup');
  if (
    /(?:resolve-opencode\S*\s+--check|source-real-provider-defaults|provider-toolchain-stamp)/u.test(
      workflowRuns,
    )
  ) {
    findings.push('workflow provider bootstrap');
  }
  const makeCommands = packageGraph.commands
    .map((item) => item.recipe)
    .join('\n');
  const packageCommands = packageGraph.packageCommands
    .map((item) => item.command)
    .join('\n');
  if (/\bmake\s+setup\b/u.test(makeCommands)) findings.push('Make make setup');
  if (
    /resolve-opencode\S*\s+--check|source-real-provider-defaults|provider-toolchain-stamp/u.test(
      `${makeCommands}\n${packageCommands}`,
    )
  ) {
    findings.push('provider bootstrap in candidate closure');
  }
  if (
    /--runtime\b|--real-provider-defaults/u.test(
      `${makeCommands}\n${packageCommands}`,
    )
  ) {
    findings.push('runtime selection in candidate closure');
  }
  const baseCompose = sources.baseCompose ?? '';
  if (
    /provider-toolchain-init|provider-toolchain:|PASEO_PROVIDER|PASEO_MODEL/u.test(
      baseCompose,
    )
  )
    findings.push('provider declaration in base compose');
  return findings;
}

export function hasUnsupportedDynamicDispatch(sources) {
  return [
    sources.workflowText,
    sources.makefile,
    JSON.stringify(sources.packageJson),
    sources.dockerCompose,
    sources.dockerRun,
  ].some((text) =>
    /\beval\s|\bxargs\s|\bmake\s+\$\(|\$\{\{[^}]+\}\}|fromJSON\s*\(/u.test(
      text,
    ),
  );
}

export function status(code, reason, facts = {}) {
  return {
    status: code === 0 ? 'PASS' : code === 1 ? 'FAIL' : 'MISSING',
    code,
    reason,
    ...facts,
  };
}
