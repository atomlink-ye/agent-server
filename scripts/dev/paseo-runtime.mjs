import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startPaseo, stopProcessTree } from './paseo-process.mjs';
import {
  createOpenCodeConfigContent,
  deriveOpenCodeGoModelId,
  loadRealProviderDefaults,
} from './real-provider-defaults.mjs';

const forwardedEnvironmentNames = [
  'PASEO_PROVIDER',
  'PASEO_MODEL',
  'OPENCODE_GO_API_KEY',
  'OPENCODE_CONFIG_CONTENT',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeRoot = resolve(
  process.env.PASEO_RUNTIME_ROOT ?? join(repositoryRoot, '.local', 'paseo-runtime'),
);
const defaults = loadRealProviderDefaults();
const port = Number.parseInt(process.env.PASEO_PORT ?? '16767', 10);
const listenHost = process.env.PASEO_LISTEN_HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PASEO_PORT must be a valid TCP port');
}
if (
  defaults.PASEO_MODEL.startsWith('opencode-go/') &&
  !process.env.OPENCODE_GO_API_KEY?.trim()
) {
  throw new Error('OPENCODE_GO_API_KEY is required for opencode-go models');
}

await mkdir(runtimeRoot, { recursive: true });
if (process.env.OPENCODE_GO_API_KEY?.trim()) {
  const model = deriveOpenCodeGoModelId(defaults.PASEO_MODEL);
  process.env.OPENCODE_CONFIG_CONTENT ||= createOpenCodeConfigContent({
    model: defaults.PASEO_MODEL,
  });
  process.env.ANTHROPIC_BASE_URL ||= 'https://opencode.ai/zen/go';
  process.env.ANTHROPIC_API_KEY ||= process.env.OPENCODE_GO_API_KEY;
  for (const name of [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
  ]) {
    process.env[name] ||= model;
  }
  const codexHome = join(runtimeRoot, 'home', '.codex');
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(
    join(codexHome, 'config.toml'),
    [
      'model_provider = "opencode-go"',
      '',
      '[model_providers.opencode-go]',
      'name = "OpenCode Go"',
      'base_url = "https://opencode.ai/zen/go/v1"',
      'env_key = "OPENCODE_GO_API_KEY"',
      'wire_api = "responses"',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
}

const paseo = await startPaseo({
  repositoryRoot,
  runtimeRoot,
  port,
  listenHost,
  environmentVariableNames: forwardedEnvironmentNames,
});

const stop = () => stopProcessTree(paseo.child);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void stop());
}
const exitCode = await new Promise((resolveExit) => {
  paseo.child.once('exit', (code, signal) =>
    resolveExit(code ?? (signal ? 1 : 0)),
  );
  paseo.child.once('error', () => resolveExit(1));
});
process.exitCode = exitCode;
