import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  RuntimeToolGrant,
  RuntimeToolGrantService,
} from '../application/extensions/runtime-tool-grant-service.js';

export interface RuntimeToolContributionContext {
  readonly server: McpServer;
  readonly grant: RuntimeToolGrant;
  readonly grants: RuntimeToolGrantService;
}

export type RuntimeToolContributor = (
  context: RuntimeToolContributionContext,
) => void;

/**
 * Composition-root registry. Registration happens during process bootstrap;
 * runtime MCP servers only read the resulting contributor set when binding a
 * participant. It is deliberately not a user-extensible hot-plugin system.
 */
export class RuntimeToolRegistry {
  readonly #contributors: RuntimeToolContributor[];

  public constructor(contributors: readonly RuntimeToolContributor[] = []) {
    this.#contributors = [...contributors];
  }

  public register(contributor: RuntimeToolContributor): void {
    if (this.#contributors.includes(contributor)) return;
    this.#contributors.push(contributor);
  }

  public contribute(context: RuntimeToolContributionContext): void {
    for (const contributor of this.#contributors) contributor(context);
  }
}
