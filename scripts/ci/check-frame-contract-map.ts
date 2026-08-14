#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

import {
  PRODUCT_ACCEPTED_SUBSET_READ_SCHEMAS,
} from '../../src/contracts/product-accepted-subset/index.js';

const PASS = 0;
const FAIL = 1;
const MISSING = 2;
const EXPECTED_ROWS = 7;
const EXPECTED_FRAMES = new Set([
  'B0 Run Trace shell',
  'B1 Timeline normal',
  'B2 Timeline rework',
  'B8 Events',
  'B5 Inspector',
  'Trace coverage disclosure',
  'A2 My Work degraded',
]);

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mapFile = resolve(
  repoRoot,
  'apps/web/features/run-trace/frame-contract-map.md',
);
const fixtureRoot = resolve(
  repoRoot,
  'apps/web/lib/__fixtures__/product-recordings',
);
const recordingNames = new Set([
  'parallel-success-fa77ba9.json',
  'rework-once-fa77ba9.json',
  'oi38-negative-39210cab.json',
]);

type JsonSchema = {
  type?: string;
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

type MapRow = {
  frame: string;
  schemaPaths: string[];
  evidence: string[];
};

function asSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema) as JsonSchema;
}

function branches(schema: JsonSchema): JsonSchema[] {
  return schema.anyOf ?? schema.oneOf ?? [];
}

function variant(schema: JsonSchema, label: string): JsonSchema | undefined {
  const candidates = branches(schema);
  if (label === 'success')
    return candidates.find(
      (candidate) =>
        candidate.properties?.projection_status?.const ===
        'internally_anchored',
    );
  if (label === 'not_found')
    return candidates.find(
      (candidate) =>
        candidate.properties?.projection_status?.const === 'not_found',
    );
  return candidates.find((candidate) =>
    Object.values(candidate.properties ?? {}).some(
      (property) => property.const === label,
    ),
  );
}

function unwrapNullable(schema: JsonSchema): JsonSchema {
  const alternatives = branches(schema).filter(
    (candidate) => candidate.type !== 'null',
  );
  return alternatives.length === 1 ? alternatives[0]! : schema;
}

function property(schema: JsonSchema, name: string): JsonSchema | undefined {
  return unwrapNullable(schema).properties?.[name];
}

function arrayItem(schema: JsonSchema): JsonSchema | undefined {
  const unwrapped = unwrapNullable(schema);
  return unwrapped.items ?? unwrapped.prefixItems?.[0];
}

function predicateVariant(
  schema: JsonSchema,
  field: string,
  expected: string,
): JsonSchema | undefined {
  const candidates = branches(schema);
  if (candidates.length === 0) {
    return property(schema, field)?.const === expected ? schema : undefined;
  }
  return candidates.find(
    (candidate) => property(candidate, field)?.const === expected,
  );
}

