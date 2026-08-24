import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WorkIdentityApi } from '../../application/work/work-identity-api.js';
import type { StartWorkRun } from '../../application/work/start-work-run.js';
import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import { ListAgentWorkflows } from '../../application/work/list-agent-workflows.js';
import { DescribeWorkflow } from '../../application/work/describe-workflow.js';
import type { WorkDefinitionSourceRepository } from '../../application/ports/work-definition-source-repository.js';
import type { ConversationRepository } from '../../application/ports/conversation-repository.js';
import type {
  ConversationWorkLinkRepository,
  ConversationWorkOrigin,
} from '../../domain/chat/chat-work-origin-ref.js';
import {
  toExecutionReceiptResponse,
  toWorkResponse,
  toWorkRunResponse,
} from '../../contracts/product-work-commands.js';

export const PRODUCT_WORK_CREATE_TOOL_REF = 'agent-server/product-work-create';
export const PRODUCT_WORK_RUN_START_TOOL_REF =
  'agent-server/product-work-run-start';
/**
 * Agent workflow association is an authoring mutation and therefore reuses
 * the existing Product Work authoring grant. It is deliberately not covered
 * by the read-only list capability.
 */
export const PRODUCT_WORK_ASSOCIATE_AGENT_WORKFLOW_TOOL_REF =
  PRODUCT_WORK_CREATE_TOOL_REF;
export const PRODUCT_WORK_LIST_AGENT_WORKFLOWS_TOOL_REF =
  'agent-server/list-agent-workflows';
export const PRODUCT_WORK_DESCRIBE_WORKFLOW_TOOL_REF =
  'agent-server/describe-workflow';

const createInput = {
  definition_id: z.string().uuid(),
  definition_version_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
};
const startInput = {
  work_id: z.string().uuid(),
  trigger_kind: z.literal('manual'),
  trigger_ref: z.string().min(1).max(256).optional(),
};
const strictCreateInput = z.strictObject(createInput);
const strictStartInput = z.strictObject(startInput);
const strictOneCallStartInput = z.strictObject({
  work_definition_version_id: z.string().uuid(),
  input: z.record(z.string(), z.unknown()),
});
const strictContinueInput = z.strictObject({
  work_ref: z.string().uuid(),
  feedback: z.string(),
});
type CreateInput = z.infer<typeof strictCreateInput>;
type StartInput = z.infer<typeof strictStartInput>;
type OneCallStartInput = z.infer<typeof strictOneCallStartInput>;
type ContinueInput = z.infer<typeof strictContinueInput>;

export interface WorkReference {
  readonly work_id: string;
  readonly definition_id: string;
  readonly definition_version_id: string;
}

function toConversationOrigin(
  chatContext:
    | Readonly<{
        readonly conversationId: string;
        readonly triggerMessageId: string;
      }>
    | null
    | undefined,
): ConversationWorkOrigin | undefined {
  return chatContext
    ? {
        conversationId: chatContext.conversationId,
        triggerMessageId: chatContext.triggerMessageId,
      }
    : undefined;
}

/**
 * Extracted so integration tests can exercise the real `start_work`
 * provenance-writing code path without standing up a full MCP transport.
 */
export async function executeProductWorkRunStart(
  args: StartInput,
  deps: {
    readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
    /** Compatibility seam for the existing conversation module. */
    readonly conversations?: Pick<ConversationRepository, 'appendMessage'>;
    readonly conversationWorkLinks?: Pick<
      ConversationWorkLinkRepository,
      'linkWorkToConversation'
    >;
    /** Origin supplied by the trusted server/grant context, not tool args. */
    readonly conversationOrigin?: ConversationWorkOrigin;
    readonly current: {
      readonly tenantId: string;
      readonly workspaceId: string;
      readonly principalId: string;
    };
  },
): Promise<
  | {
      readonly isError: true;
      readonly content: readonly [
        { readonly type: 'text'; readonly text: string },
      ];
    }
  | {
      readonly content: readonly [
        { readonly type: 'text'; readonly text: string },
      ];
    }
> {
  const { current } = deps;
  const result = await deps.startWorkRun.execute({
    accessContext: {
      tenantId: current.tenantId,
      workspaceId: current.workspaceId,
      principalType: 'service_account',
      principalId: current.principalId,
      policySnapshotVersion: 'runtime-mcp',
    },
    workId: args.work_id,
    triggerKind: args.trigger_kind,
    ...(args.trigger_ref !== undefined ? { triggerRef: args.trigger_ref } : {}),
  });

  if (deps.conversationOrigin) {
    if (!deps.conversationWorkLinks)
      return {
        isError: true,
        content: [{ type: 'text', text: 'not_found' }],
      };
    await deps.conversationWorkLinks.linkWorkToConversation({
      tenantId: current.tenantId,
      workspaceId: current.workspaceId,
      workId: result.workRun.workId,
      conversationId: deps.conversationOrigin.conversationId,
      triggerMessageId: deps.conversationOrigin.triggerMessageId,
    });
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          work_run: toWorkRunResponse(result.workRun),
          execution_receipt: toExecutionReceiptResponse(
            result.executionReceipt,
          ),
        }),
      },
    ],
  };
}

