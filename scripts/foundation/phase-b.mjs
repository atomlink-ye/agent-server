#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  CANDIDATE_ROOTS,
  REQUIRED_LINEAGE_ID,
  REQUIRED_LINEAGE_SOURCE,
  hasUnsupportedDynamicDispatch,
  packageClosure,
  readWorkflowSources,
  status,
  targetPackageRoots,
  workflowMakeRoots,
} from './workflow-graph.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const fixedRevision = '888630a8';
const identityTarget = 'scripts/ci/' + 'check-product-identity-' + 'policy.mjs';
const identityBasename = identityTarget.slice(identityTarget.lastIndexOf('/') + 1);
const suites = process.argv.slice(2).filter((value) => /^E[1238]$/u.test(value));
const single = process.argv.includes('--single');
const candidateRootArg = valueAfter('--candidate-root');
const candidateCommitArg = valueAfter('--candidate-commit');
const candidateSha = valueAfter('--candidate-sha') ?? process.env.CANDIDATE_SHA;
const selected = suites.length ? suites : ['E1', 'E2', 'E3', 'E8'];
const recordRoot = join(
  root,
  '.local/foundation-verifier-runs',
  candidateSha ?? 'missing-candidate-sha',
);

const candidateCommit = validateCandidateSha(candidateSha);
const results = [];
for (const suite of selected) {
  results.push(
    single
      ? await evaluateSuite(suite, candidateRootArg ?? root, candidateCommitArg ?? candidateCommit)
      : await runSuite(suite, candidateCommit),
  );
}
process.stdout.write(
  `${JSON.stringify({ candidateSha, fixedRevision, results }, null, 2)}\n`,
);
if (single) process.exitCode = results[0]?.code ?? 2;
else if (results.some((result) => result.code !== 0)) process.exitCode = 2;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function validateCandidateSha(value) {
  if (!value || !/^[0-9a-f]{40}$/u.test(value)) return null;
  try {
    const resolved = git(['rev-parse', '--verify', `${value}^{commit}`]);
    const head = git(['rev-parse', 'HEAD']);
    if (resolved !== value || head !== value) return null;
    return resolved;
  } catch {
    return null;
  }
}

async function runSuite(suite, commit) {
  if (!commit) return status(2, 'candidate SHA must be the 40-hex clean HEAD commit', { suite });
  if (suite === 'E1') return status(2, 'E1 Docker acceptance is deferred to the acceptance runner', { suite });
  const positiveRoot = await materialize(commit);
  try {
    const positive = await invokeUnchangedEvaluator(suite, commit, positiveRoot, commit, 'positive');
    const mutationNames = suite === 'E2'
      ? ['add-setup', 'restore-compose-and-check']
      : suite === 'E3'
        ? ['remove-e2e-include', 'bad-baseline-spec']
        : ['restore', 'generated-consumer'];
    const mutations = [];
    for (const mutation of mutationNames) {
      const mutated = await createMutation(suite, commit, mutation);
      try {
        mutations.push(
          await invokeUnchangedEvaluator(
            suite,
            commit,
            mutated.root,
            mutated.commit,
            mutation,
            mutated.digest,
          ),
        );
      } finally {
        await rm(mutated.cleanup, { recursive: true, force: true });
      }
    }
    await recordResult(suite, 'positive', positive, commit, positiveRoot, commit);
    const expected = suite === 'E3' ? [1, 2] : suite === 'E8' ? [1, 2] : [1, 1];
    const mutationOk = mutations.every((item, index) => item.code === expected[index]);
    if (positive.code !== 0 || !mutationOk) {
      return status(2, 'positive or mutation arm did not meet the required outcome', {
        suite,
        positive,
        mutations,
        expected,
      });
    }
    return status(0, 'positive and mutation arms passed', { suite, positive, mutations });
  } finally {
    await rm(positiveRoot, { recursive: true, force: true });
  }
}