/** Resolve the map's compact schema paths against the accepted Zod schemas. */
export function schemaPathExists(path: string): boolean {
  const roots: Record<string, JsonSchema> = {
    work_list_response: asSchema(
      PRODUCT_ACCEPTED_SUBSET_READ_SCHEMAS.WorkListResponseSchema,
    ),
    run_trace_response: asSchema(
      PRODUCT_ACCEPTED_SUBSET_READ_SCHEMAS.ProductRunTraceResponseSchema,
    ),
  };
  const parts = path.split('.');
  let current = roots[parts.shift() ?? ''];
  if (!current) return false;

  for (const part of parts) {
    if (part === 'success' || part === 'not_found') {
      current = variant(current, part);
      if (!current) return false;
      continue;
    }

    const filtered = part.match(/^([^\[]+)\[\]\{([^=]+)=([^}]+)\}$/u);
    if (filtered) {
      const array = property(current, filtered[1]!);
      const item = array ? arrayItem(array) : undefined;
      if (!item) return false;
      current = predicateVariant(item, filtered[2]!, filtered[3]!);
      if (!current) return false;
      continue;
    }

    const arrayName = part.match(/^([^\[]+)\[\]$/u);
    if (arrayName) {
      const array = property(current, arrayName[1]!);
      current = array ? arrayItem(array) : undefined;
      if (!current) return false;
      continue;
    }

    current = property(current, part);
    if (!current) return false;
  }
  return true;
}

function parseRows(markdown: string): MapRow[] {
  const tableLines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') || line.endsWith('|'));
  if (tableLines.length < 3) throw new Error('map_table_missing');

  const rows = tableLines.map((line) => {
    if (!line.startsWith('|') || !line.endsWith('|'))
      throw new Error('malformed_map_table_row');
    return line.slice(1, -1).split('|').map((cell) => cell.trim());
  });
  const header = rows.shift();
  const separator = rows.shift();
  if (
    !header ||
    header.length !== 3 ||
    header[0] !== 'Frame / capability' ||
    header[1] !== 'Accepted schema paths' ||
    header[2] !== 'Recording evidence' ||
    !separator ||
    separator.length !== 3 ||
    separator.some((cell) => !/^[-:]+$/u.test(cell))
  )
    throw new Error('malformed_map_table_header');

  const parsed = rows.map((cells) => {
    if (cells.length !== 3) throw new Error('malformed_map_table_row');
    const [frame, schemaCell, evidenceCell] = cells;
    if (!frame || !schemaCell || !evidenceCell)
      throw new Error('empty_map_table_cell');
    return {
      frame,
      schemaPaths: schemaCell
        .split(';')
        .map((path) => path.trim().replace(/^`|`$/gu, ''))
        .filter(Boolean),
      evidence: evidenceCell
        .split(';')
        .map((evidence) => evidence.trim().replace(/^`|`$/gu, ''))
        .filter(Boolean),
    };
  });
  if (
    parsed.length !== EXPECTED_ROWS ||
    new Set(parsed.map((row) => row.frame)).size !== EXPECTED_ROWS ||
    parsed.some((row) => !EXPECTED_FRAMES.has(row.frame))
  )
    throw new Error('unexpected_map_capability_rows');
  return parsed;
}

function valueAtPath(value: unknown, path: string): unknown {
  if (!path.startsWith('$')) throw new Error('evidence_path_must_start_with_$');
  let current = value;
  let cursor = 1;
  let filteredCollection = false;

  while (cursor < path.length) {
    if (path[cursor] === '.') {
      const match = path.slice(cursor).match(/^\.([A-Za-z_][A-Za-z0-9_]*)/u);
      if (!match) throw new Error('invalid_json_path');
      const key = match[1]!;
      if (key === 'length') {
        if (!Array.isArray(current) && typeof current !== 'string')
          throw new Error('length_requires_collection');
        current = current.length;
      } else {
        if (
          current === null ||
          typeof current !== 'object' ||
          !(key in current)
        )
          throw new Error(`missing_json_property:${key}`);
        current = (current as Record<string, unknown>)[key];
      }
      cursor += match[0].length;
      continue;
    }

    if (path[cursor] !== '[') throw new Error('invalid_json_path');
    const close = path.indexOf(']', cursor);
    if (close < 0) throw new Error('unterminated_json_path_bracket');
    const token = path.slice(cursor + 1, close);
    if (/^\d+$/u.test(token)) {
      if (!Array.isArray(current)) throw new Error('index_requires_array');
      const index = Number(token);
      if (index >= current.length)
        throw new Error(`missing_json_index:${index}`);
      current = current[index];
    } else {
      const filter = token.match(
        /^\?\(@\.([A-Za-z_][A-Za-z0-9_.]*)\s*(==|!=)\s*(null|"[^"\\]*(?:\\.[^"\\]*)*")\)$/u,
      );
      if (!filter || !Array.isArray(current))
        throw new Error('invalid_json_filter');
      const expected =
        filter[3] === 'null'
          ? null
          : JSON.parse(filter[3]!) as unknown;
      const fields = filter[1]!.split('.');
      current = current.filter((entry) => {
        let candidate: unknown = entry;
        for (const field of fields) {
          if (candidate === null || typeof candidate !== 'object') {
            candidate = undefined;
            break;
          }
          candidate = (candidate as Record<string, unknown>)[field];
        }
        if (
          filter[2] === '!=' &&
          expected === null &&
          candidate === undefined
        )
          return false;
        return filter[2] === '=='
          ? candidate === expected
          : candidate !== expected;
      });
      filteredCollection = true;
    }
    cursor = close + 1;
  }

  if (filteredCollection && Array.isArray(current) && current.length === 0)
    throw new Error('empty_filter_result');
  if (typeof current === 'number' && current === 0)
    throw new Error('empty_cardinality');
  return current;
}

function parseEvidenceTriple(triple: string): [string, string, string] {
  const separator = triple.indexOf('#');
  let equals = -1;
  for (let index = separator + 1; index < triple.length; index += 1) {
    if (
      triple[index] === '=' &&
      triple[index - 1] !== '=' &&
      triple[index - 1] !== '!' &&
      triple[index + 1] !== '='
    ) {
      equals = index;
      break;
    }
  }
  if (separator <= 0 || equals <= separator + 1)
    throw new Error('evidence_must_be_file_hash_path_value_triple');
  return [
    triple.slice(0, separator),
    triple.slice(separator + 1, equals),
    triple.slice(equals + 1),
  ];
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
}

async function readFixture(name: string): Promise<unknown> {
  const text = await readFile(resolve(fixtureRoot, name), 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`invalid_fixture_json:${name}`);
  }
}

export async function checkFrameContractMap(): Promise<number> {
  try {
    const markdown = await readFile(mapFile, 'utf8');
    const rows = parseRows(markdown);
    if (rows.length === 0) return MISSING;
    if (rows.length !== EXPECTED_ROWS) return FAIL;
    const fixtures = new Map<string, unknown>();
    for (const row of rows) {
      if (
        !row.frame ||
        row.schemaPaths.length === 0 ||
        row.evidence.length === 0
      )
        return FAIL;
      if (row.schemaPaths.some((path) => !schemaPathExists(path))) return FAIL;
      for (const triple of row.evidence) {
        const [file, path, written] = parseEvidenceTriple(triple);
        if (!recordingNames.has(file)) return FAIL;
        if (file === 'oi38-negative-39210cab.json') return FAIL;
        let document = fixtures.get(file);
        if (!document) {
          try {
            document = await readFixture(file);
          } catch (error) {
            return error instanceof Error && error.message.startsWith('ENOENT')
              ? MISSING
              : FAIL;
          }
          fixtures.set(file, document);
        }
        let actual: unknown;
        try {
          actual = valueAtPath(document, path);
        } catch (error) {
          return error instanceof Error &&
            error.message === 'empty_filter_result'
            ? MISSING
            : FAIL;
        }
        if (renderValue(actual) !== written) return FAIL;
      }
    }
    return PASS;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return MISSING;
    return FAIL;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  checkFrameContractMap()
    .then((code) => {
      console.log(`frame_contract_map_exit=${code}`);
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(
        `checker_error=${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = FAIL;
    });
}
