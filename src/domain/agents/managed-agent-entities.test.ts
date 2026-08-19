import { describe, expect, it } from 'vitest';
import { parseManagedAgentPackage } from './managed-agent-package.js';
import { createManagedAgentDefinition } from './managed-agent-definition.js';
import {
  createManagedAgentDraft,
  publishManagedAgentVersion,
} from './managed-agent-version.js';

const owner = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account',
  principalId: 'principal',
};
const at = () => new Date('2026-01-01T00:00:00.000Z');

describe('managed agent entities', () => {
  it('does not persist factory options and uses stable timestamps', () => {
    const definition = createManagedAgentDefinition({
      ...owner,
      normalizedName: 'agent',
      displayName: 'Agent',
      id: 'definition',
      now: at,
    });
    expect(definition).toEqual({
      ...owner,
      normalizedName: 'agent',
      displayName: 'Agent',
      id: 'definition',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      roleLabel: null,
      summary: null,
    });
    expect(Object.keys(definition)).not.toContain('now');
    expect(Object.prototype.hasOwnProperty.call(definition, 'now')).toBe(false);
  });

  it('publishes drafts once, preserves timestamps, and deeply freezes snapshots', () => {
    const definition = createManagedAgentDefinition({
      ...owner,
      normalizedName: 'agent',
      displayName: 'Agent',
      id: 'definition',
      now: at,
    });
    const draft = createManagedAgentDraft({
      definition,
      parsed: parseManagedAgentPackage(source()),
      id: 'version',
      now: at,
    });
    const publishedAt = new Date('2026-01-02T00:00:00.000Z');
    const published = publishManagedAgentVersion(draft, () => publishedAt);
    expect(draft.status).toBe('draft');
    expect(published.status).toBe('published');
    expect(published.createdAt).toBe(draft.createdAt);
    expect(published.updatedAt).toBe(publishedAt.toISOString());
    expect(published.publishedAt).toBe(publishedAt.toISOString());
    expect(
      publishManagedAgentVersion(published, () => {
        throw new Error('must not republish');
      }),
    ).toBe(published);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.package)).toBe(true);
    expect(Object.isFrozen(published.compiler)).toBe(true);
    expect(Object.isFrozen(published.referenceSnapshot)).toBe(true);
    expect(Object.isFrozen(published.validationSnapshot.metadata)).toBe(true);
  });
});

function source() {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Agent
spec:
  description: description
  instructions: instructions
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      additionalProperties: false
      properties: {}
    prompt: hello
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 1
  permissions:
    network: none
    filesystem: none
  completion:
    type: executable
    command: done
`;
}
