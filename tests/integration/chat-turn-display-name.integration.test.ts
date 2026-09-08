import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresChatDispatchRepository } from '../../src/infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { PostgresWorkspaceMembershipRepository } from '../../src/infrastructure/postgres/postgres-workspace-membership-repository.js';
import { AdmitWorkspaceMember } from '../../src/application/workspaces/admit-workspace-member.js';
import { RenameWorkspaceMember } from '../../src/application/workspaces/rename-workspace-member.js';
import { postConversationMessage } from '../../src/application/chat/post-conversation-message.js';
import { ResolveChatTurnContext } from '../../src/application/chat/resolve-chat-turn-context.js';
import { ExecuteChatTurn } from '../../src/application/chat/execute-chat-turn.js';
import { ExecutionRuntimeChatTurnProvider } from '../../src/adapters/chat/execution-runtime-chat-turn-provider.js';
import type { EnsureDesiredRuntimeSpecInput } from '../../src/application/ports/ensure-desired-runtime-spec.js';
import type { ExecutionOutput } from '../../src/application/ports/runtime-execution-session.js';
import type {
  ExecuteRuntimeTurn,
  ExecuteRuntimeTurnInput,
} from '../../src/application/runtime/execute-runtime-turn.js';
import { runtimeSpecRevision } from '../../src/domain/runtime/runtime-session.js';
import { createRuntimeSessionSpec } from '../../src/domain/runtime/runtime-session-spec.js';
import type { RuntimeSession } from '../../src/domain/runtime/runtime-session.js';
import type { ResolvedChatBrain } from '../../src/application/chat/chat-brain-resolver.js';
import type { ChatDispatch } from '../../src/application/ports/chat-dispatch-repository.js';

