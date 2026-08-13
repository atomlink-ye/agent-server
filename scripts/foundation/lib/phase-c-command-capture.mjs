import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const SECRET_NAME =
  /(?:api[_-]?key|authorization|credential|password|secret|token)/iu;
const REDACTED = '[REDACTED]';
const MAX_TAIL_LINES = 40;
const MAX_TAIL_BYTES = 8192;

function boundedTail(value) {
  const lines = value.split(/\r?\n/u).slice(-MAX_TAIL_LINES).join('\n');
  return Buffer.from(lines).subarray(-MAX_TAIL_BYTES).toString('utf8');
}

function safeIdentity(value) {
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(value))
    throw new Error('command capture identity must be lowercase and safe');
  return value;
}

export function secretValuesFromEnvironment(environment) {
  return Object.entries(environment)
    .filter(
      ([name, value]) => SECRET_NAME.test(name) && String(value).length >= 4,
    )
    .map(([, value]) => String(value));
}

export function createCommandRunner({
  root,
  artifactRoot,
  defaultEnvironment,
  secretValues = [],
  transcriptSink = [],
  artifactSink = [],
}) {
  const logRoot = resolve(artifactRoot, 'command-logs');
  mkdirSync(logRoot, { recursive: true, mode: 0o700 });
  const knownSecrets = [
    ...new Set(secretValues.filter((value) => value.length >= 4)),
  ].sort((left, right) => right.length - left.length);
  let sequence = 0;

  function redact(input) {
    let output = String(input ?? '');
    for (const secret of knownSecrets)
      output = output.split(secret).join(REDACTED);
    output = output
      .replace(/(bearer\s+)[a-z0-9._~+/=-]+/giu, `$1${REDACTED}`)
      .replace(
        /((?:api[_-]?key|authorization|credential|password|secret|token)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/giu,
        `$1${REDACTED}`,
      )
      .replace(
        /(["'](?:[^"']*(?:api[_-]?key|authorization|credential|password|secret|token)[^"']*)["']\s*:\s*["'])([^"']+)(["'])/giu,
        `$1${REDACTED}$3`,
      );
    if (knownSecrets.some((secret) => output.includes(secret)))
      throw new Error('safe_capture_failed:known_secret_remains');
    return output;
  }

  return function run(
    command,
    args,
    {
      allow = [0],
      env = defaultEnvironment,
      identity = 'child-command',
      captureStdout = true,
    } = {},
  ) {
    sequence += 1;
    const prefix = `${String(sequence).padStart(3, '0')}-${safeIdentity(identity)}`;
    const stdoutPath = resolve(logRoot, `${prefix}.stdout.log`);
    const stderrPath = resolve(logRoot, `${prefix}.stderr.log`);
    const value = spawnSync(command, args, {
      cwd: root,
      env,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    transcriptSink.push(value.stdout ?? '', value.stderr ?? '');
    let sanitizedStdout;
    let sanitizedStderr;
    try {
      sanitizedStdout =
        typeof captureStdout === 'function'
          ? redact(captureStdout(value.stdout ?? ''))
          : captureStdout
            ? redact(value.stdout)
            : '[OMITTED: effective Compose configuration is never persisted]\n';
      sanitizedStderr = redact(value.stderr);
      writeFileSync(stdoutPath, sanitizedStdout, { mode: 0o600 });
      writeFileSync(stderrPath, sanitizedStderr, { mode: 0o600 });
      artifactSink.push(stdoutPath, stderrPath);
    } catch (error) {
      throw new Error(
        `safe_capture_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!allow.includes(value.status)) {
      const failure = {
        schema: 'agent-server.foundation.phase-c-child-failure',
        version: 1,
        command_identity: identity,
        raw_exit: value.status,
        signal: value.signal ?? null,
        stdout_path: relative(artifactRoot, stdoutPath),
        stderr_path: relative(artifactRoot, stderrPath),
        sanitized_stderr_tail: boundedTail(sanitizedStderr),
      };
      const failurePath = resolve(artifactRoot, 'failure-record.json');
      try {
        writeFileSync(failurePath, `${JSON.stringify(failure, null, 2)}\n`, {
          mode: 0o600,
          flag: 'wx',
        });
        artifactSink.push(failurePath);
      } catch (error) {
        if (!(error instanceof Error) || error.code !== 'EEXIST') throw error;
      }
      throw new Error(
        `child_command_failed:identity=${identity}:status=${value.status ?? 'spawn_error'}\n` +
          `stderr_tail:\n${failure.sanitized_stderr_tail}`,
      );
    }
    return value;
  };
}
