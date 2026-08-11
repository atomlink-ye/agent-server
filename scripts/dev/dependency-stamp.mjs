import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The stamp decides whether the node_modules baked into the image still matches
// what the workspace declares. Hashing the raw bytes of package.json made an
// edit to `scripts` invalidate a 4GB prebuilt image and force a ~20 minute
// rebuild, even though scripts cannot change a single installed package. So
// hash only the fields that actually determine the dependency tree.
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'pnpm',
  'packageManager',
  'resolutions',
  'overrides',
];

const PACKAGE_FILES = ['package.json', 'apps/web/package.json'];
// The lockfile pins every resolved version, so it is hashed whole: any change
// to it is by definition a change to the dependency tree.
const VERBATIM_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml'];

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
};

export async function computeDependencyStamp(root = '/workspace') {
  const hash = createHash('sha256');
  for (const file of VERBATIM_FILES) {
    hash.update(await readFile(`${root}/${file}`));
  }
  for (const file of PACKAGE_FILES) {
    const parsed = JSON.parse(await readFile(`${root}/${file}`, 'utf8'));
    const projected = Object.fromEntries(
      DEPENDENCY_FIELDS.filter((field) => parsed[field] !== undefined).map(
        (field) => [field, stable(parsed[field])],
      ),
    );
    hash.update(`${file}:${JSON.stringify(projected)}`);
  }
  return `${hash.digest('hex')}\n`;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.stdout.write(
    await computeDependencyStamp(process.argv[2] ?? '/workspace'),
  );
}