const tenantId = 'tenant_display_name';
const workspaceId = 'b1000000-0000-4000-8000-000000000101';
const serviceAccountId = 'svc_display_name';
const definitionId = 'b2000000-0000-4000-8000-000000000001';
const versionId = 'b3000000-0000-4000-8000-000000000001';
const now = '2026-09-08T12:00:00.000Z';
// Deliberately the same shape as the bug report's truncated-UUID id, so the
// proof shows the exact string an Agent would otherwise have read.
const personPrincipalId = 'user-342c0d39';

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('a renamed human principal is addressed by name in a chat turn transcript', () => {
  it('renders "Ada (human)" instead of the raw principal id once the person renames themself', async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    await database.query(
      `INSERT INTO workspaces
         (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
      [workspaceId, tenantId, serviceAccountId, 'Display Name Workspace', now],
    );
    await database.query(
      `INSERT INTO agent_definitions
         (id,tenant_id,workspace_id,principal_type,principal_id,name,
          managed_discriminator,normalized_name,created_at,updated_at)
       VALUES($1,$2,$3,'service_account',$4,'Roster Coworker','managed_agent_v1',
              'roster-coworker',$5,$5)`,
      [definitionId, tenantId, workspaceId, serviceAccountId, now],
    );
    await database.query(
      `INSERT INTO agent_chat_runtimes
         (tenant_id,agent_definition_id,active_agent_version_id,epoch,status,
          created_at,updated_at)
       VALUES($1,$2,$3,1,'available',$4,$4)`,
      [tenantId, definitionId, versionId, now],
    );

    const conversations = new PostgresConversationRepository(database);
    const dispatches = new PostgresChatDispatchRepository(database);
    const workEntitlements = new PostgresConversationWorkEntitlementRepository(
      database,
    );
    const workspaceMembers = new PostgresWorkspaceMembershipRepository(
      database,
    );

    // (a) Admit the principal into the workspace -- they get a default
    // "Guest XXXX" name from AdmitWorkspaceMember, same as any first-time
    // visitor.
    await new AdmitWorkspaceMember(workspaceMembers).execute({
      tenantId,
      workspaceId,
      principalType: 'user',
      principalId: personPrincipalId,
      policySnapshotVersion: 'v1',
    });
    const guestName = (
      await workspaceMembers.findDisplayNames({
        tenantId,
        workspaceId,
        principalIds: [personPrincipalId],
      })
    ).get(personPrincipalId);
    expect(guestName).toMatch(/^Guest [0-9A-F]{4}$/);

    // (b) Rename them to "Ada".
    await new RenameWorkspaceMember(workspaceMembers).execute({
      tenantId,
      workspaceId,
      principalType: 'user',
      principalId: personPrincipalId,
      displayName: 'Ada',
    });

    // (c) Post a chat message as that principal.
    const conversation = await conversations.findOrCreateDirect({
      tenantId,
      principalId: personPrincipalId,
      principalType: 'user',
      agentDefinitionId: definitionId,
    });
    await workEntitlements.enable({
      tenantId,
      conversationId: conversation.id,
      workspaceId,
      principalType: 'user',
      principalId: personPrincipalId,
    });
    const message = await postConversationMessage(conversations, {
      author: {
        type: 'principal',
        tenantId,
        conversationId: conversation.id,
        principalType: 'user',
        principalId: personPrincipalId,
      },
      body: 'Hello from Ada',
    });

    // (d) Run it through ResolveChatTurnContext + ExecuteChatTurn with the
    // real ExecutionRuntimeChatTurnProvider and assert the rendered
    // transcript line names Ada, not her principal id.
    const dispatch: ChatDispatch = {
      id: 'dispatch-display-name-1',
      tenantId,
      agentDefinitionId: definitionId,
      conversationId: conversation.id,
      throughSequence: message.sequence,
      dedupeKey: `chat:${definitionId}:${conversation.id}:${message.sequence}`,
      createdAt: now,
      publishedAt: null,
    };
    const resolver = new ResolveChatTurnContext(
      conversations,
      dispatches,
      workEntitlements,
      undefined,
      undefined,
      workspaceMembers,
    );
    const context = await resolver.execute(dispatch);
    expect(context).not.toBeNull();
    expect(context?.authorLabels?.get(personPrincipalId)).toBe('Ada');

    const executor = new RecordingTurnExecutor();
    const provider = new ExecutionRuntimeChatTurnProvider(
      new RecordingDesiredSpec([runtimeSession('runtime-session-display-1')]),
      executor,
      { provider: 'recording', model: 'deterministic', cwd: '/tmp/recording' },
    );
    const executeTurn = new ExecuteChatTurn(provider);
    await executeTurn.execute(context!, chatBrain());

    const prompt = executor.calls[0]?.prompt ?? '';
    expect(prompt).toContain('Ada (human)');
    expect(prompt).not.toContain(`${personPrincipalId} (human)`);
    expect(prompt).not.toContain('Guest');
  });
});

class RecordingDesiredSpec {
  public readonly calls: EnsureDesiredRuntimeSpecInput[] = [];

  public constructor(private readonly sessions: readonly RuntimeSession[]) {}

  public async execute(input: EnsureDesiredRuntimeSpecInput) {
    this.calls.push(input);
    const session = this.sessions[this.calls.length - 1];
    if (!session) throw new Error('recording runtime session missing');
    return {
      session,
      spec: createRuntimeSessionSpec({
        runtimeSessionId: session.id,
        revision: runtimeSpecRevision(1),
        workspaceId: session.owner.workspaceId,
        agentVersionId: input.agentVersionId ?? null,
        environmentVersionId: input.environmentVersionId,
        resolvedSkills: input.resolvedSkills,
        toolRefs: input.toolRefs,
        provider: input.configuration.provider,
        model: input.configuration.model,
        cwd: input.configuration.cwd,
        systemPromptDigest: input.configuration.desiredSystemPrompt.digest,
        skillSetDigest: 'skills',
        toolCatalogDigest: 'catalog',
        extensionSetDigest: 'extensions',
        contextEpoch: input.configuration.contextEpoch,
        createdAt: now,
      }),
    };
  }
}

class RecordingTurnExecutor implements Pick<ExecuteRuntimeTurn, 'execute'> {
  public readonly calls: ExecuteRuntimeTurnInput[] = [];

  public async execute(
    input: ExecuteRuntimeTurnInput,
  ): Promise<ExecutionOutput> {
    this.calls.push(input);
    return {
      provider: 'recording',
      model: 'deterministic',
      text: 'deterministic reply',
    };
  }
}

function runtimeSession(id: string): RuntimeSession {
  return {
    id,
    owner: {
      tenantId,
      workspaceId,
      principalType: 'service_account',
      principalId: serviceAccountId,
    },
    scope: { kind: 'agent_chat', id: 'chat-runtime-1', epoch: 1 },
    desiredSpecRevision: 1,
    currentGenerationId: null,
    status: 'provisioning',
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  } as RuntimeSession;
}

function chatBrain(): ResolvedChatBrain {
  const productScope = { tenantId, workspaceId } as const;
  const agentOwnerPrincipal = {
    type: 'service_account',
    id: serviceAccountId,
  } as const;
  const actor = { type: 'user', id: personPrincipalId } as const;
  const agentOwner = {
    scope: productScope,
    principal: agentOwnerPrincipal,
  } as const;
  return {
    turnContext: {
      productScope,
      actor,
      agentOwner,
      conversationId: 'conversation-display-1',
      triggerMessageId: 'trigger-display-1',
      agentDefinitionId: definitionId,
      agentVersionId: versionId,
      agentChatRuntimeId: 'chat-runtime-1',
      runtimeEpoch: 1,
    },
    invocationContext: {
      scope: {
        kind: 'agent_chat',
        agentChatRuntimeId: 'chat-runtime-1',
        runtimeEpoch: 1,
      },
      productScope,
      actor,
      agentOwner,
      agentDefinitionId: definitionId,
      agentVersionId: versionId,
      conversationId: 'conversation-display-1',
      triggerMessageId: 'trigger-display-1',
    },
    agentOwner,
    instructions: 'Reply concisely.',
    capabilitySummary: {},
    agentHome: {},
    resolvedSkills: [],
    toolRefs: [],
  } as unknown as ResolvedChatBrain;
}
