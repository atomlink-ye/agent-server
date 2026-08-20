import { describe, expect, it } from 'vitest';

import type { AccessContext } from '../../platform/access-context.js';
import {
  InvalidUserIdError,
  issueUserAccessContext,
} from './user-principal-issuer.js';

describe('issueUserAccessContext', () => {
  const issuer = Object.freeze({
    tenantId: 'tenant_alpha',
    workspaceId: 'workspace_main',
    principalType: 'service_account' as const,
    principalId: 'svc_issuer',
    serviceAccountId: 'svc_issuer',
    policySnapshotVersion: 'policy-2026-07-22',
  });

  it('returns a frozen UserAccessContext with userId copied from the parameter', () => {
    const userContext = issueUserAccessContext(issuer, 'user_alice');

    expect(userContext).toEqual({
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      principalType: 'user',
      principalId: 'user_alice',
      userId: 'user_alice',
      policySnapshotVersion: 'policy-2026-07-22',
    });
    expect(Object.isFrozen(userContext)).toBe(true);
  });

  it('preserves tenant, workspace, and policy from the issuer', () => {
    const userContext = issueUserAccessContext(issuer, 'user_bob');

    expect(userContext.tenantId).toBe(issuer.tenantId);
    expect(userContext.workspaceId).toBe(issuer.workspaceId);
    expect(userContext.policySnapshotVersion).toBe(
      issuer.policySnapshotVersion,
    );
  });

  it('throws InvalidUserIdError when userId is empty string', () => {
    expect(() => issueUserAccessContext(issuer, '')).toThrow(
      InvalidUserIdError,
    );
  });

  it('throws InvalidUserIdError when userId is whitespace-only', () => {
    expect(() => issueUserAccessContext(issuer, '   ')).toThrow(
      InvalidUserIdError,
    );
  });

  it('throws InvalidUserIdError when userId is not a string', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => issueUserAccessContext(issuer, null as any)).toThrow(
      InvalidUserIdError,
    );
  });

  it('is type-assignable to AccessContext', () => {
    const userContext = issueUserAccessContext(issuer, 'user_charlie');
    const asAccessContext: AccessContext = userContext;
    expect(asAccessContext.principalType).toBe('user');
    expect(asAccessContext.principalId).toBe('user_charlie');
  });
});
