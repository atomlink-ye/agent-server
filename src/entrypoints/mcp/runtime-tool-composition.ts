import {
  createRuntimeToolCatalog as createCatalog,
  type RuntimeToolContributor,
  type RuntimeToolCatalog,
} from '../../application/extensions/runtime-tool-catalog.js';
import {
  AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF,
  AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_PLATFORM_COLLABORATION_TOOL_REFS,
  AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
} from '../../application/agents/built-in-skills.js';

export function createRuntimeToolCatalog(input: {
  readonly work: RuntimeToolContributor;
  readonly memory: RuntimeToolContributor;
  readonly collaboration: RuntimeToolContributor;
  readonly synthetic: RuntimeToolContributor;
}): RuntimeToolCatalog {
  return createCatalog([
    {
      ref: 'work',
      toolRefs: [
        AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF,
        AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
        AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
        AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF,
      ],
      contribute: input.work,
    },
    {
      ref: 'memory',
      toolRefs: [
        AGENT_SERVER_MEMORY_READ_TOOL_REF,
        AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
      ],
      contribute: input.memory,
    },
    {
      ref: 'collaboration',
      toolRefs: AGENT_SERVER_PLATFORM_COLLABORATION_TOOL_REFS,
      contribute: input.collaboration,
    },
    {
      ref: 'synthetic',
      toolRefs: [
        AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
        AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
        AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
      ],
      contribute: input.synthetic,
    },
  ]);
}
