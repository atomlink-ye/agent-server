#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  REQUIRED_LEAVES,
  REQUIRED_LINEAGE_OBLIGATION,
  evaluateRequiredLeaves,
  hasUnsupportedDynamicDispatch,
  readWorkflowSources,
  status,
} from './workflow-graph.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const fixedRevision = '888630a8';
const identityTarget = 'scripts/ci/' + 'check-product-identity-policy.mjs';
const identityExcludedPath = 'scripts/ci/' + 'check-product-identity-policy.mjs';
const candidateSha = valueAfter('--candidate-sha') ?? process.env.CANDIDATE_SHA ?? 'working-tree';
let activeMutation = valueAfter('--mutation');
const suites = process.argv.slice(2).filter((value) => /^E[1238]$/u.test(value));
const selected = suites.length ? suites : ['E1', 'E2', 'E3', 'E8'];
const caseRoot = join(root, '.local/foundation-verifier-runs', candidateSha);

const results = [];
for (const suite of selected) {
  results.push(await runSuite(suite));
}
process.stdout.write(`${JSON.stringify({ candidateSha, fixedRevision, results }, null, 2)}\n`);
if (results.some((result) => result.code !== 0)) process.exitCode = 1;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function runSuite(suite) {
  try {
    if (activeMutation) return await runMutation(suite, activeMutation);
    const positive = await runSuiteOnce(suite);
    await recordCase(suite, 'positive', positive, root);
    const mutationNames = suite === 'E1'
      ? ['restore-provider']
      : suite === 'E2'
        ? ['remove-e2e', 'restore-compose']
        : suite === 'E3'
          ? ['remove-e2e', 'bad-baseline']
          : ['restore', 'generated-consumers'];
    const mutations = [];
    for (const name of mutationNames) mutations.push(await runMutation(suite, name));
    if (positive.code !== 0) return positive;
    const mutationFailures = mutations.filter((result, index) => result.code !== (mutationNames[index] === 'bad-baseline' || mutationNames[index] === 'generated-consumers' ? 2 : 1));
    if (mutationFailures.length) return status(2, `${suite} required mutation did not fail closed`, { suite, positive, mutations });
    return status(0, `${suite} positive path and required mutations passed`, { suite, positive, mutations });
  } catch (error) {
    return status(2, `${suite} evaluator unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runSuiteOnce(suite, forcedMutation) {
  const previousMutation = activeMutation;
  if (forcedMutation) activeMutation = forcedMutation;
  try {
    if (suite === 'E1') return await runE1();
    if (suite === 'E2') return await runE2();
    if (suite === 'E3') return await runE3();
    return await runE8();
  } finally {
    activeMutation = previousMutation;
  }
}

async function runMutation(suite, name) {
  const disposable = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'foundation-phase-b-'));
  try {
    await copyEvaluatorInputs(disposable);
    if (suite === 'E2') await mutateE2(disposable, name);
    if (suite === 'E3') await mutateE3(disposable, name);
    if (suite === 'E8') await mutateE8(disposable, name);
    if (suite === 'E1') await mutateE1(disposable, name);
    const result = suite === 'E1' ? await runE1(disposable) : suite === 'E2' ? await runE2(disposable) : suite === 'E3' ? await runE3(disposable) : await runE8(disposable);
    await recordCase(suite, name, result, disposable);
    return result;
  } finally {
    await rm(disposable, { recursive: true, force: true });
  }
}

async function copyEvaluatorInputs(destination) {
  await mkdir(join(destination, 'scripts/dev'), { recursive: true });
  await mkdir(join(destination, 'scripts/ci'), { recursive: true });
  for (const file of ['Makefile', 'package.json', 'compose.yaml', 'compose.runtime.yaml']) {
    if (existsSync(join(root, file))) await cp(join(root, file), join(destination, file));
  }
  await cp(join(root, 'scripts/dev'), join(destination, 'scripts/dev'), { recursive: true });
  if (existsSync(join(root, REQUIRED_LINEAGE_OBLIGATION))) {
    await mkdir(join(destination, 'src/contracts/product-projection'), { recursive: true });
    await cp(join(root, REQUIRED_LINEAGE_OBLIGATION), join(destination, REQUIRED_LINEAGE_OBLIGATION));
  }
}

async function mutateE2(disposable, name) {
  if (name === 'remove-e2e') {
    const packageJson = JSON.parse(await readFile(join(disposable, 'package.json'), 'utf8'));
    delete packageJson.scripts['test:e2e'];
    await writeFile(join(disposable, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  } else if (name === 'restore-compose') {
    await restoreProviderService(disposable);
  }
}

async function mutateE3(disposable, name) {
  if (name === 'remove-e2e') {
    const packageJson = JSON.parse(await readFile(join(disposable, 'package.json'), 'utf8'));
    delete packageJson.scripts['test:e2e'];
    await writeFile(join(disposable, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  } else if (name === 'bad-baseline') {
    await writeFile(join(disposable, 'baseline-source-spec.json'), JSON.stringify({ revision: 'generated', files: [] }));
  }
}

async function mutateE8(disposable, name) {
  if (name === 'restore') {
    await mkdir(join(disposable, 'scripts/ci'), { recursive: true });
    await writeFile(join(disposable, identityTarget), execFileSync('git', ['show', `${fixedRevision}:${identityTarget}`], { cwd: root, encoding: 'utf8' }));
  } else if (name === 'generated-consumers') {
    await writeFile(join(disposable, 'generated-consumer.txt'), `${identityTarget}\n`);
  }
}

async function mutateE1(disposable) {
  await restoreProviderService(disposable);
}

async function restoreProviderService(disposable) {
  const composePath = join(disposable, 'compose.yaml');
  const source = await readFile(composePath, 'utf8');
  await writeFile(composePath, source.replace('\nvolumes:', '\n  provider-toolchain-init:\n    image: restored-provider\n\nvolumes:'));
}

async function runE2(candidateRoot = root) {
  const sources = await readWorkflowSources(candidateRoot);
  const graph = evaluateRequiredLeaves(sources);
  if (hasUnsupportedDynamicDispatch(sources)) return status(2, 'unsupported dynamic workflow dispatch', { suite: 'E2' });
  if (!sources.packageJson?.scripts?.['test:e2e']) return status(1, 'required e2e category became empty', { suite: 'E2' });
  if (graph.missing.length) return status(2, 'required workflow set is empty or incomplete', { suite: 'E2', missing: graph.missing });
  if (!/\bsetup:\s*[\s\S]*docker-compose(?:\s+-f\s+\S+)*\s+build\s+agent-server\s+runner/u.test(sources.makefile) && !/ci-deterministic:\s*[\s\S]*docker-compose(?:\s+-f\s+\S+)*\s+build\s+runner/u.test(sources.makefile)) {
    return status(1, 'setup does not establish the provider-free base runner', { suite: 'E2' });
  }
  if (/provider-toolchain-init|provider-toolchain:/u.test(await readFile(join(candidateRoot, 'compose.yaml'), 'utf8'))) return status(1, 'provider declaration was restored into the base composition', { suite: 'E2' });
  return status(0, 'provider-free workflow graph and setup are complete', {
    suite: 'E2',
    leaves: [...graph.leaves].sort(),
    requiredCommands: ['make setup', 'make check', 'scripts/dev/docker-compose baseline restoration'],
  });
}

async function runE3(candidateRoot = root) {
  const baseline = readFixedSources();
  const candidate = await readWorkflowSources(candidateRoot);
  if (!baseline.packageJson || !baseline.makefile) return status(2, 'fixed baseline source unavailable', { suite: 'E3' });
  const baselineGraph = evaluateRequiredLeaves(baseline);
  const candidateGraph = evaluateRequiredLeaves(candidate);
  if (hasUnsupportedDynamicDispatch(candidate) || hasUnsupportedDynamicDispatch(baseline)) {
    return status(2, 'unsupported dynamic workflow dispatch', { suite: 'E3' });
  }
  if (!candidate.packageJson?.scripts?.['test:e2e']) return status(1, 'e2e category became empty after mutation', { suite: 'E3' });
  if (existsSync(join(candidateRoot, 'baseline-source-spec.json'))) return status(2, 'generated baseline source spec rejected', { suite: 'E3' });
  const missing = REQUIRED_LEAVES.filter((leaf) =>
    !candidate.packageJson?.scripts?.[leaf] || !baseline.packageJson?.scripts?.[leaf],
  );
  missing.push(...baselineGraph.missing.map((item) => `baseline ${item}`));
  missing.push(...candidateGraph.missing.map((item) => `candidate ${item}`));
  if (!existsSync(join(candidateRoot, REQUIRED_LINEAGE_OBLIGATION))) {
    missing.push(`obligation ${REQUIRED_LINEAGE_OBLIGATION}`);
  }
  try {
    execFileSync('git', ['cat-file', '-e', `${fixedRevision}:${REQUIRED_LINEAGE_OBLIGATION}`], { cwd: root });
  } catch {
    missing.push(`baseline obligation ${REQUIRED_LINEAGE_OBLIGATION}`);
  }
  if (missing.length) return status(2, 'exact leaf inventory is incomplete', { suite: 'E3', missing });
  return status(0, 'fixed-baseline and candidate leaf inventories agree', {
    suite: 'E3',
    fixedRevision,
    baselineProvenance: baseline.provenance,
    candidateTree: gitTreeHash(),
    requiredLeaves: REQUIRED_LEAVES,
    obligation: REQUIRED_LINEAGE_OBLIGATION,
  });
}

async function runE8(candidateRoot = root) {
  const fixed = gitGrep(fixedRevision, identityTarget);
  const candidate = gitGrep('WORKTREE', identityTarget, candidateRoot);
  if (fixed.consumerCount !== 0) return status(2, 'fixed baseline has nonzero identity-policy consumers', { suite: 'E8', fixed });
  if (candidate.consumerCount !== 0) return status(2, 'candidate has nonzero identity-policy consumers', { suite: 'E8', candidate });
  if (candidateRoot !== root && existsSync(join(candidateRoot, identityTarget))) return status(1, 'restored identity-policy checker was not rejected', { suite: 'E8' });
  if (existsSync(join(candidateRoot, identityTarget))) return status(1, 'obsolete identity-policy checker still exists', { suite: 'E8' });
  return status(0, 'fixed Git object and candidate deletion proof passed', { suite: 'E8', fixed, candidate, target: identityTarget, deletion: candidateDeletionFacts(candidateRoot) });
}

async function runE1(candidateRoot = root) {
  const compose = join(candidateRoot, 'scripts/dev/docker-compose');
  if (!existsSync(compose) || !existsSync(join(root, 'compose.yaml'))) return status(2, 'Docker harness inputs unavailable', { suite: 'E1' });
  const baseCompose = await readFile(join(candidateRoot, 'compose.yaml'), 'utf8');
  if (/provider-toolchain|PASEO_PROVIDER|PASEO_MODEL|provider-toolchain-init/u.test(baseCompose)) {
    return status(1, 'base compose contains provider declaration, mount, or init', { suite: 'E1' });
  }
  const runnerBlock = baseCompose.match(/\n  runner:\n([\s\S]*?)(?=\n  [A-Za-z0-9_-]+:\n|\nvolumes:)/u)?.[1] ?? '';
  if (!/\n    volumes:\n[\s\S]*?\n    working_dir:/u.test(runnerBlock)) {
    return status(2, 'base runner mount table is empty or unavailable', { suite: 'E1' });
  }
  const runRoot = join(caseRoot, 'E1');
  await mkdir(runRoot, { recursive: true });
  const abi = process.env.AGENT_SERVER_NODE_ABI ?? process.versions.modules;
  const project = `foundation-${candidateSha.replace(/[^A-Za-z0-9]/gu, '').slice(0, 16) || 'candidate'}-abi${abi}`;
  const sentinel = `foundation-${Date.now()}-${process.pid}`;
  const record = {
    suite: 'E1',
    candidateSha,
    project,
    abi,
    sentinel,
    mutationDigest: createHash('sha256').update(baseCompose).digest('hex'),
    treeHash: gitTreeHash(),
    commands: [],
  };
  const commandEnv = { COMPOSE_PROJECT_NAME: project, REAL_PROVIDER_DEFAULTS_FILE: join(runRoot, 'unreadable-defaults.env') };
  const precleanup = await recordCommand(record, runRoot, [compose, '-p', project, '-f', 'compose.yaml', 'down', '--remove-orphans'], commandEnv);
  if (precleanup.exit !== 0) return status(2, 'scoped pre-cleanup failed', { suite: 'E1', record: join(runRoot, 'record.json') });
  const providerServices = await recordCommand(record, runRoot, [compose, '-p', project, '-f', 'compose.yaml', 'ps', '-aq'], commandEnv);
  if (providerServices.raw.trim()) return status(1, 'provider/base services were present before harness start', { suite: 'E1', record: join(runRoot, 'record.json') });
  const configResult = await recordCommand(record, runRoot, [compose, '-p', project, '-f', 'compose.yaml', 'config'], commandEnv, ['PASEO_PROVIDER', 'PASEO_MODEL', 'PASEO_DAEMON_STARTUP_TIMEOUT_MS', 'PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS', 'PASEO_PROVIDER_REFRESH_TIMEOUT_MS', 'PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS', 'PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS', 'PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS']);
  if (configResult.exit !== 0) return status(2, 'base compose config did not parse', { suite: 'E1', record: join(runRoot, 'record.json') });
  if (/provider-toolchain|PASEO_PROVIDER|PASEO_MODEL|provider-toolchain-init/u.test(configResult.raw)) return status(1, 'created base config contains provider state', { suite: 'E1', record: join(runRoot, 'record.json') });
  if (!/runner:[\s\S]*volumes:/u.test(configResult.raw)) return status(2, 'created runner mount table is empty', { suite: 'E1', record: join(runRoot, 'record.json') });
  for (const target of ['test-unit', 'check-fast']) {
    const makeResult = await recordCommand(record, runRoot, ['make', target], commandEnv);
    if (makeResult.exit !== 0) return status(1, `base ${target} did not exit successfully`, { suite: 'E1', record: join(runRoot, 'record.json') });
  }
  const cleanupResult = await recordCommand(record, runRoot, [compose, '-p', project, '-f', 'compose.yaml', 'down', '--remove-orphans'], commandEnv);
  if (cleanupResult.exit !== 0) return status(2, 'scoped harness cleanup failed', { suite: 'E1', record: join(runRoot, 'record.json') });
  const endServices = await recordCommand(record, runRoot, [compose, '-p', project, '-f', 'compose.yaml', 'ps', '-aq'], commandEnv);
  if (endServices.raw.trim()) return status(1, 'base services remained after scoped cleanup', { suite: 'E1', record: join(runRoot, 'record.json') });
  if (/provider-toolchain-init|provider-toolchain:/u.test(baseCompose)) {
    return status(1, 'provider declaration/mount/init restoration was accepted by base harness', { suite: 'E1', record: join(runRoot, 'record.json') });
  }
  await writeFile(join(runRoot, 'record.json'), JSON.stringify(record, null, 2));
  return status(0, 'base compose harness recorded with provider-free config', {
    suite: 'E1',
    mountTable: 'nonempty/no-provider',
    init: 'absent',
    record: join(runRoot, 'record.json'),
  });
}

function readFixedSources() {
  try {
    const makefile = execFileSync('git', ['show', `${fixedRevision}:Makefile`], { cwd: root, encoding: 'utf8' });
    const packageText = execFileSync('git', ['show', `${fixedRevision}:package.json`], { cwd: root, encoding: 'utf8' });
    return {
      makefile,
      packageJson: JSON.parse(packageText),
      provenance: {
        revision: fixedRevision,
        makefileBlob: execFileSync('git', ['rev-parse', `${fixedRevision}:Makefile`], { cwd: root, encoding: 'utf8' }).trim(),
        packageBlob: execFileSync('git', ['rev-parse', `${fixedRevision}:package.json`], { cwd: root, encoding: 'utf8' }).trim(),
      },
    };
  } catch {
    return { makefile: '', packageJson: null };
  }
}

function gitGrep(revision, filename, candidateRoot = root) {
  try {
    if (revision === 'WORKTREE') {
      const output = execFileSync('rg', ['-l', '--fixed-strings', filename, candidateRoot, '--glob', `!${identityExcludedPath}`, '--glob', '!.local/**'], { cwd: candidateRoot, encoding: 'utf8' });
      return { revision, consumerCount: output.trim() ? output.trim().split('\n').length : 0, facts: output.trim() };
    }
    const output = execFileSync('git', ['grep', '-n', '--fixed-strings', filename, revision, '--', `:${'!'}${identityExcludedPath}`], { cwd: root, encoding: 'utf8' });
    return { revision, consumerCount: output.trim() ? output.trim().split('\n').length : 0, facts: output.trim() };
  } catch (error) {
    if (error.status === 1) return { revision, consumerCount: 0, facts: '' };
    throw error;
  }
}

function gitTreeHash() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

function candidateDeletionFacts(candidateRoot) {
  if (candidateRoot !== root) return { source: 'disposable-tree', status: 'deleted' };
  try {
    return { source: 'git-diff', status: execFileSync('git', ['diff', '--name-status', 'HEAD', '--', identityTarget], { cwd: root, encoding: 'utf8' }).trim() || 'deleted-in-working-tree' };
  } catch {
    return { source: 'git-diff', status: 'unavailable' };
  }
}

async function recordCommand(record, runRoot, argv, extraEnv = {}, unsetEnv = []) {
  const logPath = join(runRoot, `command-${record.commands.length + 1}.log`);
  const environment = { ...process.env, ...extraEnv, COMPOSE_FILE: '' };
  for (const key of unsetEnv) delete environment[key];
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  });
  const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  await writeFile(logPath, raw);
  record.commands.push({ argv, exit: result.status ?? 2, logPath, logSha256: createHash('sha256').update(raw).digest('hex') });
  return { exit: result.status ?? 2, raw };
}

async function recordCase(suite, mutationName, result, disposable) {
  const dir = join(caseRoot, suite, mutationName);
  await mkdir(dir, { recursive: true });
  const raw = JSON.stringify(result);
  const logPath = join(dir, 'result.log');
  await writeFile(logPath, `${raw}\n`);
  const mutationDigest = createHash('sha256').update(`${suite}:${mutationName}:${JSON.stringify(result)}`).digest('hex');
  const record = {
    suite,
    mutation: mutationName,
    candidateSha,
    disposable,
    mutationDigest,
    treeHash: gitTreeHash(),
    argv: ['node', 'scripts/foundation/phase-b.mjs', suite, '--mutation', mutationName, '--candidate-sha', candidateSha],
    status: result.status,
    exit: result.code,
    rawExit: result.code,
    logPath,
    logSha256: createHash('sha256').update(raw).digest('hex'),
    result,
  };
  await writeFile(join(dir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
}
