import { describe, expect, it } from 'vitest';

import type { ExecuteCommandInput } from '../../tooling/environment/compose.js';
import {
  startLocalEnvironment,
  stopLocalEnvironment,
} from '../../tooling/environment/lifecycle.js';
import { resolveLocalEnvironment } from '../../tooling/environment/profiles.js';

describe('local environment profiles', () => {
  it('keeps topology names stable and task-neutral', async () => {
    const core = await resolveLocalEnvironment('core', { environment: {} });
    const runtime = await resolveLocalEnvironment('runtime', {
      environment: {},
    });
    expect(core.services).toEqual(['postgres', 'agent-server']);
    expect(core.runtime).toMatchObject({ enabled: false, adapter: 'none' });
    expect(runtime.services).toContain('paseo-runtime');
    expect(runtime.runtime).toMatchObject({
      enabled: true,
      adapter: 'paseo',
      provider: 'opencode',
    });
  });

  it('builds a self-contained postgres lifecycle without a scenario script', async () => {
    const calls: ExecuteCommandInput[] = [];
    const executor = async (input: ExecuteCommandInput) => {
      calls.push(input);
      return { code: 0 } as const;
    };
    const environment = await startLocalEnvironment({
      profile: 'postgres',
      projectName: 'test-postgres-profile',
      testMode: true,
      environment: {},
      executor,
    });
    expect(environment.urls.postgres).toMatch(
      /^postgresql:\/\/agent:agent@127\.0\.0\.1:\d+\/agent_server$/,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('docker');
    expect(calls[0]?.args).toContain('compose.test-postgres.yaml');
    expect(calls[0]?.args).toContain('postgres-test');
    await environment.stop();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toContain('down');
    expect(calls[1]?.args).toContain('--volumes');
  });

  it('stops a recorded environment without starting it again', async () => {
    const calls: ExecuteCommandInput[] = [];
    await stopLocalEnvironment(
      {
        profile: 'core',
        projectName: 'recorded-core',
        testMode: false,
        ports: {},
      },
      {
        environment: {},
        executor: async (input) => {
          calls.push(input);
          return { code: 0 } as const;
        },
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain('down');
    expect(calls[0]?.args).not.toContain('up');
  });
});