async function invokeUnchangedEvaluator(
  suite,
  commit,
  candidateRoot,
  candidateCommit,
  mutation,
  mutationDigest,
) {
  const argv = [
    process.execPath,
    resolve(new URL('./phase-b.mjs', import.meta.url).pathname),
    suite,
    '--single',
    '--candidate-sha',
    commit,
    '--candidate-root',
    candidateRoot,
    '--candidate-commit',
    candidateCommit,
  ];
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FOUNDATION_CHILD: '1' },
  });
  const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = status(2, 'unchanged evaluator emitted invalid JSON', { suite, mutation });
  }
  const item = parsed?.results?.[0] ?? parsed;
  const outcome = { ...item, subprocess: { argv, exit: result.status ?? 2, raw } };
  await recordResult(suite, mutation, outcome, commit, candidateRoot, candidateCommit, mutationDigest);
  return outcome;
}

async function evaluateSuite(suite, candidateRoot, candidateCommit) {
  try {
    if (suite === 'E1') return status(2, 'E1 Docker acceptance is deferred to the acceptance runner', { suite });
    if (suite === 'E2') return await evaluateE2(candidateRoot);
    if (suite === 'E3') return await evaluateE3(candidateRoot);
    return await evaluateE8(candidateCommit, candidateRoot);
  } catch (error) {
    return status(2, `evaluator unavailable: ${error instanceof Error ? error.message : String(error)}`, { suite });
  }
}

async function evaluateE2(candidateRoot) {
  const sources = await readWorkflowSources(candidateRoot);
  if (hasUnsupportedDynamicDispatch(sources)) return status(2, 'unsupported dynamic workflow dispatch', { suite: 'E2' });
  const workflowJobs = Object.keys(sources.workflow.jobs);
  if (workflowJobs.length !== 4) return status(2, 'workflow job set is not the four-job add state', { suite: 'E2', workflowJobs });
  const candidateRuns = CANDIDATE_ROOTS.flatMap((job) => sources.workflow.jobs[job]?.runs ?? []);
  if (candidateRuns.some((run) => /^make\s+setup\s*$/u.test(run))) {
    return status(1, 'candidate workflow directly invokes runtime setup', { suite: 'E2', path: 'workflow -> make setup' });
  }
  const roots = workflowMakeRoots(sources);
  if (roots.length !== 2 || roots.some((item) => !CANDIDATE_ROOTS.includes(item.job))) {
    return status(2, 'candidate workflow roots are missing or dynamically dispatched', { suite: 'E2', roots });
  }
  const targetGraph = targetPackageRoots(sources.makefile, roots);
  const expectedTargets = new Set(['ci-deterministic', 'ci-real-pg']);
  const actualTargets = new Set(roots.map((item) => item.target));
  const restoredWrapper = sources.dockerCompose === gitShow(fixedRevision, 'scripts/dev/docker-compose').toString('utf8');
  if (actualTargets.size !== expectedTargets.size || [...expectedTargets].some((target) => !actualTargets.has(target))) {
    return status(1, 'candidate root command changed', {
      suite: 'E2',
      path: restoredWrapper
        ? ['workflow -> Make', 'workflow -> Make -> scripts/dev/docker-compose']
        : ['workflow -> Make'],
      roots,
    });
  }
  if (targetGraph.missing.length) return status(2, 'Make prerequisite is missing', { suite: 'E2', missing: targetGraph.missing });
  const packageGraph = packageClosure(sources.packageJson, targetGraph.packageRoots);
  targetGraph.packageCommands = packageGraph.commands;
  if (packageGraph.missing.length) return status(2, 'package dispatch is missing', { suite: 'E2', missing: packageGraph.missing });
  if (packageGraph.scripts.includes('check') && actualTargets.has('ci-deterministic')) {
    return status(1, 'candidate deterministic closure uses the old aggregate check', { suite: 'E2', path: 'workflow -> Make -> package check' });
  }
  const baseCompose = await readFile(join(candidateRoot, 'compose.yaml'), 'utf8');
  const forbidden = [];
  const workflowText = roots.map((item) => item.run).join('\n');
  const makeText = targetGraph.commands.map((item) => item.recipe).join('\n');
  const packageText = packageGraph.commands.map((item) => item.command).join('\n');
  if (/\bmake\s+setup\b/u.test(workflowText)) forbidden.push('make setup');
  if (/resolve-opencode\S*\s+--check|source-real-provider-defaults|provider-toolchain-stamp/u.test(`${workflowText}\n${makeText}\n${packageText}`)) forbidden.push('provider bootstrap');
  if (/--runtime\b|--real-provider-defaults/u.test(`${workflowText}\n${makeText}\n${packageText}`)) forbidden.push('runtime selection');
  if (/provider-toolchain-init|provider-toolchain:|PASEO_PROVIDER|PASEO_MODEL/u.test(baseCompose)) forbidden.push('base provider declaration');
  if (!baseWrapperIsBaseSafe(sources.dockerCompose)) forbidden.push('provider side effect outside explicit runtime guard');
  if (forbidden.length) return status(1, 'provider-dependent path entered candidate closure', { suite: 'E2', path: forbidden });
  // Keep the blob bytes (including its terminal newline) in this comparison.
  // A trimmed comparison can accept a wrapper which is not the fixed object.
  const baselineWrapper = gitShow(fixedRevision, 'scripts/dev/docker-compose').toString('utf8');
  if (sources.dockerCompose === baselineWrapper) {
    return status(1, 'candidate restored the fixed baseline docker-compose wrapper', {
      suite: 'E2',
      path: 'workflow -> Make -> scripts/dev/docker-compose',
    });
  }
  return status(0, 'candidate workflow traverses provider-free deterministic and real-PG roots', {
    suite: 'E2',
    roots,
    makeTargets: [...actualTargets].sort(),
    packageScripts: packageGraph.scripts,
  });
}

