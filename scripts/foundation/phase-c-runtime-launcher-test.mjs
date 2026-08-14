import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const launcher = resolve(ROOT, 'scripts/dev/paseo-runtime.mjs');
const visited = new Set();
const bareImports = [];
const nodeModulesReferences = [];
const importPattern = /(?:from\s+|import\s*\()(['"])([^'"]+)\1/gu;

function visit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const source = readFileSync(path, 'utf8');
  if (/\b(?:\/workspace\/)?node_modules\b/u.test(source))
    nodeModulesReferences.push(path);
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2];
    if (specifier.startsWith('node:')) continue;
    if (!specifier.startsWith('.')) {
      bareImports.push({ path, specifier });
      continue;
    }
    visit(resolve(dirname(path), specifier));
  }
}

visit(launcher);
if (bareImports.length)
  throw new Error(
    `launcher closure has bare imports: ${JSON.stringify(bareImports)}`,
  );
if (nodeModulesReferences.length)
  throw new Error(
    `launcher closure references node_modules: ${JSON.stringify(nodeModulesReferences)}`,
  );

for (const composePath of [
  'compose.external-runtime.yaml',
  'evidence/foundation/compose.runtime.canonical.yaml',
]) {
  const source = readFileSync(resolve(ROOT, composePath), 'utf8');
  const runtime = source.match(
    /^  paseo-runtime:\n([\s\S]*?)(?=^  agent-server:)/mu,
  )?.[0];
  const stateInit = source.match(
    /^  paseo-runtime-state-init:\n([\s\S]*?)(?=^  paseo-runtime:)/mu,
  )?.[0];
  const agent = source.match(
    /^  agent-server:\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:)/mu,
  )?.[0];
  if (!stateInit || !runtime || !agent)
    throw new Error(`${composePath}: services missing`);
  for (const required of [
    "user: '0:0'",
    'read_only: true',
    'network_mode: none',
    '- ALL',
    '- CHOWN',
    '- no-new-privileges:true',
    '- paseo-runtime-state:/runtime-state',
    'entrypoint: []',
    "restart: 'no'",
    'chown 0:0 /runtime-state && chmod 0700 /runtime-state && chown 1000:1000 /runtime-state',
  ]) {
    if (!stateInit.includes(required))
      throw new Error(`${composePath}: state init missing ${required}`);
  }
  for (const forbidden of [
    'environment:',
    '/workspace',
    'provider-toolchain',
    'ports:',
  ]) {
    if (stateInit.includes(forbidden))
      throw new Error(`${composePath}: state init contains ${forbidden}`);
  }
  if (!runtime.includes('paseo-runtime-state-init:'))
    throw new Error(`${composePath}: runtime state init dependency is missing`);
  if (!/^    entrypoint: \[\]\s*$/mu.test(runtime))
    throw new Error(`${composePath}: runtime entrypoint is not empty`);
  if (
    !/^    command: \['node', 'scripts\/dev\/paseo-runtime\.mjs'\]\s*$/mu.test(
      runtime,
    )
  )
    throw new Error(`${composePath}: runtime command is not direct`);
  if (!runtime.includes('provider-toolchain:/opt/provider-toolchain-volume:ro'))
    throw new Error(`${composePath}: runtime provider mount is not read-only`);
  if (!runtime.includes('paseo-runtime-state:/runtime-state'))
    throw new Error(`${composePath}: runtime state volume is missing`);
  if (!/^    volumes: !override\s*$/mu.test(agent))
    throw new Error(`${composePath}: agent volume override is missing`);
  if (agent.includes(':/opt/provider-toolchain-volume'))
    throw new Error(`${composePath}: agent owns provider mount`);
  if (!/^    environment: !override\s*$/mu.test(agent))
    throw new Error(`${composePath}: agent environment override is missing`);
  const agentEnvironmentNames = [
    ...agent.matchAll(/^      ([A-Z0-9_]+):/gmu),
  ].map((match) => match[1]);
  const expectedAgentEnvironmentNames = [
    'NODE_ENV',
    'CI',
    'HOST',
    'PORT',
    'LOG_LEVEL',
    'SERVICE_NAME',
    'AGENT_SERVER_DISPATCHER_CONCURRENCY',
    'DATABASE_URL',
    'POSTGRES_URL',
    'SERVICE_ACCOUNTS_JSON',
    'PASEO_WS_URL',
  ];
  if (
    JSON.stringify(agentEnvironmentNames) !==
    JSON.stringify(expectedAgentEnvironmentNames)
  )
    throw new Error(`${composePath}: agent environment override is not exact`);
  for (const name of [
    'OPENCODE_GO_API_KEY',
    'PASEO_PROVIDER',
    'PASEO_MODEL',
    'PASEO_EXECUTION_TIMEOUT_MS',
    'PASEO_SESSION_RPC_TIMEOUT_MS',
  ]) {
    if (agentEnvironmentNames.includes(name))
      throw new Error(`${composePath}: agent retains ${name}`);
  }
  if (!/^      PASEO_WS_URL: ws:\/\/paseo-runtime:16767\/ws\s*$/mu.test(agent))
    throw new Error(`${composePath}: agent socket boundary is missing`);
}

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', launcher_files: visited.size, bare_imports: 0, node_modules_references: 0, agent_provider_environment: false, agent_provider_mount: false })}\n`,
);
