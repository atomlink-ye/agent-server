import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const planRoot = join(repositoryRoot, 'docs', 'exec-plans');
const lanes = ['active', 'completed'];

export async function collectExecPlanErrors(root) {
  const errors = [];
  const records = [];

  for (const lane of lanes) {
    const directory = join(root, lane);
    if (!(await exists(directory))) {
      errors.push(
        `missing Exec Plan lane: ${relative(repositoryRoot, directory)}`,
      );
      continue;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const path = join(directory, entry.name);
      const source = await readFile(path, 'utf8');
      const display = relative(repositoryRoot, path);
      const status = source.match(/^status:\s*(active|completed)\s*$/m)?.[1];
      if (status !== lane) {
        errors.push(
          `${display}: status must be ${lane}, found ${status ?? 'none'}`,
        );
      }
      if (lane === 'completed' && /^\s*- \[ \]/m.test(source)) {
        errors.push(
          `${display}: completed plans cannot contain unchecked items`,
        );
      }
      if (lane === 'completed' && /docs\/exec-plans\/active\//.test(source)) {
        errors.push(
          `${display}: completed plans cannot contain links to active`,
        );
      }
      records.push({ lane, name: entry.name });
    }
  }

  enforceArtifactLanes(records, errors);
  return errors;
}

function enforceArtifactLanes(records, errors) {
  const completedNames = new Set(
    records
      .filter((record) => record.lane === 'completed')
      .map((record) => record.name),
  );
  const detailsBySlug = new Map();

  for (const record of records) {
    const match = record.name.match(/^(.+)-(spec|plan)\.md$/);
    if (!match) continue;
    const [, slug, kind] = match;
    const details = detailsBySlug.get(slug) ?? {};
    details[kind] = record;
    detailsBySlug.set(slug, details);
  }

  for (const [slug, details] of detailsBySlug) {
    if (
      details.spec &&
      details.plan &&
      details.spec.lane !== details.plan.lane
    ) {
      errors.push(
        `${slug}: related Spec and Plan are split across lanes (${details.spec.lane}/${details.plan.lane})`,
      );
    }
    if (
      completedNames.has(`${slug}.md`) &&
      [details.spec, details.plan].some((record) => record?.lane === 'active')
    ) {
      errors.push(
        `${slug}: detail artifact remains active beside canonical completed plan`,
      );
    }
  }
}

async function countMarkdownPlans(root) {
  let count = 0;
  for (const lane of lanes) {
    const directory = join(root, lane);
    if (!(await exists(directory))) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    count += entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.md'),
    ).length;
  }
  return count;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const errors = await collectExecPlanErrors(planRoot);
  if (errors.length > 0) {
    process.stderr.write(
      `Exec Plan checks failed:\n- ${errors.join('\n- ')}\n`,
    );
    process.exitCode = 1;
  } else {
    const count = await countMarkdownPlans(planRoot);
    process.stdout.write(`Exec Plan checks passed (${count} plans).\n`);
  }
}
