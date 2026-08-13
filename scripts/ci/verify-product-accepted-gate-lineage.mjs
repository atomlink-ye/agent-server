#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCEPTED_MANIFEST_RELATIVE =
  'src/contracts/product-accepted-subset.v1.json';
const REPO_ROOT = resolve(
  fileURLToPath(new URL('../../', import.meta.url)),
);
const EXPECTED = {
  decisionSha256:
    '57dcebed4bceef04e03eb485679d610a15ce6510e490feacbfead4c966ef13fd',
  acceptedEvidenceSha256:
    '08bd91c7d3335eed051323f714435cd5e957558d80054ea5f8b3b87a8a982c1f',
  continuationSha256:
    'a92846444b09ffc869bdfbc1333effacc3affaf6ed68322b5afced83f8599893',
};
const SHA1 = /^[a-f0-9]{40}$/u;

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fail(message) {
  throw new Error(`accepted_gate_lineage_invalid:${message}`);
}

function equalValue(actual, expected, field) {
  if (canonical(actual) !== canonical(expected))
    fail(`evidence_mismatch:${field}`);
}

function requireSha(value, field) {
  if (typeof value !== 'string' || !SHA1.test(value))
    fail(`evidence_mismatch:${field}`);
  return value;
}

function requiredPath(name) {
  const value = process.env[name];
  if (!value) fail(`missing_env:${name}`);
  return value;
}

async function readEvidence(path, label) {
  try {
    return await readFile(path);
  } catch {
    fail(`evidence_missing:${label}:${path}`);
  }
}

function parseEvidence(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`evidence_invalid_json:${label}`);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function gitText(args) {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail(`git:${args.join(' ')}`);
  }
}

function gitBytes(args) {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    fail(`git:${args.join(' ')}`);
  }
}

