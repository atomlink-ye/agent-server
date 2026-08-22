import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
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
  'PASEO_CONNECT_TIMEOUT_MS',
  'PASEO_EXECUTION_TIMEOUT_MS',
  'PASEO_SESSION_RPC_TIMEOUT_MS',
  'PASEO_DAEMON_STARTUP_TIMEOUT_MS',
  'PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS',
  'PASEO_PROVIDER_REFRESH_TIMEOUT_MS',
  'PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS',
  'PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS',
  'PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS',
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

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const runtimeRoot = resolve(
  process.env.PASEO_RUNTIME_ROOT ??
    join(repositoryRoot, '.local', 'paseo-runtime'),
);
const defaults = loadRealProviderDefaults();
const port = Number.parseInt(process.env.PASEO_PORT ?? '16767', 10);
const listenHost = process.env.PASEO_LISTEN_HOST ?? '0.0.0.0';
const gatewayBaseUrl = 'https://opencode.ai/zen/go';

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
const model = deriveOpenCodeGoModelId(defaults.PASEO_MODEL);
const providerConfigurations = [
  {
    provider: 'claude',
    path: join(runtimeRoot, 'home', '.claude', 'settings.json'),
    format: 'json',
    content: ({ model: configuredModel }) =>
      JSON.stringify({ env: { ANTHROPIC_MODEL: configuredModel } }),
  },
  {
    provider: 'codex',
    path: join(runtimeRoot, 'home', '.codex', 'config.toml'),
    format: 'toml',
    content: () =>
      [
        'model_provider = "opencode-go"',
        '',
        '[model_providers.opencode-go]',
        'name = "OpenCode Go"',
        `base_url = "${gatewayBaseUrl}/v1"`,
        'env_key = "OPENCODE_GO_API_KEY"',
        'wire_api = "responses"',
        '',
      ].join('\n'),
  },
  {
    provider: 'opencode',
    path: join(runtimeRoot, 'xdg-config', 'opencode', 'opencode.json'),
    format: 'json',
    content: ({ model: configuredModel }) =>
      createOpenCodeConfigContent({ model: `opencode-go/${configuredModel}` }),
  },
];

for (const configuration of providerConfigurations) {
  try {
    await access(configuration.path);
    process.stdout.write(
      `${JSON.stringify({ provider: configuration.provider, path: configuration.path, action: 'exists' })}\n`,
    );
    continue;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(configuration.path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      configuration.path,
      configuration.content({ gatewayBaseUrl, model }),
      { mode: 0o600, flag: 'wx' },
    );
    await chmod(configuration.path, 0o600);
    process.stdout.write(
      `${JSON.stringify({ provider: configuration.provider, path: configuration.path, action: 'created' })}\n`,
    );
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    process.stdout.write(
      `${JSON.stringify({ provider: configuration.provider, path: configuration.path, action: 'exists' })}\n`,
    );
  }
}

if (process.env.OPENCODE_GO_API_KEY?.trim()) {
  process.env.OPENCODE_CONFIG_CONTENT ||= createOpenCodeConfigContent({
    model: defaults.PASEO_MODEL,
  });
  process.env.ANTHROPIC_BASE_URL ||= gatewayBaseUrl;
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
