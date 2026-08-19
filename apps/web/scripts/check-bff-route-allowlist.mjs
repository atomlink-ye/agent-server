#!/usr/bin/env node
// Verifies every BFF route's readProduct()/writeProduct() call path is
// accepted by product-api-client.ts's own path allowlist regexes, that a
// fixed set of paths that must never be accepted are still rejected on
// BOTH sides, and that every writeProduct() call site's idempotency-key
// usage matches product-api-client.ts's own three-state contract
// (only '/api/v1/work-definitions:apply' may carry a key, and it must).
//
// Why this exists: the BFF route files (apps/web/app/api/**/route.ts) and
// the allowlist regexes in product-api-client.ts encode the same fact --
// which upstream paths are legitimate -- in two independent places. If
// they drift, the failure mode is a generic 503 that looks exactly like
// "the backend is down" (product-api-bff.ts's safeFailure swallows the
// real reason). This script closes that gap by executing the *actual*
// regex construction source extracted from product-api-client.ts against
// the *actual* path templates extracted from each route.ts file -- not a
// hand-copied duplicate of either side. The idempotency-key check below
// mirrors postProductApi's own three-state contract for the same reason:
// a route that forgets the key on :apply, or adds it anywhere else,
// throws ProductApiClientError('invalid_path') at request time, which
// again surfaces as a generic 503 -- and nothing was asserting this
// before now (ORACLE-1's T4 flagged the coupling itself; the check was
// never written).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(import.meta.dirname, '..');
const apiRoot = path.join(webRoot, 'app', 'api');
const clientFile = path.join(webRoot, 'lib', 'product-api-client.ts');

// Paths that must NEVER be accepted by productReadPath, no matter how the
// regex evolves. Catches productReadPath being widened into something too
// permissive (e.g. `/.*/`), which the positive checks below cannot: a
// no-op allowlist still accepts every real BFF call path, so it looks
// like a PASS on the positive side alone.
const MUST_REJECT_READ = [
  '/api/v1/works/00000000-0000-4000-8000-000000000000/definition/extra',
  '/api/v1/works/not-a-uuid/definition',
  '/api/v1/nonexistent',
  '../api/v1/works/00000000-0000-4000-8000-000000000000/definition',
];

// Same idea, but for productWritePath specifically. This is a SEPARATE
// list, not a rename of the one above: productReadPath and productWritePath
// are two independent regexes, and a widening of one does not imply a
// widening of the other -- a check that only exercises the read side
// would report PASS if the write side alone were widened to /.*/.
const MUST_REJECT_WRITE = [
  '/api/v1/works/00000000-0000-4000-8000-000000000000/definition-version/extra',
  '/api/v1/works/00000000-0000-4000-8000-000000000000/definition',
  '/api/v1/work-definitions:unknown',
  '/api/v1/nonexistent',
  '../api/v1/works',
];

const APPLY_PATH = '/api/v1/work-definitions:apply';