function baseWrapperIsBaseSafe(wrapper) {
  const guarded = (pattern) => {
    const index = wrapper.search(pattern);
    if (index < 0) return false;
    return wrapper.slice(0, index).lastIndexOf('if ((runtime_compose)); then') >
      wrapper.slice(0, index).lastIndexOf('fi');
  };
  return wrapper.includes('runtime_compose=0') &&
    guarded(/\.\s+"\$repo_root\/scripts\/dev\/source-real-provider-defaults"/u) &&
    guarded(/provider_stamp=/u) &&
    guarded(/docker volume create "\$provider_volume"/u) &&
    guarded(/provider-toolchain-init/u);
}

async function evaluateE3(candidateRoot) {
  if (existsSync(join(candidateRoot, 'baseline-source-spec.json'))) {
    return status(2, 'baseline evaluation spec is not a fixed Git object', { suite: 'E3', path: 'baseline-source-spec.json' });
  }
  const baseline = await materializeGitObjects(resolveCommit(fixedRevision));
  try {
    const [baselineSources, candidateSources] = await Promise.all([
      readWorkflowSources(baseline),
      readWorkflowSources(candidateRoot),
    ]);
    if (hasUnsupportedDynamicDispatch(baselineSources) || hasUnsupportedDynamicDispatch(candidateSources)) {
      return status(2, 'unsupported dynamic workflow dispatch', { suite: 'E3' });
    }
    const baselineInventory = await buildInventory(baseline, baselineSources);
    const candidateInventory = await buildInventory(candidateRoot, candidateSources);
    const missing = difference(baselineInventory, candidateInventory);
    const extra = difference(candidateInventory, baselineInventory);
    if (missing.length || extra.length) {
      return status(1, 'concrete obligation inventory differs', { suite: 'E3', missing, extra, path: 'workflow -> Make -> package -> config/files' });
    }
    if (!baselineInventory.includes(REQUIRED_LINEAGE_ID) || !candidateInventory.includes(REQUIRED_LINEAGE_ID)) {
      return status(2, 'canonical lineage obligation was not reached on both sides', { suite: 'E3', obligation: REQUIRED_LINEAGE_ID });
    }
    return status(0, 'fixed baseline and candidate concrete obligation inventories are equal', {
      suite: 'E3',
      fixedRevision: resolveCommit(fixedRevision),
      candidateCommit: resolveCommit(candidateSha),
      baselineProvenance: gitProvenance(resolveCommit(fixedRevision)),
      candidateProvenance: gitProvenance(candidateCommitFromRoot(candidateRoot)),
      baselineInventory,
      candidateInventory,
    });
  } finally {
    await rm(baseline, { recursive: true, force: true });
  }
}

