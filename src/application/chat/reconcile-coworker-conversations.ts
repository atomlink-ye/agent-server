import type { ServiceAccountAccessContext } from '../../platform/access-context.js';
import type { ManagedAgentDefinitionRead } from '../ports/agent-registry.js';
import type { EnsureCoworkerConversation } from './ensure-coworker-conversation.js';

export interface CoworkerConversationReconciliationResult {
  readonly scanned: number;
  readonly converged: number;
}

/**
 * Backfills the product invariant introduced by coworker publication:
 * every tenant-visible published Coworker has one idempotent Direct Chat for
 * the active service account. Same-owner Work entitlement remains delegated to
 * EnsureCoworkerConversation, so this reconciliation does not widen access.
 */
export class ReconcileCoworkerConversations {
  public constructor(
    private readonly definitions: Pick<
      ManagedAgentDefinitionRead,
      'listManagedDefinitionsByTenant'
    >,
    private readonly provisioning: Pick<EnsureCoworkerConversation, 'execute'>,
  ) {}

  public async execute(
    accessContext: ServiceAccountAccessContext,
  ): Promise<CoworkerConversationReconciliationResult> {
    let cursor: string | null = null;
    let scanned = 0;
    let converged = 0;
    const seenCursors = new Set<string>();

    do {
      const page = await this.definitions.listManagedDefinitionsByTenant({
        tenantId: accessContext.tenantId,
        command: { cursor, limit: 100 },
      });
      for (const item of page.items) {
        scanned += 1;
        await this.provisioning.execute({
          accessContext,
          definition: item.definition,
        });
        converged += 1;
      }

      const nextCursor = page.nextCursor;
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error('Coworker reconciliation cursor did not advance.');
      }
      if (nextCursor) seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    return Object.freeze({ scanned, converged });
  }
}
