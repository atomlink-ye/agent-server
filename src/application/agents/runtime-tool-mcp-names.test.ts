import { describe, expect, it } from 'vitest';

import { SUPPORTED_MANAGED_AGENT_TOOL_REFS } from './built-in-skills.js';
import {
  runtimeToolMcpName,
  runtimeToolMcpNames,
} from './runtime-tool-mcp-names.js';

describe('runtimeToolMcpNames', () => {
  it('covers every Tool ref an Agent package is allowed to declare', () => {
    const unmapped = [...SUPPORTED_MANAGED_AGENT_TOOL_REFS].filter(
      (toolRef) => runtimeToolMcpName(toolRef) === null,
    );

    expect(unmapped).toEqual([]);
  });

  it('renders one stable ordered name per grant', () => {
    expect(
      runtimeToolMcpNames([
        'agent-server/workspace-write',
        'agent-server/workspace-list',
        'agent-server/workspace-write',
      ]),
    ).toEqual(['workspace_list', 'workspace_write']);
  });

  it('drops refs the Runtime MCP endpoint does not serve', () => {
    expect(runtimeToolMcpNames(['agent-server/not-a-tool'])).toEqual([]);
    expect(runtimeToolMcpName('agent-server/not-a-tool')).toBeNull();
  });
});
