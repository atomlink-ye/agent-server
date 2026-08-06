#!/usr/bin/env node

/*
 * Provider probe driver. It is intentionally an orchestration harness: the
 * provider/agent owns interpretation of the probe; this process only writes
 * native configuration, starts turns, and preserves raw command evidence.
 */
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const providers = new Set(['claude', 'codex', 'opencode']);
const probes = new Set(['p1', 'p2', 'p3']);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultServerScript = join(scriptDir, 'mcp-probe-server.mjs');

function help() {
  return `Usage: node scripts/probes/run-provider-probes.mjs [options]

Run a provider-agnostic MCP probe through Paseo 0.1.110.

Required:
  --provider <claude|codex|opencode>
  --probe <p1|p2|p3>

Options:
  --artifacts <dir>       Evidence directory (default: .local/provider-probes/<timestamp>)
  --repo <dir>            Agent working directory (default: current directory)
  --server-script <path>  MCP probe server path (default: this script's sibling)
  --sleep-seconds <n>     probe_sleep duration for p3 (default: 3)
  --tool-timeout-ms <n>   provider MCP timeout override for P4 (positive integer)
  --paseo <path>          Paseo executable (default: PASEO_BIN or paseo)
  --paseo-host <host>     Paseo daemon host passed to each command
  --mode <mode>           Provider permission mode (provider default is used when omitted)
  --help                  Show this help

The driver never parses provider responses beyond extracting an agent id needed
for paseo send/logs; all stdout, stderr, JSON, and logs are retained raw.\n`;
}

function parseArgs(argv) {
  const options = { sleepSeconds: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    i += 1;
    const names = {
      artifacts: 'artifacts',
      repo: 'repo',
      'server-script': 'serverScript',
      'sleep-seconds': 'sleepSeconds',
      'tool-timeout-ms': 'toolTimeoutMs',
      paseo: 'paseo',
      'paseo-host': 'paseoHost',
      mode: 'mode',
      provider: 'provider',
      probe: 'probe',
    };
    if (!names[key]) throw new Error(`Unknown argument: ${arg}`);
    options[names[key]] = value;
  }
  if (!options.provider || !providers.has(options.provider)) {
    throw new Error('--provider must be claude, codex, or opencode');
  }
  if (!options.probe || !probes.has(options.probe)) {
    throw new Error('--probe must be p1, p2, or p3');
  }
  options.sleepSeconds = Number(options.sleepSeconds);
  if (!Number.isFinite(options.sleepSeconds) || options.sleepSeconds < 0 || options.sleepSeconds > 3600) {
    throw new Error('--sleep-seconds must be a number from 0 to 3600');
  }
  if (options.toolTimeoutMs !== undefined) {
    options.toolTimeoutMs = Number(options.toolTimeoutMs);
    if (!Number.isInteger(options.toolTimeoutMs) || options.toolTimeoutMs <= 0) {
      throw new Error('--tool-timeout-ms must be a positive integer');
    }
  }
  return options;
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=+@,-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function commandText(command) {
  return command.map(shellQuote).join(' ');
}

function appendTranscript(state, line) {
  state.transcript += `${line}\n`;
}

function runCommand(command, { cwd, env, state, name }) {
  const [executable, ...args] = command;
  const prefix = join(state.artifacts, name);
  appendTranscript(state, `$ ${commandText(command)}`);
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => err.push(Buffer.from(chunk)));
    child.once('error', rejectRun);
    child.once('close', async (code, signal) => {
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err);
      try {
        await writeFile(`${prefix}.stdout`, stdout);
        await writeFile(`${prefix}.stderr`, stderr);
      } catch (error) {
        rejectRun(error);
        return;
      }
      appendTranscript(state, `# ${name}: exit=${code ?? 'null'} signal=${signal ?? 'none'}`);
      resolveRun({ code, signal, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
    });
  });
}

async function readJsonOrEmpty(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`Cannot parse provider config ${path}: ${error?.message ?? String(error)}`);
  }
}

