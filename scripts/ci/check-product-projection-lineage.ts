#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

import {
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
} from '../../src/contracts/product-projection/index.js';
import {
  PRODUCT_PROJECTION_LINEAGE_MANIFEST,
  type ProductProjectionLineageEntry,
} from '../../src/contracts/product-projection/lineage-manifest.js';

type JsonSchema = {
  type?: string;
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

export type ProductWorkVocabulary = {
  technicalIdContainer: string;
  forbiddenProductIdentityKeys: string[];
  forbiddenLeafPrefixes: string[];
  allowedSourceRefKeys: string[];
};

const TOP_VARIANT_NAMES: Record<string, string> = {
  complete: 'success',
  internally_anchored: 'success',
};

function nonNullBranches(schema: JsonSchema): JsonSchema[] {
  return [...(schema.anyOf ?? schema.oneOf ?? [])].filter(
    (branch) => branch.type !== 'null',
  );
}

function directConst(schema: JsonSchema, key: string): unknown {
  return schema.properties?.[key]?.const;
}

function unionLabels(branches: JsonSchema[], root: boolean): string[] {
  const keys = new Set(
    branches.flatMap((branch) => Object.keys(branch.properties ?? {})),
  );
  for (const key of keys) {
    const values = branches.map((branch) => directConst(branch, key));
    const concrete = values.filter((value) => value !== undefined);
    if (
      concrete.length >= 2 &&
      new Set(concrete.map((value) => JSON.stringify(value))).size >= 2
    ) {
      const labels = branches.map((branch, index) => {
        const value = values[index];
        if (value !== undefined) {
          const text = String(value);
          return root ? (TOP_VARIANT_NAMES[text] ?? text) : `${key}=${text}`;
        }
        // A branch without the discriminant is only accepted when it has a
        // stable, unique property that names the branch (the error arm).
        const unique = Object.keys(branch.properties ?? {}).find((property) =>
          branches.every(
            (other, otherIndex) =>
              otherIndex === index || !(property in (other.properties ?? {})),
          ),
        );
        return unique ?? '';
      });
      if (labels.every(Boolean) && new Set(labels).size === labels.length)
        return labels;
    }
  }
  throw new Error('union_missing_stable_discriminant');
}

function appendProperty(path: string, property: string): string {
  return path.endsWith('::') ? `${path}${property}` : `${path}.${property}`;
}

function appendUnionVariant(
  path: string,
  label: string,
  root: boolean,
): string {
  if (root) return `${path}.${label}::`;
  if (path.endsWith('[]')) return `${path}{${label}}`;
  return `${path}{${label}}`;
}

function flattenSchema(schema: JsonSchema, owner: string): string[] {
  const leaves = new Set<string>();

  function visit(current: JsonSchema, path: string, root = false): void {
    if (current.type === 'null') return;

    const branches = nonNullBranches(current);
    if (branches.length > 0) {
      if (branches.length === 1) {
        visit(branches[0]!, path, root);
        return;
      }
      const labels = unionLabels(branches, root);
      branches.forEach((branch, index) => {
        visit(branch, appendUnionVariant(path, labels[index]!, root), false);
      });
      return;
    }

    if (current.type === 'object' && current.properties) {
      for (const [property, child] of Object.entries(current.properties))
        visit(child, appendProperty(path, property));
      return;
    }

    if (current.type === 'array' && current.items) {
      visit(current.items, `${path}[]`);
      return;
    }

    if (path) leaves.add(path);
  }

  visit(schema, owner, true);
  return [...leaves].sort();
}

export function flattenProductProjectionSchemaPaths(
  schema: z.ZodType,
  owner: 'work_run_response' | 'run_trace_response',
): string[] {
  return flattenSchema(z.toJSONSchema(schema) as JsonSchema, owner);
}

export function productProjectionSchemaPaths(): string[] {
  return [
    ...flattenProductProjectionSchemaPaths(
      ProductWorkRunResponseSchema,
      'work_run_response',
    ),
    ...flattenProductProjectionSchemaPaths(
      ProductRunTraceResponseSchema,
      'run_trace_response',
    ),
  ].sort();
}

function isTechnicalIdentityPath(path: string, container: string): boolean {
  if (path.includes('.chat_detail.target.')) return true;
  const parts = path.split('.');
  return parts.some(
    (part) =>
      part === container ||
      part.startsWith(`${container}{`) ||
      (part === 'source_ref' && path.includes('follow_up_reads[]')),
  );
}

export function scanProductProjectionVocabulary(
  paths: readonly string[],
  vocabulary: ProductWorkVocabulary,
) {
  const forbiddenPrefixHits = paths.filter((path) => {
    let inSourceRefs = false;
    return vocabulary.forbiddenLeafPrefixes.some((prefix) =>
      path.split(/[.{]/u).some((part) => {
        if (
          part === vocabulary.technicalIdContainer ||
          (part === 'source_ref' && path.includes('follow_up_reads[]'))
        ) {
          inSourceRefs = true;
          return false;
        }
        return !inSourceRefs && part.startsWith(prefix);
      }),
    );
  });
  const forbiddenIdentityHits = paths.filter((path) => {
    const leaves = path.split(/[.{]/u);
    const leaf = leaves.at(-1)?.replace(/\[\]$/u, '');
    return (
      leaf !== undefined &&
      vocabulary.forbiddenProductIdentityKeys.includes(leaf) &&
      !isTechnicalIdentityPath(path, vocabulary.technicalIdContainer)
    );
  });
  const forbiddenSourceRefHits = paths.filter((path) => {
    const match = path.match(
      new RegExp(`\\.${vocabulary.technicalIdContainer}\\.([^.[{]+)`, 'u'),
    );
    return Boolean(
      match && !vocabulary.allowedSourceRefKeys.includes(match[1]!),
    );
  });
  return { forbiddenPrefixHits, forbiddenIdentityHits, forbiddenSourceRefHits };
}

export function compareProductProjectionLineage(
  schemaPaths: readonly string[] = productProjectionSchemaPaths(),
  manifestKeys: readonly string[] = Object.keys(
    PRODUCT_PROJECTION_LINEAGE_MANIFEST,
  ),
  vocabulary?: ProductWorkVocabulary,
) {
  const schemaSet = new Set(schemaPaths);
  const manifestSet = new Set(manifestKeys);
  const missing = [...schemaSet]
    .filter((path) => !manifestSet.has(path))
    .sort();
  const extra = [...manifestSet].filter((path) => !schemaSet.has(path)).sort();
  const forbidden = vocabulary
    ? scanProductProjectionVocabulary(schemaPaths, vocabulary)
    : {
        forbiddenPrefixHits: [],
        forbiddenIdentityHits: [],
        forbiddenSourceRefHits: [],
      };
  return {
    schemaPaths: schemaSet.size,
    manifestKeys: manifestSet.size,
    missing,
    extra,
    ...forbidden,
  };
}

export function validateProductProjectionLineageManifest(
  manifest: Readonly<
    Record<string, ProductProjectionLineageEntry>
  > = PRODUCT_PROJECTION_LINEAGE_MANIFEST,
) {
  const invalidDerivations = Object.entries(manifest).flatMap(
    ([key, entry]) => {
      if (entry.kind !== 'derivation') return [];
      if (
        !entry.name ||
        !entry.formula ||
        !/_v[0-9]+$/u.test(entry.name) ||
        /^(?:derived|constant|mapped)$/u.test(entry.name) ||
        /^(?:derived|constant|mapped)$/u.test(entry.formula) ||
        !Array.isArray(entry.inputs) ||
        entry.inputs.some(
          (input) => typeof input !== 'string' || input.length === 0,
        )
      )
        return [key];
      return [];
    },
  );
  const invalidEntries = Object.entries(manifest)
    .filter(([, entry]) => {
      if (entry.kind === 'column' || entry.kind === 'source_ref')
        return !entry.table || !entry.column;
      return entry.kind !== 'derivation';
    })
    .map(([key]) => key);
  return { invalidDerivations, invalidEntries };
}

async function loadVocabulary(): Promise<ProductWorkVocabulary> {
  const filename = resolve(
    fileURLToPath(
      new URL(
        '../../docs/contracts/product-work-vocabulary.json',
        import.meta.url,
      ),
    ),
  );
  return JSON.parse(await readFile(filename, 'utf8')) as ProductWorkVocabulary;
}

export function printProductProjectionLineage(
  result: ReturnType<typeof compareProductProjectionLineage>,
  write = console.log,
): void {
  write(
    `schema_paths=${result.schemaPaths} manifest_keys=${result.manifestKeys} missing=${result.missing.length} extra=${result.extra.length}`,
  );
  write(`forbidden_prefix_hits=${result.forbiddenPrefixHits.length}`);
  write(`forbidden_source_ref_hits=${result.forbiddenSourceRefHits.length}`);
  if (result.missing.length) write(`missing_paths=${result.missing.join(',')}`);
  if (result.extra.length) write(`extra_keys=${result.extra.join(',')}`);
  if (result.forbiddenIdentityHits.length)
    write(`forbidden_identity_hits=${result.forbiddenIdentityHits.join(',')}`);
  if (result.forbiddenSourceRefHits.length)
    write(
      `forbidden_source_ref_hits_paths=${result.forbiddenSourceRefHits.join(',')}`,
    );
}

async function main(): Promise<number> {
  const vocabulary = await loadVocabulary();
  const result = compareProductProjectionLineage(
    productProjectionSchemaPaths(),
    Object.keys(PRODUCT_PROJECTION_LINEAGE_MANIFEST),
    vocabulary,
  );
  const manifestValidation = validateProductProjectionLineageManifest();
  printProductProjectionLineage(result);
  console.log(
    `invalid_derivations=${manifestValidation.invalidDerivations.length}`,
  );
  console.log(
    `invalid_manifest_entries=${manifestValidation.invalidEntries.length}`,
  );
  return result.missing.length === 0 &&
    result.extra.length === 0 &&
    result.forbiddenPrefixHits.length === 0 &&
    result.forbiddenIdentityHits.length === 0 &&
    result.forbiddenSourceRefHits.length === 0 &&
    manifestValidation.invalidDerivations.length === 0 &&
    manifestValidation.invalidEntries.length === 0
    ? 0
    : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(
        `checker_error=${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
