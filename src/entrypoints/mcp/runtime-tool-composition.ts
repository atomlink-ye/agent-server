import {
  createRuntimeToolCatalog as createCatalog,
  type RuntimeToolContributor,
  type RuntimeToolCatalog,
} from '../../application/extensions/runtime-tool-catalog.js';
import type { CollaborationKernel } from '../../application/collaboration/collaboration-kernel.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import type { Logger } from '../../shared/observability/logger.js';
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
import {
  createCollaborationRuntimeContributor,
  createSyntheticRuntimeToolsContributor,
} from './runtime-tool-contributors.js';

export function createRuntimeToolCatalog(input: {
  readonly memory: RuntimeToolContributor;
  readonly collaboration: {
    readonly contextResolver: TeamToolContextResolver;
    readonly kernel: CollaborationKernel;
  };
  readonly logger: Logger;
  readonly work?: RuntimeToolContributor;
}): RuntimeToolCatalog {
  return createCatalog([
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
      contribute: createCollaborationRuntimeContributor(input.collaboration),
    },
    {
      ref: 'synthetic',
      toolRefs: [
        AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
        AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
        AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
      ],
      contribute: createSyntheticRuntimeToolsContributor({
        logger: input.logger,
      }),
    },
    ...(input.work
      ? [
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
        ]
      : []),
  ]);
}