function candidateCommitFromRoot(candidateRoot) {
  try {
    return gitAt(candidateRoot, ['rev-parse', 'HEAD']);
  } catch {
    return resolveCommit(candidateSha);
  }
}

function gitProvenance(commit) {
  return {
    commit,
    tree: git(['rev-parse', `${commit}^{tree}`]),
    files: ['Makefile', 'package.json', 'vitest.e2e.config.ts'].map((file) => ({
      file,
      blob: git(['rev-parse', `${commit}:${file}`]),
    })),
  };
}

async function buildInventory(repoRoot, sources) {
  const roots = workflowMakeRoots(sources);
  const semanticRoots = roots.length ? roots : [
    { job: 'deterministic-gates', target: 'ci', run: 'make ci' },
    { job: 'real-postgres', target: 'test-real-pg', run: 'make test-real-pg' },
  ];
  const targetGraph = targetPackageRoots(sources.makefile, semanticRoots);
  const packageRoots = targetGraph.packageRoots;
  const packageGraph = packageClosure(sources.packageJson, packageRoots);
  const names = new Set(packageGraph.scripts);
  if (!names.size) throw new Error('package closure is empty');
  const files = await trackedFiles(repoRoot);
  const include = [];
  const configFiles = [];
  for (const command of packageGraph.commands) {
    for (const match of command.command.matchAll(/(?:--config|--project|-p)\s+([^\s]+)/gu)) {
      configFiles.push(match[1]);
    }
  }
  const configText = await Promise.all([...new Set(configFiles)].map(async (file) => [file, await readMaybe(join(repoRoot, file))]));
  for (const [file, text] of configText) {
    if (text !== null) {
      const configCategory = configName(file);
      include.push(`config:${file}`);
      for (const match of text.matchAll(/include\s*:\s*\[([^\]]+)\]/gu)) {
        for (const item of match[1].matchAll(/['"]([^'"]+)['"]/gu)) {
          const pattern = item[1];
          const category = configCategory === 'web'
            ? (pattern.includes('.browser.') ? 'web-browser' : 'web-node')
            : configCategory;
          for (const leaf of expand(files, pattern)) {
            include.push(leaf === REQUIRED_LINEAGE_SOURCE ? REQUIRED_LINEAGE_ID : `${category}:${leaf}`);
          }
        }
      }
    }
  }
  const realPg = (sources.packageJson.scripts['test:real-pg'] ?? '').match(/tests\/[^\s]+/gu) ?? [];
  include.push(...realPg.map((file) => `real-pg:${file}`));
  return [...new Set(include)].sort();
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

async function trackedFiles(repoRoot) {
  const result = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) await walk(path);
      else result.push(relative(repoRoot, path));
    }
  };
  await walk(repoRoot);
  return result.sort();
}

function expand(files, pattern, extra = '') {
  const regex = globRegex(pattern);
  return files.filter((file) => regex.test(file) && (extra !== 'browser' || !file.includes('.browser.')));
}

