import type { AccessContext } from '../../domain/access-context.js';
import type { WorkspaceMembershipRepository } from '../ports/workspace-membership-repository.js';

const DEFAULT_MEMO_LIMIT = 4096;

/**
 * Admits whoever is behind a request into the workspace they are working in.
 *
 * A person arriving for the first time has no prior record anywhere, so the
 * platform records the relationship authenticating them already implies: they
 * work in this workspace. Everything keyed off membership -- Work entitlements
 * above all -- becomes reachable for them without a separate account-creation
 * step, and without any principal standing in for them.
 *
 * Admission is idempotent, and repeat admissions inside one process are
 * remembered so a steady stream of reads does not become a steady stream of
 * writes.
 */
export class AdmitWorkspaceMember {
  private readonly admitted = new Set<string>();

  public constructor(
    private readonly members: WorkspaceMembershipRepository,
    private readonly memoLimit = DEFAULT_MEMO_LIMIT,
  ) {}

  public async execute(access: AccessContext): Promise<void> {
    const key = [
      access.tenantId,
      access.workspaceId,
      access.principalType,
      access.principalId,
    ].join('\u0000');
    if (this.admitted.has(key)) return;
    await this.members.ensureMember({
      tenantId: access.tenantId,
      workspaceId: access.workspaceId,
      principalType: access.principalType,
      principalId: access.principalId,
    });
    if (this.admitted.size >= this.memoLimit) this.admitted.clear();
    this.admitted.add(key);
  }
}
