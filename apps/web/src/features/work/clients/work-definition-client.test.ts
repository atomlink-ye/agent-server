import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiTransport } from '@/api/transport';
import { WorkDefinitionClient } from './work-definition-client';

const fingerprint = `sha256:${'a'.repeat(64)}`;
const workerVersionId = '10000000-0000-4000-8000-000000000001';
const environmentVersionId = '20000000-0000-4000-8000-000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkDefinitionClient canonical Worker contract', () => {
  it('maps the shared single_worker plan into the browser view model', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue({
      valid: true,
      fingerprint,
      metadata: { normalized_name: 'research-work' },
      resolved: {
        kind: 'single_worker',
        participants: [
          {
            name: 'research-worker',
            role: 'primary',
            source: 'referenced',
            worker_version_id: workerVersionId,
            skills: [],
            tools: [],
          },
        ],
        environment: {
          source: 'referenced',
          environment_version_id: environmentVersionId,
        },
        memory_version_ids: [],
        required_runtime_capabilities: ['external_workspace'],
        platform_capabilities: [],
        materialization: {
          inline_workers: 0,
          inline_environment: false,
          internal_team: false,
        },
      },
      diagnostics: [],
    });

    const plan = await new WorkDefinitionClient().plan('source');

    expect(plan.resolved.kind).toBe('single_worker');
    expect(plan.resolved.participants).toEqual([
      {
        name: 'research-worker',
        role: 'primary',
        source: 'referenced',
        workerVersionId,
        skills: [],
        tools: [],
      },
    ]);
    expect(plan.resolved.environment.environmentVersionId).toBe(
      environmentVersionId,
    );
  });

  it('rejects the retired Agent-shaped Work plan instead of silently decoding it', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue({
      valid: true,
      fingerprint,
      metadata: { normalized_name: 'legacy-work' },
      resolved: {
        kind: 'single_agent',
        participants: [
          {
            name: 'legacy-agent',
            role: 'primary',
            source: 'referenced',
            agent_version_id: workerVersionId,
            skills: [],
            tools: [],
          },
        ],
        environment: {
          source: 'referenced',
          environment_version_id: environmentVersionId,
        },
        memory_version_ids: [],
        required_runtime_capabilities: [],
        platform_capabilities: [],
        materialization: {
          inline_workers: 0,
          inline_environment: false,
          internal_team: false,
        },
      },
      diagnostics: [],
    });

    await expect(new WorkDefinitionClient().plan('source')).rejects.toThrow();
  });
});
