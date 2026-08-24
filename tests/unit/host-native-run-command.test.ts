import { describe, expect, it } from 'vitest';

import { runCommand, spawnOwned } from '../../tooling/dev/host-native.js';

describe('runCommand abortOn primary child', () => {
  it('aborts a long command promptly when the tracked primary child exits after start', async () => {
    const environment = { ...process.env };
    const primary = spawnOwned(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(7), 150)'],
      { environment, logName: 'canary-primary-child-race' },
    );
    const started = Date.now();
    await expect(
      runCommand(
        process.execPath,
        ['-e', 'setInterval(() => undefined, 1000)'],
        {
          environment,
          abortOn: {
            child: primary,
            environment,
            label: 'golden-path dev',
          },
        },
      ),
    ).rejects.toThrow(/canary primary child exited while .+ was running/u);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('lets a successful command finish when the primary child stays alive', async () => {
    const environment = { ...process.env };
    const primary = spawnOwned(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      { environment, logName: 'canary-primary-child-success' },
    );
    try {
      await runCommand(process.execPath, ['-e', 'process.exit(0)'], {
        environment,
        abortOn: {
          child: primary,
          environment,
          label: 'golden-path dev',
        },
      });
    } finally {
      primary.kill('SIGTERM');
    }
  });
});
