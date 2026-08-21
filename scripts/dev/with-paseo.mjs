import { spawn } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
} from './paseo-process.mjs';
import {
  createOpenCodeConfigContent,
  deriveOpenCodeGoModelId,
  loadRealProviderDefaults,
} from './real-provider-defaults.mjs';
import { createApplicationEnvironment } from './with-paseo-environment.mjs';
const paseoEnvironmentNames = [
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

const realProviderDefaults = loadRealProviderDefaults();
const openCodeGoModel = realProviderDefaults.PASEO_MODEL.startsWith(
  'opencode-go/',
)
  ? deriveOpenCodeGoModelId(realProviderDefaults.PASEO_MODEL)
  : realProviderDefaults.PASEO_MODEL;
const anthropicDefaults = {
  ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go',
  ANTHROPIC_MODEL: openCodeGoModel,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: openCodeGoModel,
  ANTHROPIC_DEFAULT_SONNET_MODEL: openCodeGoModel,
  ANTHROPIC_DEFAULT_OPUS_MODEL: openCodeGoModel,
  ANTHROPIC_SMALL_FAST_MODEL: openCodeGoModel,
  CLAUDE_CODE_SUBAGENT_MODEL: openCodeGoModel,
};

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const separator = process.argv.indexOf('--');
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (command.length === 0) {
  process.stderr.write(
    'Usage: node scripts/dev/with-paseo.mjs -- <command> [args...]\n',
  );
  process.exitCode = 2;
} else {
  if (
    realProviderDefaults.PASEO_MODEL.startsWith('opencode-go/') &&
    !process.env.OPENCODE_GO_API_KEY?.trim()
  ) {
    process.stderr.write(
      'OPENCODE_GO_API_KEY is required when PASEO_MODEL uses opencode-go/*.\n',
    );
    process.exit(1);
  }
  const runtimeRoot = join(repositoryRoot, '.local', 'dev-runtime');
  const agentWorkspace = join(repositoryRoot, '.local', 'agent-workspace');
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true }),
    mkdir(agentWorkspace, { recursive: true }),
  ]);
  for (const name of paseoEnvironmentNames) {
    if (!process.env[name]?.trim()) delete process.env[name];
  }
  const paseoPort = process.env.PASEO_PORT
    ? Number.parseInt(process.env.PASEO_PORT, 10)
    : await getAvailablePort();
  const paseoListenHost = process.env.PASEO_LISTEN_HOST ?? '127.0.0.1';
  if (process.env.OPENCODE_GO_API_KEY?.trim()) {
    if (!process.env.OPENCODE_CONFIG_CONTENT?.trim()) {
      process.env.OPENCODE_CONFIG_CONTENT = createOpenCodeConfigContent({
        model: realProviderDefaults.PASEO_MODEL,
      });
    }
    for (const [name, value] of Object.entries(anthropicDefaults)) {
      if (!process.env[name]?.trim()) process.env[name] = value;
    }
    process.env.ANTHROPIC_BASE_URL = anthropicDefaults.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_API_KEY = process.env.OPENCODE_GO_API_KEY.trim();
  }
  const claudeHome = join(runtimeRoot, 'home', '.claude');
  const claudeSettingsPath = join(claudeHome, 'settings.json');
  await mkdir(claudeHome, { recursive: true, mode: 0o700 });
  await chmod(claudeHome, 0o700);
  await writeFile(
    claudeSettingsPath,
    JSON.stringify({ env: { ANTHROPIC_MODEL: openCodeGoModel } }),
    { mode: 0o600 },
  );
  await chmod(claudeSettingsPath, 0o600);
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
  const paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: paseoPort,
    listenHost: paseoListenHost,
    environmentVariableNames: paseoEnvironmentNames,
  });

  const child = spawn(command[0], command.slice(1), {
    cwd: repositoryRoot,
    env: createApplicationEnvironment({
      paseoEnvironment: paseo.environment,
      environment: process.env,
      paseoWsUrl: paseo.wsUrl,
      agentWorkspace,
    }),
    detached: process.platform !== 'win32',
    stdio: 'inherit',
  });

  const stop = async () => {
    await Promise.all([stopProcessTree(child), stopProcessTree(paseo.child)]);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void stop();
    });
  }

  const exitCode = await new Promise((resolveExit) => {
    child.once('exit', (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
    child.once('error', () => resolveExit(1));
  });
  await stopProcessTree(paseo.child);
  process.exitCode = exitCode;
}
