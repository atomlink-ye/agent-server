import type { ManagedAgentDefinitionRead } from '../../application/ports/agent-registry.js';
import type {
  MentionableAgent,
  MentionableAgentRoster,
} from '../../application/work-organization/wake-mentioned-agents.js';

/** One page is plenty for a mention roster; the cap stops a runaway loop. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/**
 * The tenant's Coworker roster, read from the managed-agent registry.
 *
 * Only agents appear here, which is what makes "@ a human does not wake anyone"
 * true by construction rather than by a filter somewhere downstream.
 */
export function createManagedAgentMentionRoster(
  definitions: Pick<
    ManagedAgentDefinitionRead,
    'listManagedDefinitionsByTenant'
  >,
): MentionableAgentRoster {
  return {
    async listMentionableAgents({ tenantId }) {
      const list =
        definitions.listManagedDefinitionsByTenant?.bind(definitions);
      // A narrow seam without the listing cannot resolve names; the parser then
      // keeps the raw token and nobody is woken. That is a degraded mention, not
      // a failed WorkItem write.
      if (!list) return [];
      const agents: MentionableAgent[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await list({
          tenantId,
          command: { cursor, limit: PAGE_SIZE },
        });
        for (const item of result.items)
          agents.push({
            id: item.definition.id,
            displayName: item.definition.displayName,
            normalizedName: item.definition.normalizedName,
            runtimeAvailable: item.runtimeStatus === 'available',
          });
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      return Object.freeze(agents);
    },
  };
}
