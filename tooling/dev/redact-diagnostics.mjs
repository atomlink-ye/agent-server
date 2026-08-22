import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const secret = process.env.DIAGNOSTIC_SECRET ?? '';
const roots = (process.env.DIAGNOSTIC_ROOTS ?? '')
  .split(':')
  .filter(Boolean)
  .map((root) => resolve(root));
const secretBytes = Buffer.from(secret, 'utf8');

const files = [];
for (const root of roots) {
  try {
    if ((await stat(root)).isDirectory()) await collectFiles(root, files);
  } catch {
    // A skipped flow does not create a diagnostics root.
  }
}

let canaryLogFiles = 0;
let bytesScanned = 0;
let secretMatchesBefore = 0;
let secretMatchesAfter = 0;
for (const file of files) {
  const content = await readFile(file);
  if (basename(file).startsWith('canary-')) canaryLogFiles += 1;
  bytesScanned += content.length;
  if (secretBytes.length === 0) continue;
  secretMatchesBefore += countOccurrences(content, secretBytes);
  const redacted = replaceAll(content, secretBytes, Buffer.from('***', 'utf8'));
  if (redacted !== content) await writeFile(file, redacted);
  secretMatchesAfter += countOccurrences(redacted, secretBytes);
}

if (secretMatchesAfter !== 0)
  throw new Error('OPENCODE_GO_API_KEY remains in real-runtime diagnostics.');

process.stdout.write(`files_scanned=${files.length}\n`);
process.stdout.write(`canary_log_files=${canaryLogFiles}\n`);
process.stdout.write(`bytes_scanned=${bytesScanned}\n`);
process.stdout.write(`secret_matches_before=${secretMatchesBefore}\n`);
process.stdout.write(`secret_matches_after=${secretMatchesAfter}\n`);

async function collectFiles(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(file, output);
    else if (entry.isFile()) output.push(file);
  }
}

function countOccurrences(content, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= content.length - needle.length) {
    const index = content.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function replaceAll(content, needle, replacement) {
  if (needle.length === 0 || !content.includes(needle)) return content;
  const chunks = [];
  let offset = 0;
  while (offset < content.length) {
    const index = content.indexOf(needle, offset);
    if (index < 0) {
      chunks.push(content.subarray(offset));
      break;
    }
    chunks.push(content.subarray(offset, index), replacement);
    offset = index + needle.length;
  }
  return Buffer.concat(chunks);
}
