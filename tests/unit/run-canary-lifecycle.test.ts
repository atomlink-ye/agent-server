import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const canaryModule = pathToFileURL(
  resolve(repositoryRoot, 'tooling/dev/run-canary.ts'),
).href;
const hostNativeModule = pathToFileURL(
  resolve(repositoryRoot, 'tooling/dev/host-native.ts'),
).href;

function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, rejectExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('runHostCanary signal cleanup', () => {
  it('cleans an owned detached descendant before the owner exits on SIGTERM', async () => {
    if (process.platform === 'win32') return;

    const owner = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          import { spawnOwned } from ${JSON.stringify(hostNativeModule)};
          import { createCanarySignalLifecycle } from ${JSON.stringify(canaryModule)};

          const children = [];
          const lifecycle = createCanarySignalLifecycle(children);
          const descendant = spawnOwned(
            process.execPath,
            ['-e', 'setInterval(() => undefined, 1000)'],
            { environment: process.env },
          );
          children.push(descendant);
          process.stdout.write(String(descendant.pid) + '\\n');
          await lifecycle.signal;
          await lifecycle.cleanup();
          lifecycle.dispose();
        `,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let output = '';
    let descendantPid: number | undefined;
    owner.stdout?.setEncoding('utf8');
    owner.stdout?.on('data', (chunk: string) => {
      output += chunk;
    });
    try {
      descendantPid = await new Promise<number>((resolvePid, rejectPid) => {
        const timer = setTimeout(
          () =>
            rejectPid(
              new Error(`timed out waiting for owner output: ${output}`),
            ),
          5_000,
        );
        const check = () => {
          const match = /^(\d+)\s*$/m.exec(output);
          if (!match) return;
          clearTimeout(timer);
          resolvePid(Number(match[1]));
        };
        owner.stdout?.on('data', check);
        owner.once('error', (error) => {
          clearTimeout(timer);
          rejectPid(error);
        });
      });

      expect(await isAlive(descendantPid)).toBe(true);
      owner.kill('SIGTERM');
      await expect(waitForExit(owner)).resolves.toMatchObject({ code: 143 });

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && (await isAlive(descendantPid))) {
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      expect(await isAlive(descendantPid)).toBe(false);
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) {
        owner.kill('SIGKILL');
      }
      if (descendantPid !== undefined && (await isAlive(descendantPid))) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {
          // The descendant can exit between the liveness probe and the kill.
        }
      }
      await waitForExit(owner).catch(() => undefined);
    }
  });
});