function gitCommit(sha, field) {
  const resolved = gitText(['rev-parse', '--verify', `${sha}^{commit}`]);
  equalValue(resolved, sha, `${field}.sha`);
  const parents = gitText(['rev-list', '--parents', '-n', '1', sha]).split(/\s+/u);
  if (parents.shift() !== sha) fail(`evidence_mismatch:${field}.sha`);
  return {
    sha,
    parents,
    tree: gitText(['rev-parse', `${sha}^{tree}`]),
  };
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync(
      'git',
      ['-C', REPO_ROOT, 'merge-base', '--is-ancestor', ancestor, descendant],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

function verifyAcceptedLineage(value) {
  if (!isObject(value)) fail('evidence_mismatch:accepted.lineage');
  const preGate = requireSha(value.pre_gate_candidate_sha, 'accepted.lineage.pre_gate_candidate_sha');
  const sourceSha = requireSha(value.source_acceptance_sha, 'accepted.lineage.source_acceptance_sha');
  const sourceParent = requireSha(value.source_acceptance_parent_sha, 'accepted.lineage.source_acceptance_parent_sha');
  const sourceTree = requireSha(value.source_accepted_tree_sha, 'accepted.lineage.source_accepted_tree_sha');
  const squashSha = requireSha(value.squash_acceptance_sha, 'accepted.lineage.squash_acceptance_sha');
  const squashParent = requireSha(value.squash_parent_sha, 'accepted.lineage.squash_parent_sha');
  const squashTree = requireSha(value.squash_accepted_tree_sha, 'accepted.lineage.squash_accepted_tree_sha');
  equalValue(value.trees_equal, true, 'accepted.lineage.trees_equal');
  equalValue(
    value.squash_parent_semantics,
    'mainline_integration_parent_not_pre_gate_candidate',
    'accepted.lineage.squash_parent_semantics',
  );
  const source = gitCommit(sourceSha, 'accepted.lineage.source_acceptance');
  const squash = gitCommit(squashSha, 'accepted.lineage.squash_acceptance');
  gitCommit(preGate, 'accepted.lineage.pre_gate_candidate');
  equalValue(source.parents, [sourceParent], 'accepted.lineage.source_acceptance.parents');
  equalValue(squash.parents, [squashParent], 'accepted.lineage.squash_acceptance.parents');
  equalValue(source.tree, sourceTree, 'accepted.lineage.source_acceptance.tree');
  equalValue(squash.tree, squashTree, 'accepted.lineage.squash_acceptance.tree');
  equalValue(sourceTree, squashTree, 'accepted.lineage.trees_equal.value');
  equalValue(preGate, sourceParent, 'accepted.lineage.pre_gate_candidate.source_parent');
  return { ...value, sourceSha, squashSha };
}

function verifyContinuationLineage(value, acceptedLineage) {
  if (!isObject(value))
    fail('evidence_mismatch:continuation.lineage_interpretation');
  for (const field of [
    'pre_gate_candidate_sha',
    'source_acceptance_sha',
    'source_accepted_tree_sha',
    'squash_acceptance_sha',
    'squash_accepted_tree_sha',
  ]) {
    requireSha(value[field], `continuation.lineage_interpretation.${field}`);
    equalValue(
      value[field],
      acceptedLineage[field],
      `continuation.lineage_interpretation.${field}`,
    );
  }
}

function verifyFormatProvenance(value) {
  if (!isObject(value)) fail('evidence_mismatch:continuation.format_provenance');
  const formatSha = requireSha(value.commit, 'continuation.format_provenance.commit');
  const formatTree = requireSha(value.commit_tree, 'continuation.format_provenance.commit_tree');
  const regeneratedTree = requireSha(
    value.independently_regenerated_tree,
    'continuation.format_provenance.independently_regenerated_tree',
  );
  const candidateSha = requireSha(
    value.current_candidate_sha,
    'continuation.format_provenance.current_candidate_sha',
  );
  const candidateTree = requireSha(
    value.current_candidate_tree,
    'continuation.format_provenance.current_candidate_tree',
  );
  const format = gitCommit(formatSha, 'continuation.format_provenance.commit');
  const candidate = gitCommit(
    candidateSha,
    'continuation.format_provenance.current_candidate',
  );
  equalValue(format.tree, formatTree, 'continuation.format_provenance.commit_tree');
  equalValue(regeneratedTree, formatTree, 'continuation.format_provenance.independently_regenerated_tree');
  equalValue(candidate.tree, candidateTree, 'continuation.format_provenance.current_candidate_tree');
  equalValue(
    value.format_commit_is_candidate_ancestor,
    isAncestor(formatSha, candidateSha),
    'continuation.format_provenance.format_commit_is_candidate_ancestor',
  );
  const headSha = gitText(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!isAncestor(candidateSha, headSha))
    fail('current_head_does_not_continue_signed_candidate');
}

async function main() {
  const decisionPath = requiredPath('PRODUCT_ACCEPTED_DECISION_PATH');
  const acceptedPath = requiredPath('PRODUCT_ACCEPTED_EVIDENCE_PATH');
  const continuationPath = requiredPath('PRODUCT_ACCEPTED_CONTINUATION_PATH');
  const decisionBytes = await readEvidence(decisionPath, 'decision');
  const acceptedBytes = await readEvidence(acceptedPath, 'accepted');
  const continuationBytes = await readEvidence(continuationPath, 'continuation');
  equalValue(sha256(decisionBytes), EXPECTED.decisionSha256, 'decision.sha256');
  equalValue(sha256(acceptedBytes), EXPECTED.acceptedEvidenceSha256, 'accepted.sha256');
  equalValue(sha256(continuationBytes), EXPECTED.continuationSha256, 'continuation.sha256');

  const decision = parseEvidence(decisionBytes, 'decision');
  const accepted = parseEvidence(acceptedBytes, 'accepted');
  const continuation = parseEvidence(continuationBytes, 'continuation');
  if (!isObject(decision) || !isObject(accepted) || !isObject(continuation))
    fail('evidence_not_object');
  equalValue(decision.decision, 'ACCEPTED', 'decision.decision');
  equalValue(accepted.decision, 'ACCEPTED', 'accepted.decision');
  equalValue(continuation.decision, 'ACCEPTED_CONTINUES_WITHOUT_SEMANTIC_CHANGE', 'continuation.decision');
  const acceptedLineage = verifyAcceptedLineage(accepted.lineage);
  equalValue(decision.candidate_sha, acceptedLineage.pre_gate_candidate_sha, 'decision.candidate_sha.lineage');
  verifyContinuationLineage(continuation.lineage_interpretation, acceptedLineage);
  verifyFormatProvenance(continuation.format_provenance);

  const artifacts = accepted.artifacts;
  if (!Array.isArray(artifacts)) fail('evidence_mismatch:accepted.artifacts');
  const artifactHashes = new Map();
  for (const artifact of artifacts) {
    if (!isObject(artifact) || typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string')
      fail('evidence_mismatch:accepted.artifacts.entry');
    artifactHashes.set(artifact.path, artifact.sha256);
  }
  const continuationManifest = continuation.manifest;
  if (!isObject(continuationManifest)) fail('evidence_mismatch:continuation.manifest');
  const acceptedManifestBytes = gitBytes([
    'show',
    `${acceptedLineage.squashSha}:${ACCEPTED_MANIFEST_RELATIVE}`,
  ]);
  const acceptedManifest = parseEvidence(acceptedManifestBytes, 'accepted_manifest');
  equalValue(
    artifactHashes.get(ACCEPTED_MANIFEST_RELATIVE),
    sha256(acceptedManifestBytes),
    'accepted.artifacts.manifest',
  );
  equalValue(
    continuationManifest.accepted_raw_sha256,
    sha256(acceptedManifestBytes),
    'continuation.manifest.accepted_raw_sha256',
  );
  equalValue(
    continuationManifest.accepted_canonical_jq_S_c_sha256,
    sha256(Buffer.from(`${canonical(acceptedManifest)}\n`, 'utf8')),
    'continuation.manifest.accepted_canonical_sha256',
  );
  process.stdout.write('accepted_gate_lineage_ok\n');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