function globRegex(pattern) {
  let expression = '';
  for (let index = 0; index < pattern.length;) {
    if (pattern.startsWith('**/', index)) {
      expression += '(?:.*/)?';
      index += 3;
    } else if (pattern.startsWith('**', index)) {
      expression += '.*';
      index += 2;
    } else if (pattern[index] === '*') {
      expression += '[^/]*';
      index += 1;
    } else if (pattern[index] === '{') {
      const end = pattern.indexOf('}', index);
      if (end > index) {
        expression += `(?:${pattern.slice(index + 1, end).split(',').map(escapeRegex).join('|')})`;
        index = end + 1;
      } else {
        expression += escapeRegex(pattern[index]);
        index += 1;
      }
    } else {
      expression += escapeRegex(pattern[index]);
      index += 1;
    }
  }
  return new RegExp(`^${expression}$`, 'u');
}

function escapeRegex(value) {
  return value.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
}

function configName(file) {
  if (file.includes('unit')) return 'unit';
  if (file.includes('contract')) return 'contract';
  if (file.includes('integration')) return 'integration';
  if (file.includes('e2e')) return 'e2e';
  if (file.includes('web')) return 'web';
  return 'config';
}

async function evaluateE8(candidateCommit, candidateRoot = root) {
  const baseline = resolveCommit(fixedRevision);
  const generatedFactsPath = join(candidateRoot, '.foundation-e8-baseline-facts.json');
  if (existsSync(generatedFactsPath)) {
    const supplied = JSON.parse(await readFile(generatedFactsPath, 'utf8'));
    const payload = JSON.stringify(supplied.facts);
    const digest = createHash('sha256').update(payload).digest('hex');
    if (digest !== supplied.digest || supplied.facts?.baseline !== baseline) {
      return status(2, 'generated baseline-consumer facts have invalid provenance', {
        suite: 'E8',
      });
    }
    if (!Array.isArray(supplied.facts.consumers) || supplied.facts.consumers.length !== 0) {
      return status(2, 'generated baseline-consumer facts are nonzero', {
        suite: 'E8',
        baselineConsumerCount: supplied.facts.consumers?.length,
      });
    }
  }
  if (!isAncestor(baseline, candidateCommit, candidateRoot)) return status(2, 'fixed baseline is not an ancestor of candidate', { suite: 'E8', baseline, candidate: candidateCommit });
  const baselineEntry = gitAt(root, ['ls-tree', '-r', baseline, '--', identityTarget]);
  const blob = baselineEntry.match(/^\d+\s+blob\s+([0-9a-f]{40})\s+(.+)$/u);
  if (!blob) return status(2, 'fixed baseline target blob is missing', { suite: 'E8', baseline, target: identityTarget });
  const tracked = gitAt(candidateRoot, ['ls-tree', '-r', '--name-only', candidateCommit]).split('\n').filter(Boolean).filter((file) => file !== identityTarget);
  if (!tracked.length) return status(2, 'tracked search universe is empty', { suite: 'E8' });
  const baselineConsumers = exactConsumers(baseline, root);
  if (baselineConsumers.length) {
    return status(2, 'fixed baseline has nonzero exact filename consumers', {
      suite: 'E8',
      baselineConsumers,
    });
  }
  const consumers = exactConsumers(candidateCommit, candidateRoot);
  if (consumers.length) return status(2, 'candidate has nonzero exact filename consumers', { suite: 'E8', consumers });
  if (gitExists(candidateCommit, identityTarget, candidateRoot)) return status(1, 'candidate identity checker target is present', { suite: 'E8', target: identityTarget });
  const deletion = gitAt(candidateRoot, ['diff', '--name-status', `${baseline}...${candidateCommit}`, '--', identityTarget]);
  if (deletion !== `D\t${identityTarget}`) return status(2, 'candidate deletion diff is not exact D', { suite: 'E8', deletion });
  return status(0, 'fixed Git object and candidate deletion proof passed', {
    suite: 'E8',
    baseline,
    candidate: candidateCommit,
    target: identityTarget,
    baselineBlob: blob[1],
    baselineBytes: Number(gitAt(root, ['cat-file', '-s', blob[1]])),
    trackedCount: tracked.length,
    baselineConsumers,
    consumers,
    deletion,
  });
}