let extractedRegexes;
try {
  extractedRegexes = extractRegexes(clientFile);
} catch (error) {
  console.error(
    `EXTRACTOR-BROKEN: could not extract productReadPath/productWritePath from ${path.relative(webRoot, clientFile)}: ` +
      `${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}
const { productReadPath, productWritePath } = extractedRegexes;

const routeFiles = findRouteFiles(apiRoot);
const uuidSample = '00000000-0000-4000-8000-000000000000';
const failures = [];
const idempotencyFailures = [];
let extracted = 0;

for (const file of routeFiles) {
  const source = readFileSync(file, 'utf8');
  for (const call of extractCalls(source, 'readProduct')) {
    extracted++;
    check(productReadPath, 'readProduct', file, call);
  }
  for (const call of extractWriteProductCalls(source)) {
    extracted++;
    check(productWritePath, 'writeProduct', file, call.path);
    checkIdempotencyKey(file, call);
  }
}

if (extracted === 0) {
  console.error(
    'MISSING: no readProduct(...)/writeProduct(...) call sites were extracted ' +
      'from apps/web/app/api -- the extractor itself is broken, this is not a PASS.',
  );
  process.exit(2);
}

console.log(
  `Checked ${extracted} readProduct/writeProduct call site(s) against product-api-client.ts's own allowlist regexes.`,
);

const readRejectFailures = mustRejectFailures(productReadPath, MUST_REJECT_READ);
console.log(
  `Checked ${MUST_REJECT_READ.length} path(s) that must stay rejected by productReadPath (guards against that allowlist being widened into a no-op).`,
);

const writeRejectFailures = mustRejectFailures(productWritePath, MUST_REJECT_WRITE);
console.log(
  `Checked ${MUST_REJECT_WRITE.length} path(s) that must stay rejected by productWritePath (same guard, independently, for the write side).`,
);

console.log(
  `Checked idempotency-key usage on ${extracted > 0 ? 'each writeProduct(...) call site' : '0 sites'} against the ` +
    `':apply must have a key, nothing else may' contract in product-api-client.ts.`,
);

if (
  failures.length > 0 ||
  readRejectFailures.length > 0 ||
  writeRejectFailures.length > 0 ||
  idempotencyFailures.length > 0
) {
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} BFF route(s) request a path the allowlist rejects:`);
    for (const f of failures) console.error(`  [${f.kind}] ${f.file}: ${f.templatePath}`);
  }
  if (readRejectFailures.length > 0) {
    console.error(
      `FAIL: ${readRejectFailures.length} path(s) that must be rejected are now accepted by productReadPath ` +
        '(the read allowlist has been widened too far):',
    );
    for (const p of readRejectFailures) console.error(`  ${p}`);
  }
  if (writeRejectFailures.length > 0) {
    console.error(
      `FAIL: ${writeRejectFailures.length} path(s) that must be rejected are now accepted by productWritePath ` +
        '(the write allowlist has been widened too far):',
    );
    for (const p of writeRejectFailures) console.error(`  ${p}`);
  }
  if (idempotencyFailures.length > 0) {
    console.error(`FAIL: ${idempotencyFailures.length} writeProduct(...) call site(s) violate the idempotency-key contract:`);
    for (const f of idempotencyFailures) console.error(`  ${f.file}: ${f.reason}`);
  }
  process.exit(1);
}
console.log(
  'PASS: every extracted BFF route path is accepted by the allowlist, every path that must stay rejected ' +
    'is still rejected on both sides, and every writeProduct(...) call site respects the idempotency-key contract.',
);
process.exit(0);

function mustRejectFailures(regex, mustRejectList) {
  return mustRejectList.filter((p) => regex.test(p));
}

function checkIdempotencyKey(file, call) {
  const requiresKey = call.path === APPLY_PATH;
  if (requiresKey && !call.hasIdempotencyKey) {
    idempotencyFailures.push({
      file: path.relative(webRoot, file),
      reason: `${call.path} requires an idempotency key but the call site doesn't pass one`,
    });
  }
  if (!requiresKey && call.hasIdempotencyKey) {
    idempotencyFailures.push({
      file: path.relative(webRoot, file),
      reason: `${call.path} must not pass an idempotency key, but the call site passes one`,
    });
  }
}

function check(regex, kind, file, templatePath) {
  // The real getProductApi() strips the query string before testing the
  // allowlist (product-api-client.ts: `path.split('?')[0]`) -- mirror that
  // here, otherwise this script would flag routes that work fine today.
  const pathOnly = templatePath.split('?')[0] ?? '';
  if (!regex.test(pathOnly)) {
    failures.push({ kind, file: path.relative(webRoot, file), templatePath: pathOnly });
  }
}

function extractCalls(source, fnName) {
  const paths = [];
  const re = new RegExp(`${fnName}\\(\\s*[\`']([^\`']*)[\`']`, 'g');
  for (const m of source.matchAll(re)) {
    paths.push(m[1].replace(/\$\{[^}]*\}/g, uuidSample));
  }
  return paths;
}

// Like extractCalls, but for writeProduct(...) specifically: also captures
// the full balanced argument list text (via bracket-depth counting, not a
// bounded regex) so we can tell whether the call site's options object
// mentions `idempotencyKey` at all.
function extractWriteProductCalls(source) {
  const calls = [];
  const marker = 'writeProduct(';
  let searchFrom = 0;
  while (true) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) break;
    const argsStart = start + marker.length;
    let depth = 1;
    let i = argsStart;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    const argsText = source.slice(argsStart, i - 1);
    searchFrom = i;
    const pathMatch = argsText.match(/^\s*[`']([^`']*)[`']/);
    if (!pathMatch) continue; // dynamic first argument (template with ${}) -- see below
    const templatePath = pathMatch[1].replace(/\$\{[^}]*\}/g, uuidSample);
    calls.push({ path: templatePath, hasIdempotencyKey: argsText.includes('idempotencyKey') });
  }
  return calls;
}

function extractRegexes(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const uuidAndReadBlock = sliceBlock(lines, (l) => l.startsWith('const uuidPath ='), file);
  const writeBlock = sliceBlock(lines, (l) => l.startsWith('const productWritePath ='), file);
  const snippet = `${uuidAndReadBlock}\n${writeBlock}`;
  // eslint-disable-next-line no-new-func -- executing the real regex
  // construction source extracted above, not a hand-written duplicate
  const factory = new Function(`${snippet}\nreturn { productReadPath, productWritePath };`);
  return factory();
}

function sliceBlock(lines, startPredicate, file) {
  const start = lines.findIndex(startPredicate);
  if (start === -1) throw new Error(`could not find expected block start in ${file}`);
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    if (lines[i] === ');') {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error(`could not find closing ");" for block starting at line ${start + 1} in ${file}`);
  return lines.slice(start, end + 1).join('\n');
}

function findRouteFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findRouteFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}
