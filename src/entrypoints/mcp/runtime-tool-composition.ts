import {
  createRuntimeToolCatalog as createCatalog,
  type RuntimeToolContributor,
  type RuntimeToolCatalog,
} from '../../application/extensions/runtime-tool-catalog.js';
import type { CollaborationKernel } from '../../application/collaboration/collaboration-kernel.js';
import type { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { RunEventRepository } from '../../application/ports/run-events.js';
import { createSyntheticToolReceipt } from '../../application/runtime/synthetic-tool-receipt.js';
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
  AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
} from '../../application/agents/built-in-skills.js';
import {
  createCollaborationRuntimeContributor,
  createSyntheticRuntimeToolsContributor,
} from './runtime-tool-contributors.js';
import {
  AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
  AGENT_SERVER_WHISPER_SEND_TOOL_REF,
  registerWhisperMcpTools,
} from './whisper-mcp-tools.js';
import type { WhisperRepository } from '../../application/ports/whisper-repository.js';
import type { ConversationAgentIdentityResolver } from '../../application/work-organization/conversation-agent-identity.js';

export function createRuntimeToolCatalog(input: {
  readonly memory: RuntimeToolContributor;
  readonly collaboration: {
    readonly contextResolver: TeamToolContextResolver;
    readonly kernel: CollaborationKernel;
  };
  readonly logger: Logger;
  readonly events?: Pick<RunEventRepository, 'append'>;
  readonly work?: RuntimeToolContributor;
  /** Product coordination plane; composed only when Boards are enabled. */
  readonly workOrganization?: RuntimeToolContributor;
  /** Agent-initiated private coordination; composed only when Chat is enabled. */
  readonly whisper?: {
    readonly repository: WhisperRepository;
    readonly agentIdentities: ConversationAgentIdentityResolver;
  };
}): RuntimeToolCatalog {
  const syntheticToolReceipt = createSyntheticToolReceipt();
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
      contribute: createCollaborationRuntimeContributor({
        ...input.collaboration,
        syntheticToolReceipt,
      }),
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
        syntheticToolReceipt,
        ...(input.events ? { events: input.events } : {}),
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
    ...(input.workOrganization
      ? [
          {
            ref: 'work-organization',
            toolRefs: [AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF],
            contribute: input.workOrganization,
          },
        ]
      : []),
    ...(input.whisper
      ? [
          {
            ref: 'whisper',
            toolRefs: [
              AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
              AGENT_SERVER_WHISPER_SEND_TOOL_REF,
            ],
            contribute: createWhisperRuntimeToolsContributor(input.whisper),
          },
        ]
      : []),
  ]);
}

function createWhisperRuntimeToolsContributor(whisper: {
  readonly repository: WhisperRepository;
  readonly agentIdentities: ConversationAgentIdentityResolver;
}): RuntimeToolContributor {
  return ({ server, grant, authorize }) =>
    registerWhisperMcpTools({
      server,
      grant,
      authorize,
      repository: whisper.repository,
      agentIdentities: whisper.agentIdentities,
    });
}
