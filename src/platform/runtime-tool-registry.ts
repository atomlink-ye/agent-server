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

export class RuntimeToolRegistry {
  public constructor(
    private readonly contributors: readonly RuntimeToolContributor[],
  ) {}

  public contribute(context: RuntimeToolContributionContext): void {
    for (const contributor of this.contributors) contributor(context);
  }
}