function exactConsumers(commit, cwd) {
  try {
    return gitAt(cwd, ['grep', '-l', '--fixed-strings', identityBasename, commit, '--', `:${'!'}${identityTarget}`])
      .split('\n')
      .filter(Boolean)
      // The verifier necessarily mentions the deleted filename to prove its
      // absence; it is not a product consumer and is outside the obligation
      // search universe for this proof.
      .filter((entry) => !entry.endsWith(':scripts/foundation/phase-b.mjs') && entry !== 'scripts/foundation/phase-b.mjs')
      .map((entry) => entry.replace(/^[0-9a-f]{40}:/u, ''));
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function gitExists(commit, path, cwd = root) {
  try {
    gitAt(cwd, ['cat-file', '-e', `${commit}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(ancestor, descendant, cwd = root) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveCommit(revision) {
  return git(['rev-parse', '--verify', `${revision}^{commit}`]);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function gitShow(revision, path) {
  return execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'buffer' });
}

function gitAt(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function materialize(commit) {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'foundation-candidate-'));
  rmSyncDirectory(directory);
  execFileSync('git', ['clone', '--local', '--no-hardlinks', '--no-checkout', root, directory], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-C', directory, 'checkout', '--detach', commit], { cwd: root, stdio: 'ignore' });
  return directory;
}

async function materializeGitObjects(commit) {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'foundation-fixed-'));
  const files = gitAt(root, ['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean);
  for (const file of files) {
    const destination = join(directory, file);
    await mkdir(dirname(destination), { recursive: true });
    const content = execFileSync('git', ['show', `${commit}:${file}`], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    });
    await writeFile(destination, content);
  }
  return directory;
}

async function createMutation(suite, commit, mutation) {
  const directory = await materialize(commit);
  if (suite === 'E2' && mutation === 'add-setup') {
    await appendWorkflow(directory, 'candidate-deterministic', 'make setup');
  } else if (suite === 'E2' && mutation === 'restore-compose-and-check') {
    await replaceWorkflowRun(directory, 'candidate-deterministic', 'make check');
    await writeFile(join(directory, 'scripts/dev/docker-compose'), gitShow(fixedRevision, 'scripts/dev/docker-compose'));
  } else if (suite === 'E3' && mutation === 'remove-e2e-include') {
    const config = join(directory, 'vitest.e2e.config.ts');
    await writeFile(config, (await readFile(config, 'utf8')).replace("['e2e/**/*.test.ts']", "['e2e/run.e2e.test.ts']"));
  } else if (suite === 'E3' && mutation === 'bad-baseline-spec') {
    await writeFile(join(directory, 'baseline-source-spec.json'), JSON.stringify({ source: 'current-tree', revision: 'generated' }));
  } else if (suite === 'E8') {
    return createGitMutation(commit, mutation, directory);
  }
  return { root: directory, commit, cleanup: directory, digest: await treeDigest(directory) };
}

async function createGitMutation(commit, mutation, directory) {
  const repo = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'foundation-git-mutation-'));
  rmSyncDirectory(repo);
  execFileSync('git', ['clone', '--local', '--no-hardlinks', root, repo], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-C', repo, 'checkout', '--detach', commit], { cwd: root, stdio: 'ignore' });
  if (mutation === 'restore') {
    await mkdir(dirname(join(repo, identityTarget)), { recursive: true });
    await writeFile(join(repo, identityTarget), gitShow(fixedRevision, identityTarget));
  } else {
    const baseline = resolveCommit(fixedRevision);
    const entry = gitAt(root, ['ls-tree', '-r', baseline, '--', identityTarget]);
    const blob = entry.match(/^\d+\s+blob\s+([0-9a-f]{40})\s+/u)?.[1];
    const facts = {
      baseline,
      target: identityTarget,
      blob,
      trackedCount: gitAt(root, ['ls-tree', '-r', '--name-only', baseline]).split('\n').filter(Boolean).length,
      consumers: ['generated/nonzero-consumer.txt'],
    };
    await writeFile(
      join(repo, '.foundation-e8-baseline-facts.json'),
      `${JSON.stringify({
        facts,
        digest: createHash('sha256').update(JSON.stringify(facts)).digest('hex'),
      }, null, 2)}\n`,
    );
  }
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'foundation@example.invalid'], { cwd: root });
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Foundation verifier'], { cwd: root });
  execFileSync('git', ['-C', repo, 'add', '--all'], { cwd: root });
  execFileSync('git', ['-C', repo, 'commit', '-m', `foundation mutation ${mutation}`], { cwd: root, stdio: 'ignore' });
  const mutatedCommit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root: repo, commit: mutatedCommit, cleanup: repo, digest: await treeDigest(repo) };
}

function rmSyncDirectory(directory) {
  execFileSync('rm', ['-rf', directory], { cwd: root });
}

async function appendWorkflow(directory, job, command) {
  const path = join(directory, '.github/workflows/ci.yml');
  const text = await readFile(path, 'utf8');
  const marker = `  ${job}:`;
  const start = text.indexOf(marker);
  const nextMatch = text.slice(start + marker.length).match(/\n  [A-Za-z0-9_-]+:\s*$/mu);
  const next = nextMatch ? start + marker.length + nextMatch.index : -1;
  const block = text.slice(start, next === -1 ? text.length : next);
  const run = block.match(/^      - run: [^\n]+$/mu);
  if (!run) throw new Error(`workflow job ${job} has no run step`);
  const replaced = block.replace(run[0], `${run[0]}\n      - run: ${command}`);
  await writeFile(path, text.slice(0, start) + replaced + text.slice(next === -1 ? text.length : next));
}

async function replaceWorkflowRun(directory, job, command) {
  const path = join(directory, '.github/workflows/ci.yml');
  const text = await readFile(path, 'utf8');
  const marker = `  ${job}:`;
  const start = text.indexOf(marker);
  const nextMatch = text.slice(start + marker.length).match(/\n  [A-Za-z0-9_-]+:\s*$/mu);
  const next = nextMatch ? start + marker.length + nextMatch.index : -1;
  const block = text.slice(start, next === -1 ? text.length : next);
  const replaced = block.replace(/      - run: make [^\n]+/u, `      - run: ${command}`);
  await writeFile(path, text.slice(0, start) + replaced + text.slice(next === -1 ? text.length : next));
}

async function treeDigest(directory) {
  const hash = createHash('sha256');
  const files = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await walk(directory);
  files.sort();
  for (const file of files) {
    hash.update(relative(directory, file));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

async function readMaybe(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function recordResult(suite, mutation, result, commit, candidateRoot, candidateCommit, mutationDigest) {
  const directory = join(recordRoot, suite, mutation);
  await mkdir(directory, { recursive: true });
  const subprocess = result.subprocess ?? { argv: ['internal', suite], exit: result.code, raw: JSON.stringify(result) };
  const raw = subprocess.raw ?? '';
  const logPath = join(directory, 'raw.log');
  await writeFile(logPath, raw);
  const record = {
    suite,
    mutation,
    candidateSha: commit,
    candidateCommit,
    argv: subprocess.argv,
    rawExit: subprocess.exit,
    outcomeExit: result.code,
    logPath,
    logSha256: createHash('sha256').update(raw).digest('hex'),
    mutationDigest: mutationDigest ?? await treeDigest(candidateRoot),
    treeDigest: await treeDigest(candidateRoot),
    result,
  };
  await writeFile(join(directory, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
}