async function executeOneCallWorkStart(
  args: OneCallStartInput,
  deps: {
    readonly workIdentity: Pick<WorkIdentityApi, 'createWork'>;
    readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
    readonly definitions?: WorkDefinitionSourceRepository;
    readonly conversationWorkLinks?: Pick<
      ConversationWorkLinkRepository,
      'linkWorkToConversation'
    >;
    readonly conversationOrigin?: ConversationWorkOrigin;
    readonly current: {
      readonly tenantId: string;
      readonly workspaceId: string;
      readonly principalId: string;
    };
  },
): Promise<
  | {
      readonly isError: true;
      readonly content: readonly [
        { readonly type: 'text'; readonly text: string },
      ];
    }
  | {
      readonly content: readonly [
        { readonly type: 'text'; readonly text: string },
      ];
    }
> {
  const { current } = deps;
  const definitions = deps.definitions;
  if (!definitions?.findDefinition || !definitions.findProductVersion)
    return {
      isError: true,
      content: [{ type: 'text', text: 'not_found' }],
    };
  const owner = {
    tenantId: current.tenantId,
    workspaceId: current.workspaceId,
    principalType: 'service_account',
    principalId: current.principalId,
  };
  const version = await definitions.findProductVersion(
    args.work_definition_version_id,
    owner,
  );
  if (!version)
    return {
      isError: true,
      content: [{ type: 'text', text: 'not_found' }],
    };
  const definition = await definitions.findDefinition(
    version.version.definitionId,
    owner,
  );
  if (!definition || definition.id !== version.version.definitionId)
    return {
      isError: true,
      content: [{ type: 'text', text: 'not_found' }],
    };
  if (deps.conversationOrigin && !deps.conversationWorkLinks)
    return {
      isError: true,
      content: [{ type: 'text', text: 'not_found' }],
    };
  const accessContext = {
    tenantId: current.tenantId,
    workspaceId: current.workspaceId,
    principalType: 'service_account' as const,
    principalId: current.principalId,
    policySnapshotVersion: 'runtime-mcp',
  };
  const work = await deps.workIdentity.createWork({
    owner: {
      tenantId: current.tenantId,
      workspaceId: current.workspaceId,
    },
    accessContext,
    definitionId: definition.id,
    definitionVersionId: version.version.id,
    title: definition.name,
  });
  await deps.startWorkRun.execute({
    accessContext,
    workId: work.id,
    triggerKind: 'manual',
    input: args.input,
  });
  if (deps.conversationOrigin) {
    if (!deps.conversationWorkLinks)
      return {
        isError: true,
        content: [{ type: 'text', text: 'not_found' }],
      };
    await deps.conversationWorkLinks.linkWorkToConversation({
      tenantId: current.tenantId,
      workspaceId: current.workspaceId,
      workId: work.id,
      conversationId: deps.conversationOrigin.conversationId,
      triggerMessageId: deps.conversationOrigin.triggerMessageId,
    });
  }
  const workReference: WorkReference = {
    work_id: work.id,
    definition_id: work.definitionId,
    definition_version_id: work.currentDefinitionVersionId,
  };
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ work_reference: workReference }),
      },
    ],
  };
}

async function executeContinueWork(
  args: ContinueInput,
  deps: {
    readonly workIdentity: Pick<
      WorkIdentityApi,
      'findWorkById' | 'findLatestWorkRun'
    >;
    readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
    readonly conversationWorkLinks?: Pick<
      ConversationWorkLinkRepository,
      'findConversationIdByWork'
    >;
    readonly conversationOrigin?: ConversationWorkOrigin;
    readonly current: {
      readonly tenantId: string;
      readonly workspaceId: string;
      readonly principalId: string;
    };
  },
): Promise<
  | {
      readonly isError: true;
      readonly content: readonly [
        { readonly type: 'text'; readonly text: string },
      ];
    }
  | {
      readonly content: readonly [
        { readonly type: 'text'; readonly text: string },
      ];
    }
