import { describe, expect, it } from 'vitest';

import { SeedCoworkerIdentityFiles } from './seed-coworker-identity-files.js';

type WriteCall = {
  readonly namespace: string;
  readonly agentDefinitionId: string;
  readonly scopeParams: { readonly workspaceId?: string };
  readonly path: string;
  readonly content: string;
};

class RecordingWrites {
  public readonly calls: WriteCall[] = [];

  public async execute(input: WriteCall): Promise<null> {
    this.calls.push(input);
    return null;
  }
}

const owner = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'service_account',
  principalId: 'principal-1',
  policySnapshotVersion: 'policy-1',
} as const;

describe('SeedCoworkerIdentityFiles', () => {
  it('seeds into the namespace the Agent can edit with its own workspace tools', async () => {
    const writes = new RecordingWrites();
    await new SeedCoworkerIdentityFiles(writes).execute({
      draft: {
        name: 'Maya',
        role: 'Research Analyst',
        summary: 'Researches markets.',
        instructions: 'Lead with the number.',
      },
      agentDefinitionId: 'agent-definition-1',
      accessContext: owner,
    });

    expect(writes.calls.map((call) => call.path)).toEqual([
      'IDENTITY.md',
      'SOUL.md',
    ]);
    for (const call of writes.calls) {
      expect(call.namespace).toBe('agent-shared');
      expect(call.agentDefinitionId).toBe('agent-definition-1');
      expect(call.scopeParams.workspaceId).toBe('workspace-1');
    }
  });

  it('writes only the files the draft carried content for', async () => {
    const writes = new RecordingWrites();
    const files = await new SeedCoworkerIdentityFiles(writes).execute({
      draft: {
        name: 'Maya',
        role: 'Research Analyst',
        summary: 'Researches markets.',
      },
      agentDefinitionId: 'agent-definition-1',
      accessContext: owner,
    });

    expect(files.map((file) => file.path)).toEqual(['IDENTITY.md']);
    expect(writes.calls).toHaveLength(1);
  });
});
