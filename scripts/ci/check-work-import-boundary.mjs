#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import * as ast from 'typescript/unstable/ast';

process.on('uncaughtException', (error) => {
  console.error(
    `work_import_boundary_invalid:${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
});

const repo = path.resolve(readOption('--root') ?? process.cwd());
const sourceRoot = path.join(repo, 'src');
const protectedTargets = new Set([
  'src/infrastructure/postgres/postgres-work-identity-repository.ts',
  'src/infrastructure/postgres/postgres-work-projection-facts-query.ts',
]);
const allowedImporterPrefix = 'src/modules/work/';
const violations = [];
const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('typescript/package.json'));
const nativePackage = path.resolve(
  packageRoot,
  '..',
  `@typescript/typescript-${process.platform}-${process.arch}`,
  'package.json',
);
if (!fs.existsSync(nativePackage))
  throw new Error(`work_boundary_native_compiler_missing:${nativePackage}`);
const executablePath = path.join(path.dirname(nativePackage), 'lib', 'tsc');
const files = listTypescriptFiles(sourceRoot);
const virtualRoot = '/work-import-boundary';
const virtualFiles = Object.fromEntries(
  files.map((file) => [
    path.posix.join(virtualRoot, relative(file)),
    fs.readFileSync(file, 'utf8'),
  ]),
);
const api = new API({
  tsserverPath: executablePath,
  cwd: virtualRoot,
  fs: createVirtualFileSystem(virtualFiles),
});
let snapshot;

try {
  snapshot = api.updateSnapshot({ openFiles: Object.keys(virtualFiles) });
  for (const importer of files) {
    const importerRelative = relative(importer);
    if (importerRelative.endsWith('.test.ts')) continue;
    const virtualImporter = path.posix.join(virtualRoot, importerRelative);
    const project = snapshot.getDefaultProjectForFile(virtualImporter);
    const source = project?.program.getSourceFile(virtualImporter);
    if (!source)
      throw new Error(
        `work_boundary_source_not_materialized:${importerRelative}`,
      );
    function record(specifier) {
      const target = resolveTypescriptTarget(importer, specifier);
      if (
        target &&
        protectedTargets.has(target) &&
        !importerRelative.startsWith(allowedImporterPrefix)
      )
        violations.push({ importer: importerRelative, target });
    }
    function visit(node) {
      if (
        ast.isStringLiteral(node) ||
        ast.isNoSubstitutionTemplateLiteral(node)
      )
        record(node.text);
      node.forEachChild(visit);
    }
    visit(source);
  }
} finally {
  try {
    snapshot?.dispose();
  } finally {
    api.close();
  }
}

if (violations.length) {
  const unique = [
    ...new Map(
      violations.map((violation) => [
        `${violation.importer}:${violation.target}`,
        violation,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.importer}:${left.target}`.localeCompare(
      `${right.importer}:${right.target}`,
    ),
  );
  for (const violation of unique)
    console.error(
      `work_import_boundary_violation:importer=${violation.importer}:target=${violation.target}`,
    );
  process.exit(1);
}

console.log(
  JSON.stringify({
    guard: 'work-import-boundary',
    protected_targets: [...protectedTargets],
    allowed_importer_prefix: allowedImporterPrefix,
    test_only_exception: 'src/**/*.test.ts',
    violations: 0,
  }),
);

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`missing_option_value:${name}`);
  return value;
}

function listTypescriptFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listTypescriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.ts'))
      result.push(absolute);
  }
  return result.sort();
}

function resolveTypescriptTarget(importer, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const absolute = path.resolve(path.dirname(importer), specifier);
  const candidate = absolute.replace(/\.js$/, '.ts');
  return relative(candidate);
}

function relative(filename) {
  return path.relative(repo, filename).split(path.sep).join('/');
}
