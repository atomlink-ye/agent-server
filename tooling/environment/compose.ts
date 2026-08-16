import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { repositoryRoot } from './profiles.js';
import type { LocalEnvironmentProfile } from './types.js';

export interface ExecuteCommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly logPath?: string;
  readonly inheritOutput?: boolean;
}

export type CommandExecutor = (
  input: ExecuteCommandInput,
) => Promise<{ readonly code: number }>;

export const executeCommand: CommandExecutor = async (input) =>
  new Promise((resolvePromise, reject) => {
    const log = input.logPath
      ? createWriteStream(input.logPath, { flags: 'a' })
      : null;
    const child = spawn(input.command, [...input.args], {
      cwd: repositoryRoot,
      env: input.environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const forward = (chunk: Buffer, target: NodeJS.WriteStream) => {
      log?.write(chunk);
      if (input.inheritOutput) target.write(chunk);
    };
    child.stdout?.on('data', (chunk: Buffer) => forward(chunk, process.stdout));
    child.stderr?.on('data', (chunk: Buffer) => forward(chunk, process.stderr));
    child.once('error', (error) => {
      log?.end();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      log?.end();
      if (code === 0) resolvePromise({ code: 0 });
      else
        reject(
          new Error(
            `${input.command} exited with ${code ?? `signal ${signal ?? 'unknown'}`}`,
          ),
        );
    });
  });

export function composeInvocation(
  profile: LocalEnvironmentProfile,
  projectName: string,
  extraFiles: readonly string[] = [],
): { readonly command: string; readonly args: string[] } {
  const common: string[] = ['-p', projectName];
  for (const file of [...profile.compose.files, ...extraFiles]) {
    common.push('-f', file);
  }
  if (profile.compose.transport === 'repository') {
    return {
      command: resolve(repositoryRoot, 'scripts/dev/docker-compose'),
      args: common,
    };
  }
  return { command: 'docker', args: ['compose', ...common] };
}
