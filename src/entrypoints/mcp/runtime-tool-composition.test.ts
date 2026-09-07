import { describe, expect, it } from 'vitest';

import {
  AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF,
} from '../../application/agents/built-in-skills.js';
import { createRuntimeToolCatalog } from './runtime-tool-composition.js';

describe('runtime MCP tool composition', () => {
  it('publishes all WorkItem coordination refs under the work organization contributor', () => {
    const workOrganization = () => undefined;
    const catalog = createRuntimeToolCatalog({
      memory: () => undefined,
      collaboration: {
        contextResolver: {} as never,
        kernel: {} as never,
      },
      logger: {} as never,
      workOrganization,
    });

    const definition = catalog
      .list()
      .find((entry) => entry.ref === 'work-organization');
    expect(definition?.toolRefs).toEqual([
      AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
      AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF,
      AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF,
    ]);
    expect(catalog.toolRefs()).toEqual(
      expect.arrayContaining([
        AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
        AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF,
        AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF,
      ]),
    );
  });
});
