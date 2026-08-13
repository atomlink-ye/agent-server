#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format as formatWithPrettier } from 'prettier';
import { z } from 'zod';

import { PRODUCT_CONTRACT_STATUS } from '../../src/contracts/product-contract-policy.js';
import {
  PRODUCT_ACCEPTED_SUBSET_READ_ENDPOINTS,
  type AcceptedEndpoint,
} from '../../src/contracts/product-accepted-subset/read.js';

const SIGNED_MANIFEST = resolve(
  fileURLToPath(
    new URL(
      '../../src/contracts/product-accepted-subset.v1.json',
      import.meta.url,
    ),
  ),
);

const ACCEPTED_FACTS = {
  decisionSha256:
    '57dcebed4bceef04e03eb485679d610a15ce6510e490feacbfead4c966ef13fd',
  acceptedEvidenceSha256:
    '08bd91c7d3335eed051323f714435cd5e957558d80054ea5f8b3b87a8a982c1f',
  sourceAcceptanceSha:
    '5866962675a39791d0a8ac8a2b93e0868dd69345',
  sourceAcceptanceParentSha:
    'a1d6351c2c8a69a36d52e8b2fb27c654cbe570b7',
  acceptedTreeSha: '3ac6f4812130e6694f209fb64650f0baaee6f1c9',
  squashAcceptanceSha:
    '7731af29cd127dd09583da30ef183c8b5015815c',
  squashParentSha:
    '26406954f548878d8757054bde5db71814fe6a30',
  formatCommitSha:
    'bda00cc0db719f14917e8753e5a762ce34008cb0',
  formatCommitParentSha:
    '9b2042aa352f60163558cc76db500ce8ca98dcde',
  formatCommitTreeSha: 'bdae0757937f0923ca655e892fd85eaf0caca4f2',
  currentCandidateSha:
    '86bb425033978e312dc3583e0d8e20264e4b7cbe',
  currentCandidateParentSha:
    '105b16ff4323dee2fc14feca855ecdb7dac1151a',
  currentCandidateTreeSha:
    '63b8d465844dea1a5cfddad58d1abe42d15f1e85',
  headSha: '28a219ef233367d3a195bc1f7a805b28b2dc04c4',
  headTreeSha: '0c5946cbae9bab3cc306077a9208ad1ef7480df7',
  headParentSha:
    '86bb425033978e312dc3583e0d8e20264e4b7cbe',
  checkerSha256:
    '6a55a2d4c6bfe963e5b54c1d7007f600d429a15537237d88fb6421081e9ff257',
  manifestAcceptedRawSha256:
    '9b082f1c016cbf2c66bac18913c5278a179b109de541b8ac90dcd2e3cb0c1738',
  manifestAcceptedCanonicalSha256:
    'ec942c3f9b87bd57faa8ba5611a5515478be33cdd73295feed01f734ebd42aba',
  manifestCurrentRawSha256:
    '9717970c65f330b31e0a6507a6abb0922dd8baeabdbaa7efc2ef40f8dd63e420',
} as const;

const ACCEPTED_MANIFEST_RELATIVE =
  'src/contracts/product-accepted-subset.v1.json';

type EvidencePaths = {
  readonly decision: string;
  readonly accepted: string;
  readonly continuation: string;
};

type CliOptions = {
  readonly mode: 'write' | 'check';
  readonly output?: string;
  readonly manifest: string;
  readonly gitFacts?: string;
  readonly evidence?: EvidencePaths;
};

type ManifestEndpoint = Omit<AcceptedEndpoint, 'responseSchema'> & {
  readonly schema_sha256: string;
};

type CapabilityStatus = {
  readonly id: string;
  readonly availability: 'available' | 'explicitly_unavailable';
};