async function registerProvider({ provider, repo, serverScript, logPath, controlPath, state, toolTimeoutMs }) {
  const command = process.execPath;
  const args = [serverScript];
  const serverEnv = { MCP_PROBE_LOG: logPath, MCP_PROBE_CONTROL: controlPath };
  const entry = {
    command,
    args,
    env: serverEnv,
  };
  let path;
  let original = null;
  let existed = false;
  let restore;
  if (provider === 'claude') {
    path = join(repo, '.mcp.json');
    existed = await fileExists(path);
    original = existed ? await readFile(path) : null;
    const config = await readJsonOrEmpty(path);
    config.mcpServers ??= {};
    config.mcpServers['provider-probe'] = entry;
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  } else if (provider === 'opencode') {
    path = join(repo, 'opencode.json');
    existed = await fileExists(path);
    original = existed ? await readFile(path) : null;
    const config = await readJsonOrEmpty(path);
    config.mcp ??= {};
    config.mcp['provider-probe'] = { type: 'local', command: [command, ...args], environment: serverEnv, timeout: toolTimeoutMs ?? undefined, enabled: true };
    if (toolTimeoutMs === undefined) delete config.mcp['provider-probe'].timeout;
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  } else {
    const codexHome = process.env.CODEX_HOME?.trim() || join(process.env.HOME || homedir(), '.codex');
    path = join(codexHome, 'config.toml');
    existed = await fileExists(path);
    original = existed ? await readFile(path) : null;
    const before = existed ? original.toString('utf8') : '';
    const timeoutLine = toolTimeoutMs === undefined ? '' : `tool_timeout_sec = ${toolTimeoutMs / 1000}\n`;
    const block = `\n[mcp_servers.provider-probe]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n${timeoutLine}[mcp_servers.provider-probe.env]\nMCP_PROBE_LOG = ${JSON.stringify(logPath)}\nMCP_PROBE_CONTROL = ${JSON.stringify(controlPath)}\n`;
    if (/^\[mcp_servers\.provider-probe\]/m.test(before)) {
      throw new Error(`Codex config already has [mcp_servers.provider-probe]; refusing to overwrite ${path}`);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${before.trimEnd()}${block}`, { mode: 0o600 });
  }
  appendTranscript(state, `# registered ${provider} MCP server at ${path}`);
  restore = async () => {
    if (original === null) await rm(path, { force: true });
    else await writeFile(path, original);
  };
  return { path, restore };
}

async function fileExists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

function extractAgentId(stdout) {
  try {
    const value = JSON.parse(stdout);
    const queue = [value];
    while (queue.length) {
      const item = queue.shift();
      if (!item || typeof item !== 'object') continue;
      for (const key of ['agentId', 'agent_id', 'id']) {
        if (typeof item[key] === 'string' && item[key]) return item[key];
      }
      queue.push(...Object.values(item));
    }
  } catch {
    // The raw output is retained; inability to identify an id is surfaced below.
  }
  return null;
}

function providerMode(provider, explicit) {
  if (explicit) return explicit;
  return { claude: 'bypassPermissions', codex: 'full-access', opencode: 'build' }[provider];
}

function commonRunCommand({ options, prompt, paseo }) {
  const model = options.provider === 'opencode' ? 'opencode-go/deepseek-v4-flash' : 'deepseek-v4-flash';
  const command = [paseo, 'run', '--json', '--provider', options.provider, '--model', model, '--mode', providerMode(options.provider, options.mode), '--cwd', options.repo];
  if (options.provider === 'claude' && options.toolTimeoutMs !== undefined) command.push('--env', `MCP_TOOL_TIMEOUT=${options.toolTimeoutMs}`);
  command.push(prompt);
  if (options.paseoHost) command.splice(3, 0, '--host', options.paseoHost);
  return command;
}

async function captureLogs({ options, paseo, agentId, state, index }) {
  if (!agentId) return;
  const command = [paseo, 'logs', '--tail', '500', agentId];
  if (options.paseoHost) command.splice(2, 0, '--host', options.paseoHost);
  await runCommand(command, { cwd: options.repo, env: process.env, state, name: `paseo-logs-${index}` });
}

async function waitForControlConsumption(controlPath, state, artifacts) {
  const started = Date.now();
  const snapshots = [];
  while (Date.now() - started < 5_000) {
    let contents = '';
    try { contents = await readFile(controlPath, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    snapshots.push(contents);
    if (!contents.trim()) {
      await writeFile(join(artifacts, 'control-consumed.raw'), snapshots.join('--- poll ---\n'));
      appendTranscript(state, '# out-of-band control consumed (raw state saved)');
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  await writeFile(join(artifacts, 'control-consumed.raw'), snapshots.join('--- poll ---\n'));
  throw new Error('timed out waiting for MCP control file consumption');
}

async function main(options) {
  const repo = resolve(options.repo || process.cwd());
  const serverScript = resolve(options.serverScript || defaultServerScript);
  const artifacts = resolve(options.artifacts || join(repo, '.local', 'provider-probes', `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`));
  await mkdir(artifacts, { recursive: true });
  const state = { artifacts, transcript: '' };
  const probeLog = join(artifacts, 'mcp-probe.jsonl');
  const controlPath = join(artifacts, 'mcp-probe-control.json');
  const paseo = options.paseo || process.env.PASEO_BIN || 'paseo';
  const config = await registerProvider({ provider: options.provider, repo, serverScript, logPath: probeLog, controlPath, state, toolTimeoutMs: options.toolTimeoutMs });
  const env = { ...process.env };
  let sequence = 0;
  try {
    const prompts = {
      p1: 'Use the configured provider-probe MCP server. In this turn call probe_ping, then probe_arm, and complete the turn.',
      p2: 'Use the configured provider-probe MCP server. In this turn call probe_ping, then complete the turn. Do not call probe_arm.',
      p3: `Use the configured provider-probe MCP server and call probe_sleep with seconds=${options.sleepSeconds}. Complete only after the call returns.`,
    };
    const first = await runCommand(commonRunCommand({ options, prompt: prompts[options.probe], paseo }), { cwd: repo, env, state, name: `paseo-run-${sequence++}` });
    const agentId = extractAgentId(first.stdout);
    if (!agentId) throw new Error('initial paseo run did not yield an agent id; raw artifacts retained');
    await captureLogs({ options, paseo, agentId, state, index: sequence++ });
    if (options.probe === 'p1' || options.probe === 'p2') {
      if (options.probe === 'p2') {
        await writeFile(controlPath, JSON.stringify({ action: 'arm', notify: false, token: randomUUID() }) + '\n', { mode: 0o600 });
        appendTranscript(state, `# wrote out-of-band arm control ${controlPath}`);
        await waitForControlConsumption(controlPath, state, artifacts);
      }
      {
        const continuation = [paseo, 'send', '--json', '--no-wait', agentId, options.probe === 'p2'
          ? 'Call probe_secret and report the exact string; if you have no such tool reply NO_SUCH_TOOL.'
          : 'Call probe_secret and report the exact string; if you have no such tool reply NO_SUCH_TOOL.'];
        if (options.paseoHost) continuation.splice(2, 0, '--host', options.paseoHost);
        await runCommand(continuation, { cwd: repo, env, state, name: `paseo-send-${sequence++}` });
        const waitCommand = [paseo, 'wait', agentId];
        if (options.paseoHost) waitCommand.splice(2, 0, '--host', options.paseoHost);
        await runCommand(waitCommand, { cwd: repo, env, state, name: `paseo-wait-${sequence++}` });
        await captureLogs({ options, paseo, agentId, state, index: sequence++ });
      }
    }
  } finally {
    await config.restore();
    await writeFile(join(artifacts, 'command-transcript.txt'), state.transcript);
  }
  process.stdout.write(`${JSON.stringify({ provider: options.provider, probe: options.probe, artifacts })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(help());
    else await main(options);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n\n${help()}`);
    process.exitCode = 2;
  }
}

export { extractAgentId, help, main, parseArgs, registerProvider };
