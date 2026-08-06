import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadLocalAgentProject } from './local-agent-project-loader.js';

const templateManifestPath = fileURLToPath(
  new URL(
    '../../../templates/self-learning-market-research/agent-project.yaml',
    import.meta.url,
  ),
);

describe('local agent project loader', () => {
  it('loads the checked-in self-learning market research template', async () => {
    const project = await loadLocalAgentProject({
      manifestPath: templateManifestPath,
    });

    expect(project.fingerprint).toBe(
      'sha256:75241dadf6f15bd20f4dc2c6be4dde2fd62e0b10ed1ae7e5f1f9e3db3d0ddb66',
    );
    expect(project.toolProfiles.size).toBe(3);
    expect(project.skills.size).toBe(4);
    expect(project.environments.size).toBe(1);
    expect(project.agents.size).toBe(3);
    expect(project.teams.size).toBe(1);
    expect(project.memoryStores.size).toBe(1);
    expect(project.entrypoints).toHaveLength(1);
  });
});
