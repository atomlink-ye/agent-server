import type { WorkspaceMembershipRepository } from '../ports/workspace-membership-repository.js';

const MAX_DISPLAY_NAME_LENGTH = 80;

/**
 * Lets a workspace member choose what they are called instead of living with
 * the default name admission gave them. This never touches a durable
 * message: renaming takes effect on the next chat turn, because a name is
 * resolved live, not stamped onto history.
 */
export class RenameWorkspaceMember {
  public constructor(
    private readonly members: Pick<
      WorkspaceMembershipRepository,
      'setDisplayName'
    >,
  ) {}

  public async execute(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly displayName: string;
  }): Promise<void> {
    const displayName = input.displayName.trim();
    if (displayName === '') throw new Error('A display name cannot be empty.');
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH)
      throw new Error(
        `A display name cannot be longer than ${MAX_DISPLAY_NAME_LENGTH} characters.`,
      );
    await this.members.setDisplayName({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      principalType: input.principalType,
      principalId: input.principalId,
      displayName,
    });
  }
}
