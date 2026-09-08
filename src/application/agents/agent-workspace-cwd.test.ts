import { describe, expect, it } from 'vitest';

import { agentWorkspaceCwd } from './agent-workspace-cwd.js';

describe('agentWorkspaceCwd', () => {
  it('gives two Agents under one root two different directories', () => {
    const first = agentWorkspaceCwd(
      '/srv/agent-workspace',
      'c5871456-6aff-4b03-9268-1dc477b1874f',
      null,
    );
    const second = agentWorkspaceCwd(
      '/srv/agent-workspace',
      '3ddd2f31-51f4-45bd-a33a-81bce2667e4a',
      null,
    );

    expect(first).toBe(
      '/srv/agent-workspace/default/c5871456-6aff-4b03-9268-1dc477b1874f',
    );
    expect(second).not.toBe(first);
  });

  it('returns the same directory for the same Agent, so files survive wake-ups', () => {
    const path = () =>
      agentWorkspaceCwd('/srv/agent-workspace', 'agent-definition-1', null);

    expect(path()).toBe(path());
  });

  it('refuses an identity that would place the workspace outside the root', () => {
    for (const identity of ['..', '../elsewhere', 'a/b', '', '.hidden'])
      expect(() =>
        agentWorkspaceCwd('/srv/agent-workspace', identity, null),
      ).toThrow('agent_workspace_cwd_identity_invalid');
  });

  it('namespaces the Agent directory under its Computer', () => {
    expect(agentWorkspaceCwd('/root', 'agent-1', 'computer-1')).toBe(
      '/root/computer-1/agent-1',
    );
  });

  it('falls back to a default Computer namespace when unassigned', () => {
    expect(agentWorkspaceCwd('/root', 'agent-1', null)).toBe(
      '/root/default/agent-1',
    );
  });

  it('refuses a computer id that would place the workspace outside the root', () => {
    for (const computerId of ['..', '../elsewhere', 'a/b', ''])
      expect(() =>
        agentWorkspaceCwd(
          '/srv/agent-workspace',
          'agent-definition-1',
          computerId,
        ),
      ).toThrow('agent_workspace_cwd_identity_invalid');
  });
});
