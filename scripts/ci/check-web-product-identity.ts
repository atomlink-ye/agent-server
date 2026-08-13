#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PASS = 0;
const FAIL = 1;
const MISSING = 2;

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

// Scan the Web product source roots, while excluding the explicitly legacy
// Chat implementation. Its technical stream IDs are not Work/Run Trace
// identity and must not make this product guard a false alarm.
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
const FORBIDDEN_IDENTITY_KEYS = [
  'run_id',
  'task_id',
  'root_task_id',
  'team_*',
] as const;
const FORBIDDEN_ID =
  /\b(?:run_id|task_id|root_task_id|team_[A-Za-z0-9_]+)\b/u;

type SourceFile = { readonly path: string; readonly text: string };
type IdentityHit = {
  readonly path: string;
  readonly line: number;
  readonly reason: 'technical_identity' | 'handwritten_run_events_path';
};
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

function scanIdentity(sources: readonly SourceFile[]): IdentityHit[] {
  const hits: IdentityHit[] = [];
  for (const source of sources) {
    for (const [index, line] of source.text.split('\n').entries()) {
      if (FORBIDDEN_ID.test(line))
        hits.push({
          path: source.path,
          line: index + 1,
          reason: 'technical_identity',
        });
      // A product trace may only use the accepted Work BFF routes. In
      // particular, never hand-build the legacy run-events URL or concatenate
      // /runs/ with events in a Trace surface.
      if (
        (line.includes('/api/v1/runs') || line.includes('/runs/')) &&
        line.toLowerCase().includes('events')
      )
        hits.push({
          path: source.path,
          line: index + 1,
          reason: 'handwritten_run_events_path',
        });
    }
  }
  return hits;
}

export async function checkWebProductIdentity(): Promise<number> {
  if (PRODUCT_SOURCE_DIRS.length === 0 || FORBIDDEN_IDENTITY_KEYS.length === 0)
    return MISSING;
  let sources: SourceFile[];
  try {
    sources = await productSources();
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
  if (sources.length === 0) return MISSING;
  return scanIdentity(sources).length === 0 ? PASS : FAIL;
}

async function main(): Promise<number> {
  if (PRODUCT_SOURCE_DIRS.length === 0 || FORBIDDEN_IDENTITY_KEYS.length === 0) {
    console.log(`web_product_identity_exit=${MISSING}`);
    console.log('scanned_files=0');
    console.log('identity_hits=0');
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
    console.log(`web_product_identity_exit=${code}`);
    console.log('scanned_files=0');
    console.log('identity_hits=0');
    console.log('missing_inputs=true');
    return code;
  }
  if (sources.length === 0) {
    console.log(`web_product_identity_exit=${MISSING}`);
    console.log('scanned_files=0');
    console.log('identity_hits=0');
    console.log('missing_inputs=true');
    return MISSING;
  }
  const hits = scanIdentity(sources);
  console.log(`web_product_identity_exit=${hits.length ? FAIL : PASS}`);
  console.log(`scanned_files=${sources.length}`);
  console.log(`identity_hits=${hits.length}`);
  for (const hit of hits)
    console.log(`identity_hit=${hit.reason}:${hit.path}:${hit.line}`);
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
