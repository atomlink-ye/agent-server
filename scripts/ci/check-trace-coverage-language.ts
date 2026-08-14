#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PASS = 0;
const FAIL = 1;
const MISSING = 2;

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PRODUCT_SOURCE_DIRS = [
  resolve(repoRoot, 'apps/web/app'),
  resolve(repoRoot, 'apps/web/components'),
  resolve(repoRoot, 'apps/web/features'),
  resolve(repoRoot, 'apps/web/lib'),
] as const;
const LEGACY_SOURCE_PREFIXES = [
  resolve(repoRoot, 'apps/web/app/page.tsx'),
  resolve(repoRoot, 'apps/web/app/api/chats'),
  resolve(repoRoot, 'apps/web/app/api/runs'),
  resolve(repoRoot, 'apps/web/app/api/team-project'),
  resolve(repoRoot, 'apps/web/components/chat'),
  resolve(repoRoot, 'apps/web/lib/agent-server-client.ts'),
  resolve(repoRoot, 'apps/web/lib/agentic-team-bff.ts'),
  resolve(repoRoot, 'apps/web/lib/capabilities.ts'),
  resolve(repoRoot, 'apps/web/lib/self-learning-bff.ts'),
] as const;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

// This list is an input to the guard. An empty list is MISSING, never PASS.
export const DISABLED_TRACE_LANGUAGE = [
  'Complete trace',
  'Full execution history',
  'Everything that happened',
  'All activity',
  '完整执行',
  '全部执行',
] as const;

type SourceFile = { readonly path: string; readonly text: string };
type LanguageHit = { readonly path: string; readonly line: number; readonly phrase: string };
class MissingInputsError extends Error {}

function sourceFile(path: string): boolean {
  return (
    !LEGACY_SOURCE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ) &&
    SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) &&
    !/\.test\.[jt]sx?$/u.test(path) &&
    !path.includes('/__fixtures__/') &&
    !path.endsWith('frame-contract-map.md')
  );
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (sourceFile(path)) files.push(path);
  }
  return files.sort();
}

async function productSources(): Promise<SourceFile[]> {
  const files: string[] = [];
  for (const directory of PRODUCT_SOURCE_DIRS) {
    const directoryFiles = await filesUnder(directory);
    if (directoryFiles.length === 0)
      throw new MissingInputsError(`empty_product_source_directory:${directory}`);
    files.push(...directoryFiles);
  }
  return Promise.all(
    files.map(async (path) => ({ path, text: await readFile(path, 'utf8') })),
  );
}

function scanLanguage(sources: readonly SourceFile[]): LanguageHit[] {
  const patterns = DISABLED_TRACE_LANGUAGE.map((phrase) => ({
    phrase,
    pattern: new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'),
  }));
  const hits: LanguageHit[] = [];
  for (const source of sources) {
    for (const [index, line] of source.text.split('\n').entries()) {
      for (const { phrase, pattern } of patterns)
        if (pattern.test(line)) hits.push({ path: source.path, line: index + 1, phrase });
    }
  }
  return hits;
}

export async function checkTraceCoverageLanguage(): Promise<number> {
  if (DISABLED_TRACE_LANGUAGE.length === 0 || PRODUCT_SOURCE_DIRS.length === 0)
    return MISSING;
  try {
    const sources = await productSources();
    if (sources.length === 0) return MISSING;
    return scanLanguage(sources).length === 0 ? PASS : FAIL;
  } catch (error) {
    if (error instanceof MissingInputsError) return MISSING;
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return MISSING;
    return FAIL;
  }
}

async function main(): Promise<number> {
  if (DISABLED_TRACE_LANGUAGE.length === 0 || PRODUCT_SOURCE_DIRS.length === 0) {
    console.log(`trace_coverage_language_exit=${MISSING}`);
    console.log('scanned_files=0');
    console.log('coverage_language_hits=0');
    console.log('missing_inputs=true');
    return MISSING;
  }
  let sources: SourceFile[];
  try {
    sources = await productSources();
  } catch (error) {
    const code =
      error instanceof MissingInputsError
        ? MISSING
        :
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? MISSING
        : FAIL;
    console.log(`trace_coverage_language_exit=${code}`);
    console.log('scanned_files=0');
    console.log('coverage_language_hits=0');
    console.log('missing_inputs=true');
    return code;
  }
  if (sources.length === 0) {
    console.log(`trace_coverage_language_exit=${MISSING}`);
    console.log('scanned_files=0');
    console.log('coverage_language_hits=0');
    console.log('missing_inputs=true');
    return MISSING;
  }
  const hits = scanLanguage(sources);
  console.log(`trace_coverage_language_exit=${hits.length ? FAIL : PASS}`);
  console.log(`scanned_files=${sources.length}`);
  console.log(`coverage_language_hits=${hits.length}`);
  for (const hit of hits)
    console.log(`coverage_language_hit=${hit.phrase}:${hit.path}:${hit.line}`);
  return hits.length ? FAIL : PASS;
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
      process.exitCode = FAIL;
    });
}
