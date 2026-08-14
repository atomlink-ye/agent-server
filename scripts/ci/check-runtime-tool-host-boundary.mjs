#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

process.on('uncaughtException', missing);
process.on('unhandledRejection', missing);

const forbiddenIdentifiers = new Set([
  'MemoryApiRepository',
  'PostgresMemoryApiRepository',
  'TeamToolContextResolver',
  'TeamCommandService',
  'CreateLearningProposal',
  'SyntheticMarketAdapter',
  'WorkRuntimeContributor',
  'createMemoryReadRuntimeContributor',
  'createLegacyRuntimeToolsContributor',
]);
const targets = [
  'src/infrastructure/extensions/runtime-mcp-server.ts',
  'src/entrypoints/mcp/direct-memory-mcp.ts',
];

main().catch(missing);

async function main() {
  let sync;
  let virtualFs;
  let ast;
  try {
    sync = await import('typescript/unstable/sync');
    virtualFs = await import('typescript/unstable/fs');
    ast = await import('typescript/unstable/ast');
  } catch (error) {
    missing(error);
    return;
  }
  if (!sync.API || !virtualFs.createVirtualFileSystem || !ast.isIdentifier)
    throw new Error('typescript_unstable_api_unavailable');

  const repo = process.cwd();
  const require = createRequire(import.meta.url);
  const packageRoot = path.dirname(require.resolve('typescript/package.json'));
  const nativePackage = path.resolve(
    packageRoot,
    '..',
    `@typescript/typescript-${process.platform}-${process.arch}`,
    'package.json',
  );
  if (!fs.existsSync(nativePackage)) throw new Error('native_compiler_missing');
  const executablePath = path.join(path.dirname(nativePackage), 'lib', 'tsc');
  const virtualRoot = '/runtime-tool-host-boundary';
  const virtualFiles = Object.fromEntries(
    targets.map((target) => [
      path.posix.join(virtualRoot, target),
      fs.readFileSync(path.join(repo, target), 'utf8'),
    ]),
  );
  const api = new sync.API({
    tsserverPath: executablePath,
    cwd: virtualRoot,
    fs: virtualFs.createVirtualFileSystem(virtualFiles),
  });
  let snapshot;
  const violations = [];
  try {
    snapshot = api.updateSnapshot({ openFiles: Object.keys(virtualFiles) });
    for (const target of targets) {
      const virtualTarget = path.posix.join(virtualRoot, target);
      const source = snapshot
        .getDefaultProjectForFile(virtualTarget)
        ?.program.getSourceFile(virtualTarget);
      if (!source) throw new Error(`source_file_unavailable:${target}`);
      function visit(node) {
        if (ast.isIdentifier(node) && forbiddenIdentifiers.has(node.text))
          violations.push({ file: target, identifier: node.text });
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
    for (const violation of violations)
      console.error(
        `runtime_tool_host_boundary_violation:file=${violation.file}:identifier=${violation.identifier}`,
      );
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      guard: 'runtime-tool-host-boundary',
      targets,
      forbidden_identifiers: [...forbiddenIdentifiers],
      template_strategy:
        'TS7 AST Identifier traversal: static template text, strings, comments, and regex are ignored; every executable interpolation including nested templates is recursively traversed',
      violations: 0,
    }),
  );
}

function missing(error) {
  console.error(
    `runtime_tool_host_boundary_missing:${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}