type Manifest = {
  readonly api_major: 'v1';
  readonly accepted_revision: 1;
  readonly status: 'provisional' | 'accepted';
  readonly headers: {
    readonly revision: 'Product-Contract-Revision';
    readonly status: 'Product-Contract-Status';
  };
  readonly owner_scope: readonly ['tenant_id', 'workspace_id'];
  readonly capability_status: readonly CapabilityStatus[];
  readonly endpoints: readonly ManifestEndpoint[];
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const canonicalBytes = (value: unknown): Buffer =>
  Buffer.from(`${canonical(value)}\n`, 'utf8');

function schemaHash(schema: z.ZodType): string {
  return createHash('sha256')
    .update(canonical(z.toJSONSchema(schema)), 'utf8')
    .digest('hex');
}

function sortedEndpoint(endpoint: ManifestEndpoint): ManifestEndpoint {
  return {
    ...endpoint,
    success: [...endpoint.success].sort(
      (a, b) => a.status - b.status || a.variant.localeCompare(b.variant),
    ),
    errors: [...endpoint.errors].sort(
      (a, b) => a.status - b.status || a.code.localeCompare(b.code),
    ),
    capabilities: [...endpoint.capabilities].sort(),
  };
}

function sortedCapabilityStatus(
  capability: CapabilityStatus,
): CapabilityStatus {
  return { id: capability.id, availability: capability.availability };
}

function capabilityStatuses(
  endpoints: readonly ManifestEndpoint[],
  controls: readonly CapabilityStatus[],
): CapabilityStatus[] {
  const statuses = new Map<string, CapabilityStatus>();
  for (const capability of endpoints.flatMap(
    (endpoint) => endpoint.capabilities,
  )) {
    const existing = statuses.get(capability);
    if (existing && existing.availability !== 'available')
      fail(`capability_conflict:${capability}`);
    statuses.set(capability, { id: capability, availability: 'available' });
  }
  for (const capability of controls) {
    if (
      !capability ||
      typeof capability.id !== 'string' ||
      !capability.id ||
      (capability.availability !== 'available' &&
        capability.availability !== 'explicitly_unavailable')
    )
      fail('capability_status');
    const existing = statuses.get(capability.id);
    if (existing && existing.availability !== capability.availability)
      fail(`capability_conflict:${capability.id}`);
    statuses.set(capability.id, sortedCapabilityStatus(capability));
  }
  return [...statuses.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function loadFragments(): Promise<{
  readonly endpoints: ManifestEndpoint[];
  readonly controls: CapabilityStatus[];
}> {
  const endpoints = PRODUCT_ACCEPTED_SUBSET_READ_ENDPOINTS.map((endpoint) => ({
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    request_schema: endpoint.request_schema,
    response_schema: endpoint.response_schema,
    success: endpoint.success,
    errors: endpoint.errors,
    capabilities: endpoint.capabilities,
    schema_sha256: schemaHash(endpoint.responseSchema),
  }));
  const controlsPath = resolve(
    fileURLToPath(
      new URL(
        '../../src/contracts/product-accepted-subset/controls.ts',
        import.meta.url,
      ),
    ),
  );
  const controlCapabilities: CapabilityStatus[] = [];
  try {
    await access(controlsPath);
    const module = (await import(pathToFileURL(controlsPath).href)) as {
      PRODUCT_ACCEPTED_SUBSET_CONTROL_ENDPOINTS?: readonly AcceptedEndpoint[];
      PRODUCT_ACCEPTED_SUBSET_CONTROL_CAPABILITIES?: readonly CapabilityStatus[];
    };
    controlCapabilities.push(
      ...(module.PRODUCT_ACCEPTED_SUBSET_CONTROL_CAPABILITIES ?? []),
    );
    for (const endpoint of module.PRODUCT_ACCEPTED_SUBSET_CONTROL_ENDPOINTS ??
      [])
      endpoints.push({
        id: endpoint.id,
        method: endpoint.method,
        path: endpoint.path,
        request_schema: endpoint.request_schema,
        response_schema: endpoint.response_schema,
        success: endpoint.success,
        errors: endpoint.errors,
        capabilities: endpoint.capabilities,
        schema_sha256: schemaHash(endpoint.responseSchema),
      });
  } catch {
    // Controls are an independent lane and are absent until its go/no-go branch.
  }
  return {
    endpoints: endpoints
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(sortedEndpoint),
    controls: controlCapabilities,
  };
}

export async function buildManifest(): Promise<Manifest> {
  const fragments = await loadFragments();
  return {
    api_major: 'v1',
    accepted_revision: 1,
    status: PRODUCT_CONTRACT_STATUS,
    headers: {
      revision: 'Product-Contract-Revision',
      status: 'Product-Contract-Status',
    },
    owner_scope: ['tenant_id', 'workspace_id'],
    capability_status: capabilityStatuses(
      fragments.endpoints,
      fragments.controls,
    ),
    endpoints: fragments.endpoints,
  };
}

function fail(message: string): never {
  throw new Error(`accepted_subset_invalid:${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function equalValue(actual: unknown, expected: unknown, field: string): void {
  if (canonical(actual) !== canonical(expected))
    fail(`evidence_mismatch:${field}`);
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(path: string, label: string): Promise<unknown> {
  let bytes: string;
  try {
    bytes = await readFile(path, 'utf8');
  } catch {
    fail(`evidence_missing:${label}:${path}`);
  }
  try {
    return JSON.parse(bytes!);
  } catch {
    fail(`evidence_invalid_json:${label}:${path}`);
  }
}

function verifyGitFacts(value: unknown): void {
  if (!isObject(value)) fail('git_facts_invalid');
  equalValue(
    value.schema,
    'product-accepted-subset-git-facts.v1',
    'git_facts.schema',
  );
  const commits = value.commits;
  if (!isObject(commits)) fail('git_facts.commits_missing');
  equalValue(
    commits,
    {
      sourceAcceptance: {
        sha: ACCEPTED_FACTS.sourceAcceptanceSha,
        parents: [ACCEPTED_FACTS.sourceAcceptanceParentSha],
        tree: ACCEPTED_FACTS.acceptedTreeSha,
      },
      squashAcceptance: {
        sha: ACCEPTED_FACTS.squashAcceptanceSha,
        parents: [ACCEPTED_FACTS.squashParentSha],
        tree: ACCEPTED_FACTS.acceptedTreeSha,
      },
      format: {
        sha: ACCEPTED_FACTS.formatCommitSha,
        parents: [ACCEPTED_FACTS.formatCommitParentSha],
        tree: ACCEPTED_FACTS.formatCommitTreeSha,
      },
      currentCandidate: {
        sha: ACCEPTED_FACTS.currentCandidateSha,
        parents: [ACCEPTED_FACTS.currentCandidateParentSha],
        tree: ACCEPTED_FACTS.currentCandidateTreeSha,
      },
      head: {
        sha: ACCEPTED_FACTS.headSha,
        parents: [ACCEPTED_FACTS.headParentSha],
        tree: ACCEPTED_FACTS.headTreeSha,
      },
    },
    'git_facts.commits',
  );
  equalValue(
    value.ancestry,
    {
      squashAcceptanceIsAncestorOfHead: true,
      formatIsAncestorOfCurrentCandidate: true,
      currentCandidateIsAncestorOfHead: true,
    },
    'git_facts.ancestry',
  );
  equalValue(
    value.sourceSquashTreesEqual,
    true,
    'git_facts.source_squash_trees_equal',
  );
  equalValue(
    value.artifacts,
    {
      candidateSha: ACCEPTED_FACTS.currentCandidateSha,
      candidateTreeSha: ACCEPTED_FACTS.currentCandidateTreeSha,
      headSha: ACCEPTED_FACTS.headSha,
      headTreeSha: ACCEPTED_FACTS.headTreeSha,
    },
    'git_facts.artifacts',
  );
  const acceptedManifest = value.acceptedManifest;
  if (!isObject(acceptedManifest))
    fail('git_facts.accepted_manifest_missing');
  equalValue(
    acceptedManifest.path,
    ACCEPTED_MANIFEST_RELATIVE,
    'git_facts.accepted_manifest.path',
  );
  equalValue(
    acceptedManifest.rawSha256,
    ACCEPTED_FACTS.manifestAcceptedRawSha256,
    'git_facts.accepted_manifest.raw_sha256',
  );
  equalValue(
    acceptedManifest.canonicalSha256,
    ACCEPTED_FACTS.manifestAcceptedCanonicalSha256,
    'git_facts.accepted_manifest.canonical_sha256',
  );
}

async function verifyAcceptedEvidence(
  paths: EvidencePaths,
  expected: Manifest,
  manifestPath: string,
  gitFactsPath: string,
): Promise<void> {
  equalValue(expected.status, 'accepted', 'generated.status');
  equalValue(expected.api_major, 'v1', 'generated.api_major');
  equalValue(expected.accepted_revision, 1, 'generated.accepted_revision');
  equalValue(expected.endpoints.length, 8, 'generated.endpoint_count');
  equalValue(expected.owner_scope, ['tenant_id', 'workspace_id'], 'generated.owner_scope');
  const gitFacts = await readJson(gitFactsPath, 'git_facts');
  verifyGitFacts(gitFacts);
  const decision = await readJson(paths.decision, 'decision');
  const accepted = await readJson(paths.accepted, 'accepted');
  const continuation = await readJson(paths.continuation, 'continuation');
  if (!isObject(decision) || !isObject(accepted) || !isObject(continuation))
    fail('evidence_not_object');

  equalValue(decision.decision, 'ACCEPTED', 'decision.decision');
  equalValue(decision.decided_by, 'Manager (Claude Code), under Owner delegated authority', 'decision.decided_by');
  equalValue(decision.decided_at, '2026-08-13', 'decision.decided_at');
  equalValue(decision.supersedes, '2026-08-12 PROVISIONAL decision (same file, earlier revision)', 'decision.supersedes');
  equalValue(decision.candidate_sha, 'a1d6351c2c8a69a36d52e8b2fb27c654cbe570b7', 'decision.candidate_sha');
  equalValue(decision.gate_result, { pass: 14, fail: 0, miss: 0, exit_code: 0 }, 'decision.gate_result');
  const decisionScope = decision.scope;
  if (!isObject(decisionScope)) fail('evidence_mismatch:decision.scope');
  equalValue(decisionScope.authority, 'Owner Scope Gate 2026-08-13 (LANE-STATE 第二十八节)', 'decision.scope.authority');
  equalValue(
    decisionScope.revision,
    'Product API v1 Revision 1 = read-only accepted subset',
    'decision.scope.revision',
  );
  equalValue(decisionScope.controls, 'cancel_work_run / decide_completion 保持 explicitly_unavailable，后续以 additive capability 加入', 'decision.scope.controls');
  equalValue(decisionScope.trace, '接受 timeline_coverage=mcp_only 为能力边界；前端必须展示 coverage，不得表现为 full trace', 'decision.scope.trace');
  equalValue(sha256(await readFile(paths.decision)), ACCEPTED_FACTS.decisionSha256, 'decision.sha256');

  equalValue(accepted.schema_version, 1, 'accepted.schema_version');
  equalValue(accepted.kind, 'product_contract_acceptance_supplement', 'accepted.kind');
  equalValue(accepted.decision, 'ACCEPTED', 'accepted.decision');
  const acceptedSigner = accepted.signer;
  if (!isObject(acceptedSigner)) fail('evidence_mismatch:accepted.signer');
  equalValue(acceptedSigner.role, 'Manager B', 'accepted.signer.role');
  equalValue(acceptedSigner.agent_id, '7e2f4c22-02a6-4c74-8751-2a7a60d72a2e', 'accepted.signer.agent_id');
  equalValue(acceptedSigner.authority, 'authority/DECISIONS.md#D21', 'accepted.signer.authority');
  const supplements = accepted.supplements;
  if (!isObject(supplements)) fail('evidence_mismatch:accepted.supplements');
  equalValue(supplements.path, 'evidence/human-gate-decision.json', 'accepted.supplements.path');
  equalValue(supplements.sha256, ACCEPTED_FACTS.decisionSha256, 'accepted.supplements.sha256');
  equalValue(sha256(await readFile(paths.decision)), supplements.sha256, 'accepted.supplements.decision_hash');
  equalValue(await readFile(paths.accepted).then(sha256), ACCEPTED_FACTS.acceptedEvidenceSha256, 'accepted.sha256');

  const contract = accepted.contract;
  if (!isObject(contract)) fail('evidence_mismatch:accepted.contract');
  equalValue(contract, {
    status: 'accepted',
    api_major: 'v1',
    accepted_revision: 1,
    endpoint_count: 8,
    owner_scope: ['tenant_id', 'workspace_id'],
  }, 'accepted.contract');
  equalValue(accepted.gate_result, { pass: 14, fail: 0, miss: 0, exit_code: 0, source: 'evidence/human-gate-decision.json' }, 'accepted.gate_result');

  const artifacts = accepted.artifacts;
  if (!Array.isArray(artifacts)) fail('evidence_mismatch:accepted.artifacts');
  const artifactHashes = new Map<string, string>();
  for (const artifact of artifacts) {
    if (!isObject(artifact) || typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string')
      fail('evidence_mismatch:accepted.artifacts.entry');
    artifactHashes.set(artifact.path, artifact.sha256);
  }
  equalValue(artifactHashes.get('scripts/ci/check-product-accepted-subset.ts'), ACCEPTED_FACTS.checkerSha256, 'accepted.artifacts.checker');
  equalValue(artifactHashes.get('src/contracts/product-accepted-subset.v1.json'), ACCEPTED_FACTS.manifestAcceptedRawSha256, 'accepted.artifacts.manifest');
  const policyPath = resolve(
    fileURLToPath(
      new URL('../../src/contracts/product-contract-policy.ts', import.meta.url),
    ),
  );
  const policyBytes = await readFile(policyPath);
  equalValue(artifactHashes.get('src/contracts/product-contract-policy.ts'), sha256(policyBytes), 'accepted.artifacts.policy');

  const lineage = accepted.lineage;
  if (!isObject(lineage)) fail('evidence_mismatch:accepted.lineage');
  equalValue(lineage, {
    pre_gate_candidate_sha: 'a1d6351c2c8a69a36d52e8b2fb27c654cbe570b7',
    source_acceptance_sha: ACCEPTED_FACTS.sourceAcceptanceSha,
    source_acceptance_parent_sha: ACCEPTED_FACTS.sourceAcceptanceParentSha,
    source_accepted_tree_sha: ACCEPTED_FACTS.acceptedTreeSha,
    squash_acceptance_sha: ACCEPTED_FACTS.squashAcceptanceSha,
    squash_parent_sha: ACCEPTED_FACTS.squashParentSha,
    squash_accepted_tree_sha: ACCEPTED_FACTS.acceptedTreeSha,
    trees_equal: true,
    squash_parent_semantics: 'mainline_integration_parent_not_pre_gate_candidate',
  }, 'accepted.lineage');

  equalValue(continuation.schema_version, 1, 'continuation.schema_version');
  equalValue(continuation.kind, 'product_contract_acceptance_format_continuation', 'continuation.kind');
  equalValue(continuation.decision, 'ACCEPTED_CONTINUES_WITHOUT_SEMANTIC_CHANGE', 'continuation.decision');
  const continuationSigner = continuation.signer;
  if (!isObject(continuationSigner)) fail('evidence_mismatch:continuation.signer');
  equalValue(continuationSigner.role, 'Manager B', 'continuation.signer.role');
  equalValue(continuationSigner.agent_id, '7e2f4c22-02a6-4c74-8751-2a7a60d72a2e', 'continuation.signer.agent_id');
  equalValue(continuationSigner.authority, 'authority/DECISIONS.md#D21', 'continuation.signer.authority');

  const previous = continuation.previous_evidence;
  if (!isObject(previous)) fail('evidence_mismatch:continuation.previous_evidence');
  equalValue(previous.path, 'rounds/2026-08-12-product-api-v1-protect-acceptance/evidence/human-gate-product-contract-accepted.json', 'continuation.previous_evidence.path');
  equalValue(previous.sha256, ACCEPTED_FACTS.acceptedEvidenceSha256, 'continuation.previous_evidence.sha256');
  equalValue(await readFile(paths.accepted).then(sha256), previous.sha256, 'continuation.previous_evidence.current_hash');
  equalValue(previous.decision, 'ACCEPTED', 'continuation.previous_evidence.decision');
  equalValue(previous.accepted_revision, 1, 'continuation.previous_evidence.accepted_revision');
  equalValue(previous.endpoint_count, 8, 'continuation.previous_evidence.endpoint_count');

  const continuationManifest = continuation.manifest;
  if (!isObject(continuationManifest)) fail('evidence_mismatch:continuation.manifest');
  const currentBytes = await readFile(manifestPath);
  const current = JSON.parse(currentBytes.toString('utf8')) as unknown;
  const acceptedManifestFacts = (gitFacts as Record<string, unknown>)
    .acceptedManifest as Record<string, unknown>;
  if (typeof acceptedManifestFacts.raw !== 'string')
    fail('git_facts.accepted_manifest.raw_missing');
  const acceptedBytes = Buffer.from(acceptedManifestFacts.raw, 'utf8');
  const acceptedManifest = JSON.parse(acceptedBytes.toString('utf8')) as unknown;
  validateManifest(acceptedManifest, { allowAccepted: true });
  validateManifest(current, { allowAccepted: true });
  equalValue(continuationManifest.path, ACCEPTED_MANIFEST_RELATIVE, 'continuation.manifest.path');
  equalValue(sha256(acceptedBytes), acceptedManifestFacts.rawSha256, 'git_facts.accepted_manifest.raw_sha256');
  equalValue(sha256(canonicalBytes(acceptedManifest)), acceptedManifestFacts.canonicalSha256, 'git_facts.accepted_manifest.canonical_sha256');
  equalValue(acceptedManifestFacts.rawSha256, continuationManifest.accepted_raw_sha256, 'manifest.accepted_raw_sha256');
  equalValue(sha256(currentBytes), continuationManifest.current_raw_sha256, 'manifest.current_raw_sha256');
  equalValue(acceptedManifestFacts.rawSha256, ACCEPTED_FACTS.manifestAcceptedRawSha256, 'manifest.accepted_raw_sha256.authority');
  equalValue(sha256(currentBytes), ACCEPTED_FACTS.manifestCurrentRawSha256, 'manifest.current_raw_sha256.authority');
  equalValue(acceptedManifestFacts.canonicalSha256, continuationManifest.accepted_canonical_jq_S_c_sha256, 'manifest.accepted_canonical_sha256');
  equalValue(sha256(canonicalBytes(current)), continuationManifest.current_canonical_jq_S_c_sha256, 'manifest.current_canonical_sha256');
  equalValue(continuationManifest.accepted_canonical_jq_S_c_sha256, ACCEPTED_FACTS.manifestAcceptedCanonicalSha256, 'manifest.accepted_canonical_sha256.authority');
  equalValue(continuationManifest.current_canonical_jq_S_c_sha256, ACCEPTED_FACTS.manifestAcceptedCanonicalSha256, 'manifest.current_canonical_sha256.authority');
  equalValue(continuationManifest.canonical_equal, true, 'manifest.canonical_equal');
  equalValue(continuationManifest.status, 'accepted', 'manifest.status');
  equalValue(continuationManifest.api_major, 'v1', 'manifest.api_major');
  equalValue(continuationManifest.accepted_revision, 1, 'manifest.accepted_revision');
  equalValue(continuationManifest.endpoint_count, 8, 'manifest.endpoint_count');
  equalValue(continuationManifest.owner_scope, ['tenant_id', 'workspace_id'], 'manifest.owner_scope');
  equalValue(continuationManifest.semantic_change, false, 'manifest.semantic_change');
  equalValue(canonical(current), canonical(expected), 'manifest.current_contract');
  equalValue(canonical(acceptedManifest), canonical(expected), 'manifest.accepted_contract');

  const continuationLineage = continuation.lineage_interpretation;
  if (!isObject(continuationLineage)) fail('evidence_mismatch:continuation.lineage_interpretation');
  equalValue(continuationLineage.pre_gate_candidate_sha, 'a1d6351c2c8a69a36d52e8b2fb27c654cbe570b7', 'continuation.lineage.pre_gate_candidate_sha');
  equalValue(continuationLineage.source_acceptance_sha, ACCEPTED_FACTS.sourceAcceptanceSha, 'continuation.lineage.source_acceptance_sha');
  equalValue(continuationLineage.source_accepted_tree_sha, ACCEPTED_FACTS.acceptedTreeSha, 'continuation.lineage.source_accepted_tree_sha');
  equalValue(continuationLineage.squash_acceptance_sha, ACCEPTED_FACTS.squashAcceptanceSha, 'continuation.lineage.squash_acceptance_sha');
  equalValue(continuationLineage.squash_accepted_tree_sha, ACCEPTED_FACTS.acceptedTreeSha, 'continuation.lineage.squash_accepted_tree_sha');

  const formatProvenance = continuation.format_provenance;
  if (!isObject(formatProvenance)) fail('evidence_mismatch:continuation.format_provenance');
  equalValue(formatProvenance.commit, ACCEPTED_FACTS.formatCommitSha, 'continuation.format_provenance.commit');
  equalValue(formatProvenance.commit_tree, ACCEPTED_FACTS.formatCommitTreeSha, 'continuation.format_provenance.commit_tree');
  equalValue(formatProvenance.independently_regenerated_tree, ACCEPTED_FACTS.formatCommitTreeSha, 'continuation.format_provenance.independently_regenerated_tree');
  equalValue(formatProvenance.current_candidate_sha, ACCEPTED_FACTS.currentCandidateSha, 'continuation.format_provenance.current_candidate_sha');
  equalValue(formatProvenance.current_candidate_tree, ACCEPTED_FACTS.currentCandidateTreeSha, 'continuation.format_provenance.current_candidate_tree');
  equalValue(formatProvenance.format_commit_is_candidate_ancestor, true, 'continuation.format_provenance.format_commit_is_candidate_ancestor');
}

export function validateManifest(
  manifest: unknown,
  options: { readonly allowAccepted?: boolean } = {},
): asserts manifest is Manifest {
  if (!manifest || typeof manifest !== 'object') fail('not_object');
  const value = manifest as Partial<Manifest>;
  if (value.api_major !== 'v1') fail('api_major');
  if (value.accepted_revision !== 1) fail('accepted_revision');
  if (value.status !== 'provisional' && value.status !== 'accepted')
    fail('status');
  if (value.status === 'accepted' && !options.allowAccepted)
    fail('human_gate_required');
  if (
    JSON.stringify(value.owner_scope) !==
    JSON.stringify(['tenant_id', 'workspace_id'])
  )
    fail('owner_scope');
  if (!Array.isArray(value.capability_status)) fail('capability_status');
  let previousCapability = '';
  const capabilityIds = new Set<string>();
  for (const capability of value.capability_status) {
    if (!capability || typeof capability !== 'object')
      fail('capability_status_entry');
    const current = capability as CapabilityStatus;
    if (
      typeof current.id !== 'string' ||
      !current.id ||
      (current.availability !== 'available' &&
        current.availability !== 'explicitly_unavailable')
    )
      fail('capability_status_value');
    if (current.id <= previousCapability) fail('capability_status_order');
    if (capabilityIds.has(current.id))
      fail(`capability_status_duplicate:${current.id}`);
    capabilityIds.add(current.id);
    previousCapability = current.id;
  }
  if (
    JSON.stringify(value.headers) !==
    JSON.stringify({
      revision: 'Product-Contract-Revision',
      status: 'Product-Contract-Status',
    })
  )
    fail('headers');
  if (!Array.isArray(value.endpoints) || value.endpoints.length === 0)
    fail('endpoints');
  const seen = new Set<string>();
  let previous = '';
  for (const endpoint of value.endpoints) {
    if (!endpoint || typeof endpoint !== 'object') fail('endpoint_object');
    const current = endpoint as ManifestEndpoint;
    const key = `${current.method} ${current.path}`;
    if (seen.has(key)) fail(`duplicate:${key}`);
    seen.add(key);
    if (current.id <= previous) fail('endpoint_order');
    previous = current.id;
    if (!/^[a-f0-9]{64}$/u.test(current.schema_sha256))
      fail(`schema_hash:${current.id}`);
    if (
      !Array.isArray(current.success) ||
      !Array.isArray(current.errors) ||
      !Array.isArray(current.capabilities)
    )
      fail(`arrays:${current.id}`);
    const errors = current.errors.map((item) => `${item.status}:${item.code}`);
    if (errors.some((item, index) => index > 0 && item < errors[index - 1]!))
      fail(`error_order:${current.id}`);
    const capabilities = [...current.capabilities];
    if (
      capabilities.some(
        (item, index) => index > 0 && item <= capabilities[index - 1]!,
      )
    )
      fail(`capability_order:${current.id}`);
  }
}

function optionValue(
  argv: readonly string[],
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index >= 0) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(`missing_option_value:${name}`);
      return value;
    }
  }
  return undefined;
}

function parseOptions(argv: readonly string[]): CliOptions {
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  if ((write ? 1 : 0) + (check ? 1 : 0) !== 1)
    fail('usage: choose exactly one of --write or --check');
  const valueOptions = new Set([
    '--output',
    '--manifest',
    '--current-manifest',
    '--repo',
    '--git-facts',
    '--decision',
    '--decision-path',
    '--original-decision',
    '--accepted-evidence',
    '--contract-evidence',
    '--accepted',
    '--accepted-path',
    '--accepted-manifest-evidence',
    '--continuation-evidence',
    '--continuation',
    '--continuation-path',
    '--format-continuation',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--write' || arg === '--check') continue;
    if (!valueOptions.has(arg)) fail(`unknown_option:${arg}`);
    index += 1;
    if (!argv[index] || argv[index]!.startsWith('--'))
      fail(`missing_option_value:${arg}`);
  }

  const output = optionValue(argv, ['--output']) ?? process.env.PRODUCT_ACCEPTED_OUTPUT;
  const manifest =
    optionValue(argv, ['--manifest', '--current-manifest']) ??
    process.env.PRODUCT_ACCEPTED_MANIFEST_PATH ??
    SIGNED_MANIFEST;
  const gitFacts =
    optionValue(argv, ['--git-facts']) ??
    process.env.PRODUCT_ACCEPTED_GIT_FACTS_PATH;
  if (write && !output)
    fail('--write requires explicit --output (signed manifest is never overwritten)');
  if (write && resolve(output!) === SIGNED_MANIFEST)
    fail('--write refuses the signed manifest path');
  if (!check)
    return { mode: 'write', output, manifest };

  const decision =
    optionValue(argv, ['--decision', '--decision-path', '--original-decision']) ??
    process.env.PRODUCT_ACCEPTED_DECISION_PATH ??
    process.env.PRODUCT_ACCEPTED_DECISION;
  const accepted =
    optionValue(argv, [
      '--accepted-evidence',
      '--contract-evidence',
      '--accepted',
      '--accepted-path',
      '--accepted-manifest-evidence',
    ]) ??
    process.env.PRODUCT_ACCEPTED_EVIDENCE_PATH ??
    process.env.PRODUCT_ACCEPTED_CONTRACT_EVIDENCE;
  const continuation =
    optionValue(argv, [
      '--continuation-evidence',
      '--continuation',
      '--continuation-path',
      '--format-continuation',
    ]) ??
    process.env.PRODUCT_ACCEPTED_CONTINUATION_PATH ??
    process.env.PRODUCT_ACCEPTED_FORMAT_CONTINUATION;
  if (!decision || !accepted || !continuation)
    fail('accepted evidence requires --decision, --accepted-evidence, and --continuation-evidence (or env equivalents)');
  if (!gitFacts)
    fail('accepted evidence requires --git-facts (or PRODUCT_ACCEPTED_GIT_FACTS_PATH)');
  return {
    mode: 'check',
    output,
    manifest,
    gitFacts,
    evidence: { decision, accepted, continuation },
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseOptions(argv);
    if (PRODUCT_CONTRACT_STATUS !== 'accepted')
      fail('product_contract_status_not_accepted');
    const expected = await buildManifest();
    validateManifest(expected, { allowAccepted: true });
    const expectedBytes = await formatWithPrettier(
      JSON.stringify(expected, null, 2),
      {
        parser: 'json',
      },
    );
    if (options.mode === 'write') {
      await writeFile(options.output!, expectedBytes, 'utf8');
      console.log(`wrote=${resolve(options.output!)}`);
      return 0;
    }
    await verifyAcceptedEvidence(
      options.evidence!,
      expected,
      options.manifest,
      options.gitFacts!,
    );
    console.log(
      `accepted_subset_ok status=accepted api_major=v1 revision=1 endpoints=${expected.endpoints.length} gate=PASS=14 FAIL=0 MISS=0`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = await main();
