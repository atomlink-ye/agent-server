import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
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
  // Host-authenticated Codex. The daemon environment is the isolated safe set
  // plus the names listed here, so CODEX_HOME must be listed for a developer's
  // existing ChatGPT-subscription login to survive the HOME isolation.
  'CODEX_HOME',
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

/**
 * Carry the developer's ChatGPT-subscription login into the runtime's own
 * Codex home without carrying anything else that lives there.
 *
 * A symlink rather than a copy: Codex refreshes this token, and a copy would
 * leave the runtime rotating a credential the developer's own `codex` no
 * longer shares. If the host has no login the runtime simply has none either,
 * which surfaces as an ordinary Codex auth error rather than a silent
 * fallback.
 */
async function borrowCodexLogin(hostCodexHome, runtimeCodexHome) {
  const source = join(hostCodexHome, 'auth.json');
  const target = join(runtimeCodexHome, 'auth.json');
  try {
    await access(source, constants.R_OK);
  } catch {
    process.stderr.write(
      `with-paseo: no Codex login at ${source}; Codex sessions will be unauthenticated.\n`,
    );
    return;
  }
  await rm(target, { force: true });
  await symlink(source, target);
}

/**
 * The whole configuration a product Agent's Codex needs, and nothing else.
 *
 * `apps = false` because an Agent cannot install or authorize the operator's
 * OpenAI Apps connectors; with the setting absent Codex spends several
 * kilobytes of every session advertising ones it will never have. Trust is
 * declared for the runtime's own directories only -- Codex asks before acting
 * in a directory it has not been told to trust, and those are the only
 * directories a product Agent works in.
 */
function runtimeCodexConfig(directories) {
  return [
    '[features]',
    'apps = false',
    '',
    ...directories.map((directory) =>
      [
        `[projects.${JSON.stringify(directory)}]`,
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    ),
  ].join('\n');
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
  const runtimeCellRoot = resolve(
    repositoryRoot,
    process.env.PASEO_RUNTIME_CELL_ROOT?.trim() ||
      join('.local', 'runtime-cells'),
  );
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true }),
    mkdir(agentWorkspace, { recursive: true }),
    mkdir(runtimeCellRoot, { recursive: true }),
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
  // On Amazon Bedrock (CLAUDE_CODE_USE_BEDROCK=1), Claude Code silently
  // rewrites a bare model name like `claude-sonnet-5` to a cross-region
  // inference profile ID (`us.anthropic.claude-sonnet-5`) before calling the
  // provider. Our LiteLLM passthrough gateway only recognizes the bare model
  // name (confirmed against its own `/v1/models` listing) and rejects the
  // inference-profile-prefixed form with a 400. `modelOverrides` is the
  // documented escape hatch: it intercepts that rewrite and maps the model
  // back to the name the gateway actually serves. Only add it for the
  // Bedrock transport — the Anthropic/OpenCode-Go paths never hit this
  // rewrite and a model bare name there is already correct.
  const claudeSettings =
    process.env.CLAUDE_CODE_USE_BEDROCK === '1'
      ? {
          env: { ANTHROPIC_MODEL: openCodeGoModel },
          modelOverrides: {
            [openCodeGoModel]: openCodeGoModel,
            [`us.anthropic.${openCodeGoModel}`]: openCodeGoModel,
          },
        }
      : { env: { ANTHROPIC_MODEL: openCodeGoModel } };
  await writeFile(claudeSettingsPath, JSON.stringify(claudeSettings), {
    mode: 0o600,
  });
  await chmod(claudeSettingsPath, 0o600);
  const providerHome = join(runtimeRoot, 'home');
  const codexHome = join(providerHome, '.codex');
  // Two ways to authenticate Codex, in priority order:
  //
  // 1. A host developer login. `codex login` stores a ChatGPT-subscription
  //    OAuth token under the real CODEX_HOME, and the runtime isolates HOME,
  //    so the host directory is where that login has to be borrowed from.
  // 2. The opencode-go gateway key, which needs a generated provider config.
  //
  // Selection is explicit: honor a caller-provided CODEX_HOME as the login
  // source, otherwise fall back to the host login when no gateway key is set.
  //
  // Either way the runtime gets its own CODEX_HOME. A developer's real one is
  // not just credentials: Codex reads `AGENTS.md` there as global instructions
  // for every session, plus that developer's MCP servers, plugins and skills.
  // Pointing product Agents at it briefed them with the operator's personal
  // subagent-orchestration handbook and handed them the operator's connectors.
  // Borrow the login; leave the operator's working environment behind.
  const hostCodexHome = process.env.CODEX_HOME?.trim();
  const useHostCodexAuth =
    Boolean(hostCodexHome) || !process.env.OPENCODE_GO_API_KEY?.trim();
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await chmod(codexHome, 0o700);
  if (useHostCodexAuth) {
    await borrowCodexLogin(
      hostCodexHome || join(process.env.HOME ?? homedir(), '.codex'),
      codexHome,
    );
    await writeFile(
      join(codexHome, 'config.toml'),
      runtimeCodexConfig([agentWorkspace, runtimeCellRoot]),
      { mode: 0o600 },
    );
  } else {
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
        runtimeCodexConfig([agentWorkspace, runtimeCellRoot]),
      ].join('\n'),
      { mode: 0o600 },
    );
  }
  process.env.CODEX_HOME = codexHome;
  // Isolating the Codex home alone leaves one channel open: Codex also reads
  // skills from `$HOME/.agents/skills`, outside CODEX_HOME entirely, and the
  // Paseo daemon that spawns the provider inherits the developer's own HOME.
  // The runtime already keeps `.codex` and `.claude` under this directory, so
  // naming it is what makes it the provider's actual home rather than a place
  // two dotfiles happen to live.
  process.env.PASEO_PROVIDER_HOME = providerHome;
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
