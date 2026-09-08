import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureAgentWorkspaceRoot } from './agent-workspace-root.js';

describe('ensureAgentWorkspaceRoot', () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(
      created
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function scratch(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), 'agent-workspace-root-'));
    created.push(path);
    return path;
  }

  it('marks the workspace as its own project root so no ancestor repository instructs the Agent', async () => {
    const root = await scratch();
    const workspace = join(root, 'nested', 'agent-workspace');

    await ensureAgentWorkspaceRoot(workspace);

    expect(await readFile(join(workspace, '.git', 'HEAD'), 'utf8')).toBe(
      'ref: refs/heads/main\n',
    );
    expect(await readFile(join(workspace, '.git', 'config'), 'utf8')).toContain(
      'repositoryformatversion = 0',
    );
  });

  it('leaves an existing repository alone so a workspace with real history keeps it', async () => {
    const root = await scratch();
    const workspace = join(root, 'agent-workspace');
    await ensureAgentWorkspaceRoot(workspace);
    await writeFile(join(workspace, '.git', 'HEAD'), 'ref: refs/heads/work\n');

    await ensureAgentWorkspaceRoot(workspace);

    expect(await readFile(join(workspace, '.git', 'HEAD'), 'utf8')).toBe(
      'ref: refs/heads/work\n',
    );
  });
});