> {
  const owner = {
    tenantId: deps.current.tenantId,
    workspaceId: deps.current.workspaceId,
  };
  const work = await deps.workIdentity.findWorkById(args.work_ref, owner);
  if (!work)
    return {
      isError: true,
      content: [{ type: 'text', text: 'not_found' }],
    };
  const predecessor = await deps.workIdentity.findLatestWorkRun(work.id, owner);
  if (!predecessor)
    return {
      isError: true,
      content: [{ type: 'text', text: 'not_found' }],
    };
  if (deps.conversationOrigin) {
    if (!deps.conversationWorkLinks)
      return {
        isError: true,
        content: [{ type: 'text', text: 'not_found' }],
      };
    const linkedConversation =
      await deps.conversationWorkLinks.findConversationIdByWork({
        ...owner,
        workId: work.id,
      });
    if (linkedConversation !== deps.conversationOrigin.conversationId)
      return {
        isError: true,
        content: [{ type: 'text', text: 'not_found' }],
      };
  }
  const accessContext = {
    tenantId: deps.current.tenantId,
    workspaceId: deps.current.workspaceId,
    principalType: 'service_account' as const,
    principalId: deps.current.principalId,
    policySnapshotVersion: 'runtime-mcp',
  };
  await deps.startWorkRun.execute({
    accessContext,
    workId: work.id,
    triggerKind: 'manual',
    predecessorWorkRunId: predecessor.id,
    input: { feedback: args.feedback },
  });
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          work_reference: {
            work_id: work.id,
            definition_id: work.definitionId,
            definition_version_id: work.currentDefinitionVersionId,
          } satisfies WorkReference,
          continuation_kind: 'new_work_run',
        }),
      },
    ],
  };
}

