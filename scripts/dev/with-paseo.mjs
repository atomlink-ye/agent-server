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
  'PASEO_ADDITIONAL_PROVIDERS',
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
  // AWS Bedrock transport for Claude Code. Exporting these in a shell is not
  // enough on its own: the daemon environment is the isolated safe set plus the
  // names listed here, so an unlisted variable silently leaves the daemon on the
  // Anthropic API path. See src/shared/claude-code-transport.ts.
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'IS_SANDBOX',
  'PASEO_BIN',
  'OPENCODE_BIN',
  'CLAUDE_CODE_BIN',
  'CODEX_BIN',
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

function boundedTail(output) {
  const redacted = Object.entries(process.env).reduce(
    (result, [name, value]) => {
      if (
        !/(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL)/iu.test(name) ||
        !value?.trim()
      ) {
        return result;
      }
      return result.replaceAll(value.trim(), '[redacted]');
    },
    output.trim(),
  );
  return redacted.split(/\r?\n/u).slice(-30).join('\n').slice(-4_000);
}

async function prepareProviderToolchain() {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'tooling/dev/setup-providers.ts', '--json', '--fast'],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  await new Promise((resolveChild, rejectChild) => {
    child.once('error', rejectChild);
    child.once('close', (code, signal) => {
      if (code === 0) resolveChild();
      else
        rejectChild(
          new Error(
            [
              `provider setup failed (${code ?? signal ?? 'unknown'})`,
              boundedTail([stdout, stderr].filter(Boolean).join('\n')),
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        );
    });
  });
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(
      [
        'provider setup returned invalid status',
        boundedTail([stdout, stderr].filter(Boolean).join('\n')),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  const binaries = result?.binaries;
  const names = ['paseo', 'opencode', 'claude', 'codex'];
  if (
    !binaries ||
    names.some(
      (name) =>
        typeof binaries[name] !== 'string' || !binaries[name].startsWith('/'),
    )
  ) {
    throw new Error('provider setup returned incomplete binary paths');
  }
  return binaries;
}

const separator = process.argv.indexOf('--');
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (command.length === 0) {
  process.stderr.write(
    'Usage: node scripts/dev/with-paseo.mjs -- <command> [args...]\n',
  );
  process.exitCode = 2;
} else {
  for (const [name, value] of Object.entries(realProviderDefaults)) {
    if (!process.env[name]?.trim()) process.env[name] = value;
  }
  if (
    realProviderDefaults.PASEO_MODEL.startsWith('opencode-go/') &&
    !process.env.OPENCODE_GO_API_KEY?.trim()
  ) {
    process.stderr.write(
      'OPENCODE_GO_API_KEY is required when PASEO_MODEL uses opencode-go/*.\n',
    );
    process.exit(1);
  }
  const configuredRuntimeRoot = process.env.PASEO_RUNTIME_ROOT?.trim();
  const configuredAgentWorkspace = process.env.PASEO_AGENT_CWD?.trim();
  const runtimeRoot = resolve(
    repositoryRoot,
    configuredRuntimeRoot || join('.local', 'dev-runtime'),
  );
  const agentWorkspace = resolve(
    repositoryRoot,
    configuredAgentWorkspace || join('.local', 'agent-workspace'),
  );
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
  process.env.IS_SANDBOX = '1';
  const startedAt = Date.now();
  const providerBinaries = await prepareProviderToolchain();
  process.stderr.write(
    `with-paseo phase=provider-prep elapsed_ms=${Date.now() - startedAt}\n`,
  );
  process.env.PASEO_BIN = providerBinaries.paseo;
  process.env.OPENCODE_BIN = providerBinaries.opencode;
  process.env.CLAUDE_CODE_BIN = providerBinaries.claude;
  process.env.CODEX_BIN = providerBinaries.codex;
  process.env.PATH = [
    dirname(providerBinaries.paseo),
    dirname(providerBinaries.opencode),
    dirname(providerBinaries.claude),
    dirname(providerBinaries.codex),
    process.env.PATH ?? '',
  ]
    .filter(Boolean)
    .join(':');
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
  let paseo;
  let child;
  let cleanupStarted = false;
  let stopping;
  const ownedChildren = new Set();
  const stop = () => {
    cleanupStarted = true;
    stopping ??= Promise.allSettled(
      [...ownedChildren].map((ownedChild) => stopProcessTree(ownedChild)),
    );
    return stopping;
  };
  const register = (ownedChild) => {
    ownedChildren.add(ownedChild);
    if (cleanupStarted) {
      const childCleanup = stopProcessTree(ownedChild);
      stopping = stopping
        ? Promise.all([stopping, childCleanup]).then(() => undefined)
        : childCleanup;
    }
  };
  const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  let requestedSignal;
  let resolveSignal;
  const signal = new Promise((resolveSignalValue) => {
    resolveSignal = resolveSignalValue;
  });
  const signalHandlers = new Map();
  for (const signalName of Object.keys(signalExitCodes)) {
    const handler = () => {
      if (requestedSignal) return;
      requestedSignal = signalName;
      process.exitCode = signalExitCodes[signalName];
      resolveSignal(signalName);
      void stop();
    };
    signalHandlers.set(signalName, handler);
    process.on(signalName, handler);
  }

  let startupError;
  try {
    paseo = await startPaseo({
      repositoryRoot,
      runtimeRoot,
      port: paseoPort,
      listenHost: paseoListenHost,
      environmentVariableNames: paseoEnvironmentNames,
      onChild: register,
    });
  } catch (error) {
    startupError = error;
  }
  if (startupError && !requestedSignal) throw startupError;
  if (startupError || requestedSignal) {
    await stop();
    for (const [signalName, handler] of signalHandlers) {
      process.removeListener(signalName, handler);
    }
    process.exitCode = signalExitCodes[requestedSignal];
  } else {
    process.stderr.write(
      `with-paseo phase=paseo-start elapsed_ms=${Date.now() - startedAt}\n`,
    );
    child = spawn(command[0], command.slice(1), {
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
    register(child);
    process.stderr.write(
      `with-paseo phase=api-spawn elapsed_ms=${Date.now() - startedAt}\n`,
    );

    const exitCode = await Promise.race([
      new Promise((resolveExit) => {
        child.once('exit', (code, childSignal) => {
          resolveExit(code ?? (childSignal ? 1 : 0));
        });
        child.once('error', (error) => {
          process.stderr.write(`${error.message}\n`);
          resolveExit(1);
        });
      }),
      signal.then((signalName) => {
        return signalExitCodes[signalName];
      }),
    ]);
    await stop();
    for (const [signalName, handler] of signalHandlers) {
      process.removeListener(signalName, handler);
    }
    process.exitCode = requestedSignal
      ? signalExitCodes[requestedSignal]
      : exitCode;
  }
}
