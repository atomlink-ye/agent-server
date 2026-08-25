import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadLocalAgentProject } from '../../infrastructure/filesystem/local-agent-project-loader.js';
import { LocalAgentProjectLock } from '../../infrastructure/filesystem/local-agent-project-lock.js';
import { LocalProjectSkillRegistrar } from '../../infrastructure/filesystem/local-project-skill-registrar.js';
import {
  AgentProjectHttpControlPlane,
  deterministicIdempotencyKey,
} from '../../adapters/http/agent-project-http-control-plane.js';
import { applyAgentProject } from '../../application/projects/apply-agent-project.js';
import { planAgentProject } from '../../application/projects/plan-agent-project.js';
import type { ProjectControlPlane } from '../../application/projects/project-control-plane.js';
import { terminalTaskStatuses } from '../../domain/tasks/task-status.js';
import { AgentProjectApplyError } from '../../application/projects/apply-agent-project.js';
import { LocalAgentProjectLoaderError } from '../../infrastructure/filesystem/local-agent-project-loader.js';

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_TEMPLATE_FILES = 1_000;
const MAX_TEMPLATE_FILE_BYTES = 1 * 1024 * 1024;
const MAX_TEMPLATE_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_TEMPLATE_DEPTH = 32;
const MAX_WATCH_TASKS = 10_000;
const MAX_LEARNING_EDIT_BYTES = 16 * 1024;
const HELP =
  'agentctl init|validate|plan|apply|run|watch|learning list|read|accept|edit-and-accept|reject';

type Parsed = {
  command: string;
  positional: string[];
  flags: Map<string, string>;
};

async function main(): Promise<void> {
  const parsed = parse(process.argv.slice(2));
  if (parsed.command === 'help') {
    if (parsed.positional.length || parsed.flags.size)
      throw new CliError('CLI_INVALID_ARGUMENTS');
    return output({ usage: HELP });
  }
  if (parsed.command === 'init') return init(parsed);
  if (parsed.command === 'learning') return learning(parsed);
  if (parsed.command === 'validate') {
    const manifestPath = manifestPathFor(parsed);
    requireNoPositionals(parsed, 'validate');
    const project = await loadLocalAgentProject({ manifestPath });
    return output({
      project: {
        name: project.manifest.metadata.name,
        fingerprint: project.fingerprint,
        counts: counts(project),
      },
    });
  }
  if (parsed.command === 'plan') {
    const manifestPath = manifestPathFor(parsed);
    requireNoPositionals(parsed, 'plan');
    return output(
      planAgentProject(await loadLocalAgentProject({ manifestPath })),
    );
  }
  const env = connectionEnv(parsed.command === 'apply');
  const controlPlane = new AgentProjectHttpControlPlane(
    env.baseUrl,
    env.token,
    env.workspaceId,
  );
  if (parsed.command === 'apply') {
    const manifestPath = manifestPathFor(parsed);
    requireNoPositionals(parsed, 'apply');
    const project = await loadLocalAgentProject({ manifestPath });
    const result = await applyAgentProject({
      project,
      controlPlane,
      skillRegistrar: new LocalProjectSkillRegistrar(env.skillRegistryRoot),
      lockStore: new LocalAgentProjectLock(dirname(resolve(manifestPath))),
      projectRoot: dirname(resolve(manifestPath)),
    });
    return output({
      projectName: result.projectName,
      completed: result.completed,
      lock: result.lock,
    });
  }
  if (parsed.command === 'run') return run(parsed, controlPlane);
  if (parsed.command === 'watch') return watch(parsed, controlPlane);
  throw new CliError('CLI_INVALID_ARGUMENTS');
}

