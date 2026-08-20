import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  RuntimeToolGrant,
  RuntimeToolGrantService,
  RuntimeToolChatContext,
} from '../application/extensions/runtime-tool-grant-service.js';

export interface RuntimeToolContributionContext {
  readonly server: McpServer;
  readonly grant: RuntimeToolGrant;
  readonly grants: RuntimeToolGrantService;
  /** Trusted Chat origin, never sourced from MCP tool arguments. */
  readonly chatContext?: RuntimeToolChatContext;
}

export type RuntimeToolContributor = (
  context: RuntimeToolContributionContext,
) => void;

/**
 * Process-composition registry only. Registration happens during bootstrap;
 * this is deliberately not a user-extensible hot-plugin system.
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
