#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ACCEPTED_MANIFEST = 'src/contracts/product-accepted-subset.v1.json';
const SOURCE_ACCEPTANCE = '5866962675a39791d0a8ac8a2b93e0868dd69345';
const SQUASH_ACCEPTANCE = '7731af29cd127dd09583da30ef183c8b5015815c';
const FORMAT_COMMIT = 'bda00cc0db719f14917e8753e5a762ce34008cb0';
const CURRENT_CANDIDATE = '86bb425033978e312dc3583e0d8e20264e4b7cbe';

function usage() {
  throw new Error(
    'usage: generate-product-accepted-git-facts.mjs --repo <git-repo> --output <path>',
  );
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== '--repo' || argv[2] !== '--output')
    usage();
  if (!argv[1] || !argv[3] || argv[1].startsWith('--') || argv[3].startsWith('--'))
    usage();
  return { repo: resolve(argv[1]), output: resolve(argv[3]) };
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitBytes(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parents(repo, sha) {
  const values = git(repo, ['rev-list', '--parents', '-n', '1', sha]).split(/\s+/u);
  if (values.shift() !== sha || values.length === 0) throw new Error(`git_fact_invalid_parents:${sha}`);
  return values;
}

function commit(repo, sha) {
  const commitSha = git(repo, ['rev-parse', '--verify', `${sha}^{commit}`]);
  const tree = git(repo, ['rev-parse', `${sha}^{tree}`]);
  return { sha: commitSha, parents: parents(repo, sha), tree };
}

function isAncestor(repo, ancestor, descendant) {
  try {
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function main(argv) {
  const { repo, output } = parseArgs(argv);
  const sourceAcceptance = commit(repo, SOURCE_ACCEPTANCE);
  const squashAcceptance = commit(repo, SQUASH_ACCEPTANCE);
  const format = commit(repo, FORMAT_COMMIT);
  const currentCandidate = commit(repo, CURRENT_CANDIDATE);
  const headSha = git(repo, ['rev-parse', 'HEAD']);
  const head = commit(repo, headSha);
  const acceptedManifest = gitBytes(repo, [
    'show',
    `${SQUASH_ACCEPTANCE}:${ACCEPTED_MANIFEST}`,
  ]);
  const acceptedValue = JSON.parse(acceptedManifest.toString('utf8'));
  const facts = {
    schema: 'product-accepted-subset-git-facts.v1',
    commits: { sourceAcceptance, squashAcceptance, format, currentCandidate, head },
    ancestry: {
      squashAcceptanceIsAncestorOfHead: isAncestor(repo, SQUASH_ACCEPTANCE, headSha),
      formatIsAncestorOfCurrentCandidate: isAncestor(repo, FORMAT_COMMIT, CURRENT_CANDIDATE),
      currentCandidateIsAncestorOfHead: isAncestor(repo, CURRENT_CANDIDATE, headSha),
    },
    sourceSquashTreesEqual: sourceAcceptance.tree === squashAcceptance.tree,
    artifacts: {
      candidateSha: currentCandidate.sha,
      candidateTreeSha: currentCandidate.tree,
      headSha: head.sha,
      headTreeSha: head.tree,
    },
    acceptedManifest: {
      path: ACCEPTED_MANIFEST,
      raw: acceptedManifest.toString('utf8'),
      rawSha256: sha256(acceptedManifest),
      canonicalSha256: sha256(Buffer.from(`${canonical(acceptedValue)}\n`, 'utf8')),
    },
  };
  writeFileSync(output, `${JSON.stringify(facts, null, 2)}\n`, 'utf8');
  console.log(`wrote=${output}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
