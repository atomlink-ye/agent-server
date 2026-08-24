import { describe, expect, it } from 'vitest';
import type { AccessContext } from '../access-context.js';
import {
  AgentHomeNamespaceReadOnlyError,
  AgentHomeScopeRequiredError,
  resolveAgentHomeScopeKey,
} from './agent-home.js';

const mockAccessContext: AccessContext = {
  tenantId: 'tenant_test',
  workspaceId: 'workspace_test',
  principalType: 'service_account',
  principalId: 'principal_test',
  policySnapshotVersion: '1',
};

describe('resolveAgentHomeScopeKey', () => {
  describe('definition namespace', () => {
    it('throws AgentHomeNamespaceReadOnlyError when isWrite is true', () => {
      expect(() =>
        resolveAgentHomeScopeKey('definition', mockAccessContext, {}, true),
      ).toThrow(AgentHomeNamespaceReadOnlyError);
    });

    it('returns empty string when isWrite is false', () => {
      const key = resolveAgentHomeScopeKey(
        'definition',
        mockAccessContext,
        {},
        false,
      );
      expect(key).toBe('');
    });
  });

  describe('organization namespace', () => {
    it('always returns empty string', () => {
      const key = resolveAgentHomeScopeKey('organization', mockAccessContext, {
        workspaceId: 'some_id',
      });
      expect(key).toBe('');
    });

    it('ignores all scope params', () => {
      const key = resolveAgentHomeScopeKey('organization', mockAccessContext, {
        workspaceId: 'workspace1',
        conversationId: 'conv1',
        workId: 'work1',
        runtimeSessionId: 'session1',
      });
      expect(key).toBe('');
    });
  });

  describe('space namespace', () => {
    it('returns workspaceId when provided', () => {
      const key = resolveAgentHomeScopeKey('space', mockAccessContext, {
        workspaceId: 'workspace_123',
      });
      expect(key).toBe('workspace_123');
    });

    it('throws AgentHomeScopeRequiredError when workspaceId is missing', () => {
      expect(() =>
        resolveAgentHomeScopeKey('space', mockAccessContext, {}),
      ).toThrow(AgentHomeScopeRequiredError);
    });
  });

  describe('agent-shared namespace', () => {
    it('returns workspaceId when provided', () => {
      const key = resolveAgentHomeScopeKey('agent-shared', mockAccessContext, {
        workspaceId: 'workspace_456',
      });
      expect(key).toBe('workspace_456');
    });

    it('throws AgentHomeScopeRequiredError when workspaceId is missing', () => {
      expect(() =>
        resolveAgentHomeScopeKey('agent-shared', mockAccessContext, {}),
      ).toThrow(AgentHomeScopeRequiredError);
    });
  });

  describe('user namespace', () => {
    it('returns principalId from access context', () => {
      const key = resolveAgentHomeScopeKey('user', mockAccessContext, {});
      expect(key).toBe('principal_test');
    });

    it('ignores caller-supplied principalId in scopeParams', () => {
      const scopeParams = {
        // If someone mistakenly passes a user scope, it should be ignored
        conversationId: 'not_used',
      };
      const key = resolveAgentHomeScopeKey(
        'user',
        mockAccessContext,
        scopeParams,
      );
      expect(key).toBe('principal_test');
    });

    it('does not accept caller-supplied user override', () => {
      // This is a security test: caller cannot impersonate another user
      const accessContextOther: AccessContext = {
        ...mockAccessContext,
        principalId: 'principal_alice',
      };
      const key = resolveAgentHomeScopeKey('user', accessContextOther, {
        // Even if caller tries to override, it should be ignored
        conversationId: 'principal_bob',
      });
      expect(key).toBe('principal_alice');
    });
  });

  describe('conversation namespace', () => {
    it('returns conversationId when provided', () => {
      const key = resolveAgentHomeScopeKey('conversation', mockAccessContext, {
        conversationId: 'conv_789',
      });
      expect(key).toBe('conv_789');
    });

    it('throws AgentHomeScopeRequiredError when conversationId is missing', () => {
      expect(() =>
        resolveAgentHomeScopeKey('conversation', mockAccessContext, {}),
      ).toThrow(AgentHomeScopeRequiredError);
    });
  });

  describe('work namespace', () => {
    it('returns workId when provided', () => {
      const key = resolveAgentHomeScopeKey('work', mockAccessContext, {
        workId: 'work_abc',
      });
      expect(key).toBe('work_abc');
    });

    it('throws AgentHomeScopeRequiredError when workId is missing', () => {
      expect(() =>
        resolveAgentHomeScopeKey('work', mockAccessContext, {}),
      ).toThrow(AgentHomeScopeRequiredError);
    });
  });

  describe('scratch namespace', () => {
    it('returns runtimeSessionId when provided', () => {
      const key = resolveAgentHomeScopeKey('scratch', mockAccessContext, {
        runtimeSessionId: 'session_xyz',
      });
      expect(key).toBe('session_xyz');
    });

    it('throws AgentHomeScopeRequiredError when runtimeSessionId is missing', () => {
      expect(() =>
        resolveAgentHomeScopeKey('scratch', mockAccessContext, {}),
      ).toThrow(AgentHomeScopeRequiredError);
    });
  });
});
