#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

import { PRODUCT_CONTRACT_STATUS } from '../../src/contracts/product-contract-policy.js';
import {
  PRODUCT_ACCEPTED_SUBSET_READ_ENDPOINTS,
  type AcceptedEndpoint,
} from '../../src/contracts/product-accepted-subset/read.js';

const OUTPUT = resolve(
  fileURLToPath(
    new URL(
      '../../src/contracts/product-accepted-subset.v1.json',
      import.meta.url,
    ),
  ),
);

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

export function validateManifest(
  manifest: unknown,
): asserts manifest is Manifest {
  if (!manifest || typeof manifest !== 'object') fail('not_object');
  const value = manifest as Partial<Manifest>;
  if (value.api_major !== 'v1') fail('api_major');
  if (value.accepted_revision !== 1) fail('accepted_revision');
  if (value.status !== 'provisional' && value.status !== 'accepted')
    fail('status');
  if (value.status === 'accepted') fail('human_gate_required');
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

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  if (
    (write ? 1 : 0) + (check ? 1 : 0) !== 1 ||
    argv.some((arg) => !['--write', '--check'].includes(arg))
  ) {
    console.error('usage: check-product-accepted-subset.ts --write|--check');
    return 2;
  }
  const expected = await buildManifest();
  validateManifest(expected);
  const expectedBytes = `${JSON.stringify(expected, null, 2)}\n`;
  if (write) {
    await writeFile(OUTPUT, expectedBytes, 'utf8');
    console.log(`wrote=${OUTPUT}`);
    return 0;
  }
  const actual = JSON.parse(await readFile(OUTPUT, 'utf8')) as unknown;
  validateManifest(actual);
  if (canonical(actual) !== canonical(expected)) {
    console.error('accepted_subset_mismatch');
    return 1;
  }
  console.log(`accepted_subset_ok endpoints=${expected.endpoints.length}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = await main();
