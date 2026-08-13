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
    `work_bootstrap_boundary_missing:${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
});

const repo = process.cwd();
const file = 'src/bootstrap.ts';
const absolute = path.join(repo, file);
const forbiddenIdentifiers = new Set([
  'workIdentity',
  'startWorkRun',
  'createPostgresWorkIdentityModule',
  'createProductProjection',
]);
const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('typescript/package.json'));
const nativePackage = path.resolve(
  packageRoot,
  '..',
  `@typescript/typescript-${process.platform}-${process.arch}`,
  'package.json',
);
if (!fs.existsSync(nativePackage))
  throw new Error(`native_compiler_missing:${nativePackage}`);
const virtualRoot = '/work-bootstrap-boundary';
const virtualFile = `${virtualRoot}/${file}`;
const api = new API({
  tsserverPath: path.join(path.dirname(nativePackage), 'lib', 'tsc'),
  cwd: virtualRoot,
  fs: createVirtualFileSystem({
    [virtualFile]: fs.readFileSync(absolute, 'utf8'),
  }),
});
let snapshot;
const violations = new Set();
try {
  snapshot = api.updateSnapshot({ openFiles: [virtualFile] });
  const project = snapshot.getDefaultProjectForFile(virtualFile);
  const source = project?.program.getSourceFile(virtualFile);
  if (!source) throw new Error(`source_not_materialized:${file}`);
  function visit(node) {
    if (ast.isIdentifier(node) && forbiddenIdentifiers.has(node.text))
      violations.add(node.text);
    node.forEachChild(visit);
  }
  visit(source);
} finally {
  try {
    snapshot?.dispose();
  } finally {
    api.close();
  }
}

if (violations.size) {
  for (const marker of [...violations].sort())
    console.error(
      `work_bootstrap_boundary_violation:file=${file}:identifier=${marker}`,
    );
  process.exit(1);
}
console.log(
  JSON.stringify({
    guard: 'work-bootstrap-zero',
    parser: 'typescript-7-unstable-ast',
    file,
    predicate: [...forbiddenIdentifiers].join('|'),
    syntax_authority: 'TypeScript 7 parser; no regex or handwritten scanner',
    syntax_dependencies: {
      nested_templates: 'parsed by TypeScript 7 and recursively traversed',
      comments_and_braces:
        'parsed by TypeScript 7; comments produce no AST nodes',
      regex_vs_division: 'disambiguated by TypeScript 7 grammar',
      escapes: 'decoded and structured by TypeScript 7 parser',
      satisfies: 'parsed by TypeScript 7 and recursively traversed',
      as_const: 'parsed by TypeScript 7 and recursively traversed',
    },
    traversal: 'executable AST Identifier nodes only',
    non_identifiers:
      'strings, comments, regex literals, and template static text do not produce target Identifier nodes',
    template_literal_policy:
      'static template text is non-executable; every ${...} interpolation AST is traversed recursively',
    violations: 0,
  }),
);