async function learning(parsed: Parsed): Promise<void> {
  const subcommand = parsed.positional[0];
  if (
    subcommand !== 'list' &&
    subcommand !== 'read' &&
    subcommand !== 'accept' &&
    subcommand !== 'edit-and-accept' &&
    subcommand !== 'reject'
  )
    throw new CliError('CLI_INVALID_ARGUMENTS');
  if (subcommand !== 'edit-and-accept' && parsed.flags.size)
    throw new CliError('CLI_INVALID_ARGUMENTS');
  const id = parsed.positional[1];
  if (subcommand === 'list') {
    if (parsed.positional.length !== 1)
      throw new CliError('CLI_INVALID_ARGUMENTS');
    return output(await learningRequest('GET', '/api/v1/learning-proposals'));
  }
  if (parsed.positional.length !== 2 || !UUID.test(id!))
    throw new CliError('CLI_INVALID_ARGUMENTS');
  if (subcommand === 'edit-and-accept') {
    if (parsed.flags.size !== 1) throw new CliError('CLI_INVALID_ARGUMENTS');
    const content = requiredFlag(parsed, '--content');
    if (
      !content.trim() ||
      Buffer.byteLength(content, 'utf8') > MAX_LEARNING_EDIT_BYTES
    )
      throw new CliError('CLI_INVALID_INPUT');
    return output(
      await learningRequest(
        'POST',
        `/api/v1/learning-proposals/${id}/edit-and-accept`,
        {
          content,
        },
      ),
    );
  }
  return output(
    await learningRequest(
      subcommand === 'read' ? 'GET' : 'POST',
      `/api/v1/learning-proposals/${id}${subcommand === 'read' ? '' : `/${subcommand}`}`,
      subcommand === 'read' ? undefined : {},
    ),
  );
}

