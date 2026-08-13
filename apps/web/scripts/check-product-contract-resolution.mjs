#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

const webRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(webRoot, '../..');
const specifier = readSpecifier(process.argv.slice(2));
const nextConfigLoader = createRequire(path.join(webRoot, 'package.json'))(
  'next/dist/server/config',
).default;
const nextConfig = await nextConfigLoader('phase-production-build', webRoot, {
  silent: true,
});
const extensionAlias = nextConfig.experimental?.extensionAlias;
if (
  !extensionAlias ||
  JSON.stringify(extensionAlias) !== JSON.stringify({ '.js': ['.js', '.ts'] })
) {
  throw new Error(
    `apps/web/next.config.ts must expose experimental.extensionAlias { ".js": [".js", ".ts"] }; received ${JSON.stringify(extensionAlias)}`,
  );
}

let temporaryApp;
let exitCode = 0;

try {
  checkZodResolution();

  temporaryApp = mkdtempSync(
    path.join(webRoot, '.tmp-product-contract-resolution-'),
  );
  writeTemporaryNextApp(temporaryApp, specifier);

  const nextBinary = path.join(
    webRoot,
    'node_modules',
    'next',
    'dist',
    'bin',
    'next',
  );
  const result = spawnSync(
    process.execPath,
    [nextBinary, 'build', temporaryApp],
    {
      cwd: temporaryApp,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      encoding: 'utf8',
    },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output) process.stdout.write(output);

  if (result.error) {
    throw new Error(
      `Next consumer bundle could not be started for module ${specifier}: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    process.stderr.write(
      `Product contract consumer bundle failed for module ${specifier} (specifier ${specifier}).\n`,
    );
    exitCode = result.status ?? 1;
  } else {
    process.stdout.write(
      `Product contract consumer bundle resolved module ${specifier}.\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  exitCode = 1;
} finally {
  if (temporaryApp) rmSync(temporaryApp, { recursive: true, force: true });
}

process.exitCode = exitCode;

function readSpecifier(args) {
  if (args.length === 0) return '@atomlink-ye/agent-server/product-contract';
  if (args.length === 2 && args[0] === '--specifier' && args[1]) return args[1];
  throw new Error(
    'Usage: node apps/web/scripts/check-product-contract-resolution.mjs [--specifier <literal>]',
  );
}

function checkZodResolution() {
  const rootZod = resolveZod(repoRoot);
  const webZod = resolveZod(webRoot);
  const samePath = rootZod.realpath === webZod.realpath;
  const sameVersion = rootZod.version === '4.4.3' && webZod.version === '4.4.3';

  process.stdout.write(
    `zod resolution: root=${rootZod.realpath} (${rootZod.version}), web=${webZod.realpath} (${webZod.version})\n`,
  );
  if (!samePath || !sameVersion) {
    throw new Error(
      `zod resolution mismatch: root ${rootZod.realpath} (${rootZod.version}) vs web ${webZod.realpath} (${webZod.version})`,
    );
  }
}

function resolveZod(fromDirectory) {
  const requireFromDirectory = createRequire(
    path.join(fromDirectory, 'package.json'),
  );
  const packageJsonPath = requireFromDirectory.resolve('zod/package.json');
  const realpath = realpathSync(packageJsonPath);
  const packageJson = JSON.parse(readFileSync(realpath, 'utf8'));
  if (typeof packageJson.version !== 'string') {
    throw new Error(`zod package at ${realpath} has no version`);
  }
  return { realpath, version: packageJson.version };
}

function writeTemporaryNextApp(directory, importSpecifier) {
  writeFileSync(
    path.join(directory, 'next.config.mjs'),
    `export default ${JSON.stringify({
      experimental: { extensionAlias },
      transpilePackages: nextConfig.transpilePackages,
      outputFileTracingRoot: nextConfig.outputFileTracingRoot,
    })};\n`,
  );
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n',
  );
  // Reuse the web consumer's compiler settings so Next's post-build typecheck
  // exercises the same module-resolution contract as the real application.
  writeFileSync(
    path.join(directory, 'tsconfig.json'),
    readFileSync(path.join(webRoot, 'tsconfig.json'), 'utf8'),
  );
  const appDirectory = path.join(directory, 'app');
  mkdirSync(appDirectory, { recursive: true });
  writeFileSync(
    path.join(appDirectory, 'layout.tsx'),
    `import type { ReactNode } from 'react';\n\nexport default function Layout({ children }: { children: ReactNode }) { return <html><body>{children}</body></html>; }\n`,
  );
  // The generated module is intentionally a static import: Webpack must resolve
  // the package export and its .js-to-.ts source imports during the Next build.
  writeFileSync(
    path.join(appDirectory, 'page.tsx'),
    `import * as ProductContract from ${JSON.stringify(importSpecifier)};\n\nexport default function Page() {\n  return <main>{Object.keys(ProductContract).length > 0 ? 'resolved' : 'missing'}</main>;\n}\n`,
  );
}