export function registerProductWorkMcpTools(input: {
  readonly server: McpServer;
  readonly grant: AuthorizedRuntimeToolContext;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
  readonly workIdentity: Pick<
    WorkIdentityApi,
    'createWork' | 'findWorkById' | 'findLatestWorkRun'
  >;
  readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
  readonly definitions?: WorkDefinitionSourceRepository;
  /** Compatibility seam for the existing conversation module. */
  readonly conversations?: Pick<ConversationRepository, 'appendMessage'>;
  readonly conversationWorkLinks?: Pick<
    ConversationWorkLinkRepository,
    | 'linkWorkToConversation'
    | 'findConversationIdByWork'
    | 'findRecentWorkByConversation'
  >;
}): void {
  const { server, grant, authorize } = input;
  const fallbackConversationOrigin = toConversationOrigin(grant.chatContext);
  const currentConversationOrigin = (
    current: AuthorizedRuntimeToolContext,
  ): ConversationWorkOrigin | undefined => {
    if (current.chatContext) return toConversationOrigin(current.chatContext);
    if (grant.chatContext)
      throw new Error('Chat runtime grant context is unavailable.');
    return fallbackConversationOrigin;
  };
  if (grant.catalogTools.includes(PRODUCT_WORK_CREATE_TOOL_REF))
    (server.registerTool as any)(
      'product_work_create',
      {
        description: 'Create a durable product Work.',
        inputSchema: strictCreateInput,
      },
      async (args: CreateInput) => {
        const current = await authorize(PRODUCT_WORK_CREATE_TOOL_REF);
        if (!current)
          return {
            isError: true,
            content: [{ type: 'text', text: 'not_found' }],
          };
        const conversationOrigin = currentConversationOrigin(current);
        const work = await input.workIdentity.createWork({
          owner: {
            tenantId: current.tenantId,
            workspaceId: current.workspaceId,
          },
          accessContext: {
            tenantId: current.tenantId,
            workspaceId: current.workspaceId,
            principalType: 'service_account',
            principalId: current.principalId,
            policySnapshotVersion: 'runtime-mcp',
          },
          definitionId: args.definition_id,
          definitionVersionId: args.definition_version_id,
          title: args.title,
        });
        // A Work created from a Direct Chat has to be linked back to that
        // conversation, exactly as product_work_run_start does. Without the
        // link there is nothing to project a Work Card from, so the Coworker
        // reports a Work the user cannot see in the conversation they asked
        // in. This was an empty `finally` block.
        if (conversationOrigin) {
          if (!input.conversationWorkLinks)
            return {
              isError: true,
              content: [{ type: 'text', text: 'not_found' }],
            };
          await input.conversationWorkLinks.linkWorkToConversation({
            tenantId: current.tenantId,
            workspaceId: current.workspaceId,
            workId: work.id,
            conversationId: conversationOrigin.conversationId,
            triggerMessageId: conversationOrigin.triggerMessageId,
          });
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ work: toWorkResponse(work) }),
            },
          ],
        };
      },
    );
  if (
    grant.catalogTools.includes(PRODUCT_WORK_ASSOCIATE_AGENT_WORKFLOW_TOOL_REF)
  )
    (server.registerTool as any)(
      'product_work_associate_agent_workflow',
      {
        description: 'Associate a Product Work Definition with an agent.',
        inputSchema: z.strictObject({
          agent_definition_id: z.string().trim().min(1).max(256),
          definition_id: z.string().uuid(),
        }),
      },
      async (args: {
        readonly agent_definition_id: string;
        readonly definition_id: string;
      }) => {
        const current = await authorize(
          PRODUCT_WORK_ASSOCIATE_AGENT_WORKFLOW_TOOL_REF,
        );
        if (!current)
          return {
            isError: true,
            content: [{ type: 'text', text: 'not_found' }],
          };
        try {
          const definitions = input.definitions;
          if (
            !definitions?.associateAgentWorkflow ||
            !definitions.findDefinition
          )
            return {
              isError: true,
              content: [{ type: 'text', text: 'not_found' }],
            };
          const definition = await definitions.findDefinition(
            args.definition_id,
            {
              tenantId: current.tenantId,
              workspaceId: current.workspaceId,
              principalType: 'service_account',
              principalId: current.principalId,
            },
          );
          if (
            !definition ||
            definition.owner.tenantId !== current.tenantId ||
            definition.owner.workspaceId !== current.workspaceId
          )
            return {
              isError: true,
              content: [{ type: 'text', text: 'not_found' }],
            };
          await definitions.associateAgentWorkflow({
            tenantId: current.tenantId,
            workspaceId: current.workspaceId,
            agentDefinitionId: args.agent_definition_id,
            definitionId: args.definition_id,
            now: new Date().toISOString(),
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  associated: true,
                  agent_definition_id: args.agent_definition_id,
                  definition_id: args.definition_id,
                }),
              },
            ],
          };
        } finally {
        }
      },
    );
  if (grant.catalogTools.includes(PRODUCT_WORK_RUN_START_TOOL_REF))
    (server.registerTool as any)(
      'start_work',
      {
        description:
          'Create and start a Product Work from a definition version.',
        inputSchema: strictOneCallStartInput,
      },
      async (args: OneCallStartInput) => {
        const current = await authorize(PRODUCT_WORK_RUN_START_TOOL_REF);
        if (!current)
          return {
            isError: true,
            content: [{ type: 'text', text: 'not_found' }],
          };
        try {
          const conversationOrigin = currentConversationOrigin(current);
          return await executeOneCallWorkStart(args, {
            workIdentity: input.workIdentity,
            startWorkRun: input.startWorkRun,
            ...(input.definitions ? { definitions: input.definitions } : {}),
            ...(input.conversationWorkLinks
              ? { conversationWorkLinks: input.conversationWorkLinks }
              : {}),
            ...(conversationOrigin ? { conversationOrigin } : {}),
            current: {
              tenantId: current.tenantId,
              workspaceId: current.workspaceId,
              principalId: current.principalId,
            },
          });
        } finally {
        }
      },
    );
  if (grant.catalogTools.includes(PRODUCT_WORK_RUN_START_TOOL_REF))
    (server.registerTool as any)(
      'product_work_run_start',
      {
        description: 'Start a durable product WorkRun.',
        inputSchema: strictStartInput,
      },
      async (args: StartInput) => {
        const current = await authorize(PRODUCT_WORK_RUN_START_TOOL_REF);
        if (!current)
          return {
            isError: true,
            content: [{ type: 'text', text: 'not_found' }],
          };
        try {
          const conversationOrigin = currentConversationOrigin(current);
          return await executeProductWorkRunStart(args, {
            startWorkRun: input.startWorkRun,
            ...(input.conversations
              ? { conversations: input.conversations }
              : {}),
            ...(input.conversationWorkLinks
              ? { conversationWorkLinks: input.conversationWorkLinks }
              : {}),
            ...(conversationOrigin ? { conversationOrigin } : {}),
            current: {
              tenantId: current.tenantId,
              workspaceId: current.workspaceId,
              principalId: current.principalId,
            },
          });
        } finally {
        }
      },
    );
  if (grant.catalogTools.includes(PRODUCT_WORK_RUN_START_TOOL_REF))
    (server.registerTool as any)(
      'continue_work',
      {
        description: 'Continue a Product Work with feedback.',
        inputSchema: strictContinueInput,
      },
      async (args: ContinueInput) => {
        const current = await authorize(PRODUCT_WORK_RUN_START_TOOL_REF);
        if (!current)
          return {
            isError: true,
            content: [{ type: 'text', text: 'not_found' }],
          };
        try {
          const conversationOrigin = currentConversationOrigin(current);
          return await executeContinueWork(args, {
            workIdentity: input.workIdentity,
            startWorkRun: input.startWorkRun,
            ...(input.conversationWorkLinks
              ? { conversationWorkLinks: input.conversationWorkLinks }
              : {}),
            ...(conversationOrigin ? { conversationOrigin } : {}),
            current: {
              tenantId: current.tenantId,
              workspaceId: current.workspaceId,
              principalId: current.principalId,
            },
          });
        } finally {
        }
      },
    );
  if (grant.catalogTools.includes(PRODUCT_WORK_LIST_AGENT_WORKFLOWS_TOOL_REF))
    (server.registerTool as any)(
      'list_agent_workflows',
      {
        description: 'List workflows associated with an agent.',
        inputSchema: z.strictObject({
          agent_definition_id: z.string().min(1),
        }),
      },
      async (args: { agent_definition_id: string }) => {
        const current = await authorize(
          PRODUCT_WORK_LIST_AGENT_WORKFLOWS_TOOL_REF,
        );
        if (!current)
          return {
            isError: true,
            content: [{ type: 'text', text: 'not_found' }],
          };
        try {
          if (!input.definitions) {
            return {
              isError: true,
              content: [{ type: 'text', text: 'not_found' }],
            };
          }
          const listWorkflows = new ListAgentWorkflows(input.definitions);
          const result = await listWorkflows.execute({
            agentDefinitionId: args.agent_definition_id,
            accessContext: {
              tenantId: current.tenantId,
              workspaceId: current.workspaceId,
              principalType: 'service_account',
              principalId: current.principalId,
              policySnapshotVersion: 'runtime-mcp',
            },
          });
          const startable = (
            await Promise.all(
              result.definitions.map(async (definition) => {
                const versions = input.definitions?.listProductVersions
                  ? await input.definitions.listProductVersions({
                      definitionId: definition.id,
                      owner: {
                        tenantId: current.tenantId,
                        workspaceId: current.workspaceId,
                        principalType: 'service_account',
                        principalId: current.principalId,
                      },
                      limit: 1,
                      cursor: null,
                    })
                  : null;
                const version = versions?.items[0];
                if (!version) return null;
                return {
                  id: definition.id,
                  name: definition.name,
                  description: definition.description,
                  work_definition_version_id: version.version.id,
                  input_schema: version.version.source.inputSchema ?? {
                    type: 'object',
                    properties: {},
                    required: [],
                    additional_properties: false,
                  },
                };
              }),
            )
          ).filter(
            (definition): definition is NonNullable<typeof definition> =>
              definition !== null,
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  definitions: startable,
                }),
              },
            ],
          };
        } finally {
        }
      },
    );
  if (grant.catalogTools.includes(PRODUCT_WORK_DESCRIBE_WORKFLOW_TOOL_REF))
    (server.registerTool as any)(
      'describe_workflow',
      {
        description: 'Get detailed information about a workflow.',
        inputSchema: z.strictObject({
          definition_id: z.string().min(1),
          version_id: z.string().min(1).optional(),
        }),
      },
      async (args: { definition_id: string; version_id?: string }) => {
        const current = await authorize(
          PRODUCT_WORK_DESCRIBE_WORKFLOW_TOOL_REF,
        );
        if (!current)
          return {
            isError: true,
            content: [{ type: 'text', text: 'not_found' }],
          };
        try {
          if (!input.definitions) {
            return {
              isError: true,
              content: [{ type: 'text', text: 'not_found' }],
            };
          }
          const describeWorkflow = new DescribeWorkflow(input.definitions);
          const result = await describeWorkflow.execute({
            definitionId: args.definition_id,
            ...(args.version_id !== undefined
              ? { versionId: args.version_id }
              : {}),
            accessContext: {
              tenantId: current.tenantId,
              workspaceId: current.workspaceId,
              principalType: 'service_account',
              principalId: current.principalId,
              policySnapshotVersion: 'runtime-mcp',
            },
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  definition: {
                    id: result.definition.id,
                    name: result.definition.name,
                    description: result.definition.description,
                  },
                  version: {
                    id: result.version.version.id,
                    definitionId: result.version.version.definitionId,
                  },
                  input_contract: result.inputContract
                    ? {
                        name: result.inputContract.name,
                        description: result.inputContract.description,
                        schema: result.inputContract.schema,
                      }
                    : null,
                }),
              },
            ],
          };
        } finally {
        }
      },
    );
}
