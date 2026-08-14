import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`No changes for ${path}`);
  await writeFile(path, next);
}

await edit('src/adapters/paseo/paseo-gateway.ts', (source) => {
  const providerAnchor = `    readonly provider: ManagedEnvironmentProvider;\n    readonly cwd: string;`;
  if (!source.includes(providerAnchor)) throw new Error('gateway provider anchor missing');
  return source.replace(
    providerAnchor,
    `    readonly provider: ManagedEnvironmentProvider;\n    readonly mode: string;\n    readonly cwd: string;`,
  );
});

await edit('src/adapters/paseo/paseo-client-port.ts', (source) => {
  const occurrences = [...source.matchAll(/readonly provider: ManagedEnvironmentProvider;\n\s+readonly cwd: string;/g)];
  if (occurrences.length < 1) throw new Error('client createAgent input anchor missing');
  source = source.replace(
    /readonly provider: ManagedEnvironmentProvider;\n(\s+)readonly cwd: string;/g,
    `readonly provider: ManagedEnvironmentProvider;\n$1readonly mode: string;\n$1readonly cwd: string;`,
  );
  if (!source.includes('mode: defaultModeForProvider(input.provider)'))
    throw new Error('default mode assignment missing');
  source = source.replace(
    'mode: defaultModeForProvider(input.provider)',
    'mode: input.mode',
  );
  source = source.replace(
    /\nfunction defaultModeForProvider\([\s\S]*?\n}\n(?=\n|$)/,
    '\n',
  );
  return source;
});

await edit('src/adapters/paseo/paseo-execution-plane.ts', (source) => {
  const importAnchor = `import { PaseoTurnRunner } from './paseo-turn-runner.js';`;
  if (!source.includes(importAnchor)) throw new Error('execution plane import anchor missing');
  source = source.replace(
    importAnchor,
    `${importAnchor}\nimport { resolvePaseoCompatibilityLaunchPolicy } from './paseo-launch-policy.js';`,
  );
  const createAnchor = `        provider,\n        cwd,`;
  if (!source.includes(createAnchor)) throw new Error('execution plane create anchor missing');
  source = source.replace(
    createAnchor,
    `        provider,\n        mode: resolvePaseoCompatibilityLaunchPolicy(provider).mode,\n        cwd,`,
  );
  return source;
});
