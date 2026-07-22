import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const requiredFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'SECURITY.md',
  'docs/product.md',
  'docs/features.md',
  'docs/components.md',
  'docs/architecture.md',
  'docs/contracts.md',
  'docs/quality.md',
  'docs/operations.md',
  'docs/agents.md',
  'docs/exec-plans.md',
];

const markdownFiles = [
  ...requiredFiles.filter((path) => !path.startsWith('docs/')),
  ...(await walkMarkdown(join(repositoryRoot, 'docs'))),
  ...(await walkMarkdown(join(repositoryRoot, '.github'))),
].map((path) =>
  path.startsWith(repositoryRoot) ? path : join(repositoryRoot, path),
);

const errors = [];
for (const required of requiredFiles) {
  if (!(await exists(join(repositoryRoot, required)))) {
    errors.push(`missing required documentation: ${required}`);
  }
}

for (const file of new Set(markdownFiles)) {
  if (!(await exists(file))) {
    continue;
  }
  const source = await readFile(file, 'utf8');
  const display = relative(repositoryRoot, file);
  if (/https?:\/\/drive\.google\.com/i.test(source)) {
    errors.push(`${display}: private Drive URLs are not allowed in repo docs`);
  }
  if (!/^#\s+\S/m.test(source)) {
    errors.push(`${display}: missing level-one heading`);
  }

  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/g, '');
    if (!rawTarget || isExternal(rawTarget) || rawTarget.startsWith('#')) {
      continue;
    }
    const targetWithoutTitle = rawTarget.split(/\s+["']/)[0] ?? rawTarget;
    const localTarget = decodeURIComponent(
      targetWithoutTitle.split('#')[0] ?? '',
    );
    if (!localTarget) {
      continue;
    }
    if (localTarget.startsWith('/') || localTarget.startsWith('~')) {
      errors.push(
        `${display}: absolute local link is not portable: ${rawTarget}`,
      );
      continue;
    }
    const resolved = resolve(dirname(file), localTarget);
    if (!resolved.startsWith(repositoryRoot)) {
      errors.push(`${display}: link escapes repository: ${rawTarget}`);
    } else if (!(await exists(resolved))) {
      errors.push(`${display}: broken local link: ${rawTarget}`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(
    `Documentation checks failed:\n- ${errors.join('\n- ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Documentation checks passed (${new Set(markdownFiles).size} Markdown files).\n`,
  );
}

async function walkMarkdown(root) {
  if (!(await exists(root))) {
    return [];
  }
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkMarkdown(path)));
    } else if (extname(entry.name).toLowerCase() === '.md') {
      found.push(path);
    }
  }
  return found;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isExternal(target) {
  return /^(?:https?:|mailto:|tel:|data:|sandbox:)/i.test(target);
}
