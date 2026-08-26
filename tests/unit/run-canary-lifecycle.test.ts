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

function waitForOwnerMessage(
  owner: ChildProcess,
  kind: 'ready' | 'descendant',
): Promise<number | undefined> {
  return new Promise((resolveMessage, rejectMessage) => {
    const timer = setTimeout(() => {
      owner.removeListener('message', onMessage);
      rejectMessage(new Error(`timed out waiting for owner message: ${kind}`));
    }, 5_000);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const record = message as { kind?: unknown; pid?: unknown };
      if (record.kind !== kind) return;
      clearTimeout(timer);
      owner.removeListener('message', onMessage);
      resolveMessage(typeof record.pid === 'number' ? record.pid : undefined);
    };
    owner.on('message', onMessage);
    owner.once('error', (error) => {
      clearTimeout(timer);
      owner.removeListener('message', onMessage);
      rejectMessage(error);
    });
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
          const keepalive = setInterval(() => undefined, 1000);
          process.send?.({ kind: 'ready' });
          await lifecycle.signal;
          const descendant = spawnOwned(
            process.execPath,
            ['-e', 'setInterval(() => undefined, 1000)'],
            { environment: process.env },
          );
          lifecycle.register(descendant);
          process.send?.({ kind: 'descendant', pid: descendant.pid });
          await lifecycle.cleanup();
          clearInterval(keepalive);
          lifecycle.dispose();
        `,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );

    let descendantPid: number | undefined;
    owner.stdout?.setEncoding('utf8');
    try {
      await waitForOwnerMessage(owner, 'ready');
      owner.kill('SIGTERM');

      descendantPid = await waitForOwnerMessage(owner, 'descendant');

      expect(descendantPid).toEqual(expect.any(Number));
      if (descendantPid === undefined)
        throw new Error('missing descendant PID');
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
  }, 20_000);
});
