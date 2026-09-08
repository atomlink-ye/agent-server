import type { AccessContext } from '../../domain/access-context.js';
import type { WriteAgentHomeEntry } from './agent-home.js';
import {
  composeCoworkerIdentityFiles,
  type CoworkerIdentityFile,
} from './coworker-identity-files.js';
import type { CoworkerAuthoringDraft } from './coworker-authoring.js';

/**
 * Hiring a Coworker gives it the files that say who it is.
 *
 * They go into the `agent-shared` namespace, which is exactly the area
 * `workspace_list`, `workspace_read` and `workspace_write` expose: seeding
 * anywhere else would produce identity the Agent could read in its prompt but
 * never edit, and an identity nobody can edit is a configuration value wearing
 * a filename. That namespace is scoped by tenant and Agent definition alone,
 * so the files the service account writes at hire time are the same rows the
 * Agent later reads and rewrites while talking to a human.
 */
export class SeedCoworkerIdentityFiles {
  public constructor(
    private readonly entries: Pick<WriteAgentHomeEntry, 'execute'>,
  ) {}

  public async execute(input: {
    readonly draft: CoworkerAuthoringDraft;
    readonly agentDefinitionId: string;
    /** The Agent's owner, which is also the scope its own workspace tools run in. */
    readonly accessContext: AccessContext;
  }): Promise<readonly CoworkerIdentityFile[]> {
    const files = composeCoworkerIdentityFiles(input.draft);
    for (const file of files) {
      await this.entries.execute({
        accessContext: {
          tenantId: input.accessContext.tenantId,
          workspaceId: input.accessContext.workspaceId,
          principalType: input.accessContext.principalType,
          principalId: input.accessContext.principalId,
        },
        agentDefinitionId: input.agentDefinitionId,
        namespace: 'agent-shared',
        scopeParams: { workspaceId: input.accessContext.workspaceId },
        path: file.path,
        content: file.content,
      });
    }
    return files;
  }
}
