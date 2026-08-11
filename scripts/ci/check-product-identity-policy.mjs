import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const vocabularyFile = join(
  repositoryRoot,
  'docs/contracts/product-work-vocabulary.json',
);
const sourceRefsFile = join(
  repositoryRoot,
  'src/contracts/product-source-refs.ts',
);
const policyFile = join(
  repositoryRoot,
  'src/contracts/product-contract-policy.ts',
);

const vocabulary = JSON.parse(await readFile(vocabularyFile, 'utf8'));
const container = vocabulary.technicalIdContainer;
const allowedKeys = vocabulary.allowedSourceRefKeys;
const technicalKeys = [
  ...new Set([...allowedKeys, ...vocabulary.forbiddenProductIdentityKeys]),
];
const forbiddenPrefixes = vocabulary.forbiddenLeafPrefixes;
const errors = [];

const sourceRefs = await readFile(sourceRefsFile, 'utf8');
const policy = await readFile(policyFile, 'utf8');
const sourceRefsShape = sourceRefs.match(
  /ProductSourceRefsSchema[\s\S]*?z\s*\.\s*object\s*\(\{([\s\S]*?)\}\)\s*\.strict\(\)/,
);
if (!sourceRefsShape) {
  errors.push('ProductSourceRefsSchema must be a strict z.object');
}
const declaredKeys = sourceRefsShape
  ? [...sourceRefsShape[1].matchAll(/^\s{4}([a-z][a-z0-9_]*)\s*:/gm)].map(
      (match) => match[1],
    )
  : [];
if (
  declaredKeys.length !== allowedKeys.length ||
  declaredKeys.some((key, index) => key !== allowedKeys[index])
) {
  errors.push(
    `${container} allow-list mismatch: expected ${allowedKeys.join(',')}, got ${declaredKeys.join(',')}`,
  );
}
if (!/PRODUCT_CONTRACT_STATUS\s*=\s*['"]provisional['"]/.test(policy)) {
  errors.push('product contract policy must remain provisional');
}

const contractFiles = await collectFiles(join(repositoryRoot, 'src/contracts'));
const productContractFiles = contractFiles.filter((file) => {
  const path = relative(repositoryRoot, file);
  return (
    file !== sourceRefsFile &&
    (path.startsWith('src/contracts/product-') ||
      path.startsWith('src/contracts/product-projection/'))
  );
});
const productApplicationFiles = await collectFiles(
  join(repositoryRoot, 'src/application/product-projection'),
);
const files = [...productContractFiles, ...productApplicationFiles];

let outsideSourceRefs = 0;
let indexIdentities = 0;
let technicalAliases = 0;
for (const file of files) {
  const source = stripComments(await readFile(file, 'utf8'));
  const masked = maskSourceRefs(source, container);
  for (const key of technicalKeys) {
    outsideSourceRefs += countMatches(masked, new RegExp(`\\b${escapeRegex(key)}\\b`, 'g'));
  }
  for (const prefix of forbiddenPrefixes) {
    outsideSourceRefs += countMatches(
      masked,
      new RegExp(`\\b${escapeRegex(prefix)}`, 'g'),
    );
  }

  indexIdentities += countMatches(masked, /work-\d+/g);
  indexIdentities += countMatches(masked, /workRefById/g);
  indexIdentities += countMatches(
    masked,
    /\.map\s*\(\s*\([^)]*\bindex\b/g,
  );

  // A product id must be an independent UUID.  These aliases are the
  // obvious ways a technical row can accidentally become the product id.
  technicalAliases += countMatches(
    masked,
    /\bid\s*:\s*(?:team(?:Run)?|run|rootRun|rootTask|sourceRefs)\s*\./g,
  );
  technicalAliases += countMatches(
    masked,
    /\bid\s*:\s*[^,\n}]*(?:root_task_id|root_run_id|team_run_id|team_member_run_id|run_id|task_id)\b/g,
  );
}

if (outsideSourceRefs !== 0)
  errors.push(`technical identity outside ${container}: ${outsideSourceRefs}`);
if (indexIdentities !== 0)
  errors.push(`index-derived product identity: ${indexIdentities}`);
if (technicalAliases !== 0)
  errors.push(`technical id aliases used as product id: ${technicalAliases}`);

process.stdout.write(
  `outside_source_refs=${outsideSourceRefs} index_identities=${indexIdentities} technical_id_aliases=${technicalAliases}\n`,
);
if (errors.length > 0) {
  process.stderr.write(`Product identity policy failed:\n- ${errors.join('\n- ')}\n`);
  process.exitCode = 1;
}

async function collectFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
  }
  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function maskSourceRefs(source, sourceRefContainer) {
  const marker = new RegExp(
    `\\b${escapeRegex(sourceRefContainer)}\\b\\s*:`,
    'g',
  );
  const ranges = [];
  for (const match of source.matchAll(marker)) {
    let open = match.index + match[0].length;
    while (/\s/.test(source[open] ?? '')) open++;
    // Only an object literal immediately follows the source_refs colon.
    // Helper calls are deliberately not masked: technical fields must be
    // visible in the literal that is guarded by this policy.
    if (source[open] !== '{') continue;
    const close = matchingDelimiter(source, open, '{', '}');
    ranges.push([match.index, close + 1]);
  }
  const chars = source.split('');
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index++) chars[index] = ' ';
  }
  return chars.join('');
}

function matchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return index;
  }
  return source.length - 1;
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