async function learningRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const env = connectionEnv(false);
  const url = `${env.baseUrl.replace(/\/$/, '')}${path}${
    path === '/api/v1/learning-proposals'
      ? `?workspace_id=${encodeURIComponent(env.workspaceId)}`
      : ''
  }`;
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${env.token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => {
    throw new CliError('CLI_CONNECTION_UNAVAILABLE');
  });
  if (!response.ok) throw new CliError(`CLI_HTTP_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new CliError('CLI_INVALID_RESPONSE');
  }
}

async function run(
  parsed: Parsed,
  controlPlane: ProjectControlPlane,
): Promise<void> {
  const manifestPath = manifestPathFor(parsed);
  const input = requiredFlag(parsed, '--input');
  if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES || !input.trim())
    throw new CliError('CLI_INVALID_INPUT');
  if (parsed.positional.length > 1) throw new CliError('CLI_INVALID_ARGUMENTS');
  const project = await loadLocalAgentProject({ manifestPath });
  const lock = await new LocalAgentProjectLock(
    dirname(resolve(manifestPath)),
  ).read();
  if (!lock || lock.project.fingerprint !== project.fingerprint)
    throw new CliError('CLI_LOCK_STALE');
  if (lock.workspace.id !== process.env.AGENT_SERVER_WORKSPACE_ID)
    throw new CliError('CLI_LOCK_WORKSPACE_MISMATCH');
  const ref = parsed.positional[0] ?? project.defaultEntrypoint;
  if (!project.entrypoints.includes(ref as never))
    throw new CliError('CLI_ENTRYPOINT_INVALID');
  const entrypoint = lock.entrypoints.find((item) => item.ref === ref);
  if (!entrypoint) throw new CliError('CLI_ENTRYPOINT_UNBOUND');
  const inputDigest = `sha256:${createHash('sha256').update(input).digest('hex')}`;
  const key = deterministicIdempotencyKey(
    'invoke-team',
    project.manifest.metadata.name,
    ref,
    `${project.fingerprint}|${inputDigest}`,
  );
  const invoked = await controlPlane.invokeTeam({
    versionId: entrypoint.teamVersionId,
    input,
    idempotencyKey: key,
  });
  output({ taskId: invoked.taskId, status: invoked.status });
}

async function watch(
  parsed: Parsed,
  controlPlane: ProjectControlPlane,
): Promise<void> {
  if (parsed.positional.length !== 1 || !UUID.test(parsed.positional[0]!))
    throw new CliError('CLI_INVALID_TASK_ID');
  const pollMs = boundedFlag(parsed, '--poll-ms', 250, 50, 10_000);
  const timeoutMs = boundedFlag(
    parsed,
    '--timeout-ms',
    120_000,
    100,
    3_600_000,
  );
  const taskId = parsed.positional[0]!;
  const started = Date.now();
  const statuses = new Map<string, string>();
  while (true) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) {
      output({
        rootTaskId: taskId,
        statuses: sortedStatuses(statuses),
        status: 'timeout',
      });
      process.exitCode = 1;
      return;
    }
    let tree;
    try {
      tree = await controlPlane.getTaskTree(
        taskId,
        AbortSignal.timeout(remaining),
      );
    } catch (error) {
      if (
        (error instanceof Error && error.message === 'control_plane_timeout') ||
        (error instanceof CliError && error.code === 'CLI_TIMEOUT')
      ) {
        output({
          rootTaskId: taskId,
          statuses: sortedStatuses(statuses),
          status: 'timeout',
        });
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    if (tree.rootTaskId !== taskId) throw new CliError('CLI_TASK_TREE_INVALID');
    const seen = new Set<string>();
    for (const item of tree.tasks) {
      if (seen.has(item.taskId)) throw new CliError('CLI_TASK_TREE_INVALID');
      seen.add(item.taskId);
      if (seen.size > MAX_WATCH_TASKS) throw new CliError('CLI_TASK_LIMIT');
      statuses.set(item.taskId, item.status);
    }
    const root = tree.tasks.find((task) => task.taskId === taskId);
    if (!root) throw new CliError('CLI_TASK_TREE_INVALID');
    if (terminalTaskStatuses.has(root.status as never)) {
      output({
        rootTaskId: tree.rootTaskId,
        statuses: sortedStatuses(statuses),
      });
      if (root.status !== 'completed') process.exitCode = 1;
      return;
    }
    const sleep = Math.min(pollMs, timeoutMs - (Date.now() - started));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, sleep));
  }
}

async function init(parsed: Parsed): Promise<void> {
  if (
    parsed.positional.length !== 1 ||
    parsed.flags.size !== 1 ||
    !parsed.flags.has('--template')
  )
    throw new CliError('CLI_INVALID_ARGUMENTS');
  const name = parsed.flags.get('--template')!;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new CliError('CLI_UNSAFE_TEMPLATE');
  const target = resolve(parsed.positional[0]!);
  const template = resolve('templates', name);
  await safeDirectory(template);
  await safeParent(target);
  try {
    await lstat(target);
    throw new CliError('CLI_TARGET_NOT_EMPTY');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let created = false;
  try {
    await mkdir(target, { mode: 0o755 });
    created = true;
    const files: string[] = [];
    await copySafe(template, target, target, files, 0, { files: 0, total: 0 });
    files.sort();
    output({ files });
  } catch (error) {
    if (created) await rm(target, { recursive: true, force: true });
    throw error;
  }
}

async function copySafe(
  source: string,
  target: string,
  root: string,
  files: string[],
  depth: number,
  limits: { files: number; total: number },
): Promise<void> {
  if (depth > MAX_TEMPLATE_DEPTH) throw new CliError('CLI_TEMPLATE_LIMIT');
  for (const entry of (await readdir(source, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )) {
    const from = join(source, entry.name),
      to = join(target, entry.name);
    const stat = await lstat(from);
    if (
      stat.isSymbolicLink() ||
      (!stat.isFile() && !stat.isDirectory()) ||
      (stat.isFile() && (stat.mode & 0o111) !== 0)
    )
      throw new CliError('CLI_UNSAFE_TEMPLATE');
    if (stat.isDirectory()) {
      await mkdir(to, { mode: 0o755 });
      await copySafe(from, to, root, files, depth + 1, limits);
    } else {
      if (
        limits.files >= MAX_TEMPLATE_FILES ||
        stat.size > MAX_TEMPLATE_FILE_BYTES
      )
        throw new CliError('CLI_TEMPLATE_LIMIT');
      const bytes = await readFile(from);
      limits.total += bytes.byteLength;
      if (limits.total > MAX_TEMPLATE_TOTAL_BYTES)
        throw new CliError('CLI_TEMPLATE_LIMIT');
      await writeFile(to, bytes, { mode: 0o644, flag: 'wx' });
      limits.files++;
      files.push(relative(root, to));
    }
  }
}
async function safeDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await realpath(path)) !== path
  )
    throw new CliError('CLI_UNSAFE_TEMPLATE');
}
async function safeParent(path: string): Promise<void> {
  const parent = dirname(path);
  const stat = await lstat(parent);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await realpath(parent)) !== parent
  )
    throw new CliError('CLI_TARGET_PARENT_INVALID');
}

function parse(args: readonly string[]): Parsed {
  if (args.length === 0)
    return { command: 'help', positional: [], flags: new Map() };
  if (args[0] === '--help' || args[0] === '-h')
    return {
      command: 'help',
      positional: args.slice(1).filter((arg) => !arg.startsWith('--')),
      flags: new Map(
        args
          .slice(1)
          .filter((arg) => arg.startsWith('--'))
          .map((arg) => [arg, '']),
      ),
    };
  const command = args[0]!;
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith('--') || flags.has(arg))
      throw new CliError('CLI_INVALID_ARGUMENTS');
    flags.set(arg, value);
  }
  const allowed =
    command === 'init'
      ? ['--template']
      : command === 'validate' || command === 'plan' || command === 'apply'
        ? ['--manifest']
        : command === 'run'
          ? ['--manifest', '--input']
          : command === 'watch'
            ? ['--poll-ms', '--timeout-ms']
            : command === 'learning'
              ? ['--content']
              : [];
  if (
    (!allowed.length && command !== 'help') ||
    [...flags.keys()].some((flag) => !allowed.includes(flag))
  )
    throw new CliError('CLI_INVALID_ARGUMENTS');
  return { command, positional, flags };
}
function requiredFlag(parsed: Parsed, name: string): string {
  const value = parsed.flags.get(name);
  if (!value) throw new CliError('CLI_INVALID_ARGUMENTS');
  return value;
}
function manifestPathFor(parsed: Parsed): string {
  if (parsed.flags.has('--manifest')) return requiredFlag(parsed, '--manifest');
  if (parsed.positional.length && parsed.command !== 'run')
    throw new CliError('CLI_INVALID_ARGUMENTS');
  return resolve('agent-project.yaml');
}
function sortedStatuses(
  statuses: Map<string, string>,
): Array<{ taskId: string; status: string }> {
  return [...statuses.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([taskId, status]) => ({ taskId, status }));
}
function requireNoPositionals(parsed: Parsed, command: string): void {
  if (parsed.command !== command || parsed.positional.length)
    throw new CliError('CLI_INVALID_ARGUMENTS');
}
function boundedFlag(
  parsed: Parsed,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = parsed.flags.get(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new CliError('CLI_INVALID_ARGUMENTS');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new CliError('CLI_INVALID_ARGUMENTS');
  return value;
}
function connectionEnv(requireSkillRegistryRoot: boolean): {
  baseUrl: string;
  token: string;
  workspaceId: string;
  skillRegistryRoot: string;
} {
  const baseUrl = process.env.AGENT_SERVER_BASE_URL,
    token = process.env.AGENT_SERVER_TOKEN,
    workspaceId = process.env.AGENT_SERVER_WORKSPACE_ID,
    skillRegistryRoot = process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT;
  if (
    !baseUrl ||
    !token ||
    !workspaceId ||
    (requireSkillRegistryRoot && !skillRegistryRoot) ||
    !/^https?:\/\//.test(baseUrl)
  )
    throw new CliError('CLI_CONNECTION_NOT_CONFIGURED');
  return {
    baseUrl,
    token,
    workspaceId,
    skillRegistryRoot: skillRegistryRoot ?? '',
  };
}
function counts(
  project: Awaited<ReturnType<typeof loadLocalAgentProject>>,
): Record<string, number> {
  return {
    toolProfiles: project.toolProfiles.size,
    skills: project.skills.size,
    environments: project.environments.size,
    workers: project.workers.size,
    teams: project.teams.size,
    memoryStores: project.memoryStores.size,
    entrypoints: project.entrypoints.length,
  };
}
function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
class CliError extends Error {
  public constructor(readonly code: string) {
    super(code);
  }
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
try {
  await main();
} catch (error) {
  const code =
    error instanceof CliError
      ? error.code
      : error instanceof AgentProjectApplyError
        ? error.code
        : error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'string'
          ? error.code
          : 'CLI_FAILURE';
  const completed =
    error instanceof AgentProjectApplyError ? error.completed : undefined;
  const details =
    error instanceof LocalAgentProjectLoaderError
      ? {
          path: error.path,
          message: error.message,
        }
      : {};
  process.stderr.write(
    `${JSON.stringify({ error: { code, ...details }, ...(completed ? { completed } : {}) })}\n`,
  );
  process.exitCode = 1;
}
