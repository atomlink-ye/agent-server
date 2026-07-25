import { EventDispatcher } from '@larksuiteoapi/node-sdk';

import { ProcessChannelIngress } from '../../src/application/channels/process-channel-ingress.js';
import { ProcessLarkIngress } from '../../src/application/channels/process-lark-ingress.js';
import { ResolveLarkBinding } from '../../src/application/channels/resolve-lark-binding.js';
import { SubmitSessionTurn } from '../../src/application/sessions/submit-session-turn.js';
import { ApplyMemoryReviewCommand } from '../../src/application/channels/apply-memory-review-command.js';
import { ApplyMemoryReviewControl } from '../../src/application/channels/apply-memory-review-control.js';
import { PublishMemoryReviewSurface } from '../../src/application/channels/publish-memory-review-surface.js';
import { DeliverChannelOutbox } from '../../src/application/channels/deliver-channel-outbox.js';
import { createLarkWebsocketReceiver } from '../../src/adapters/lark/lark-websocket-receiver.js';
import { LarkIngressWorker } from '../../src/entrypoints/lark/worker.js';
import { LarkOutboxWorker } from '../../src/entrypoints/lark/outbox-worker.js';
import { PostgresChannelRepository } from '../../src/infrastructure/postgres/postgres-channel-repository.js';
import { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresLarkReviewSurfaceRepository } from '../../src/infrastructure/postgres/postgres-lark-review-surface-repository.js';
import { createMemoryReviewActionTokenDeriver } from '../../src/application/channels/memory-review-action-token.js';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  type TestDatabase,
} from './create-test-app.js';
import { FakeAgentRuntime } from './fake-agent-runtime.js';
import type { FakeRuntimeOptions } from './fake-agent-runtime.js';
import { createLarkMemoryDocumentAdapter } from '../../src/adapters/lark/lark-memory-document.js';
import { SynthesizeMemoryDocument } from '../../src/application/channels/synthesize-memory-document.js';

/** Deterministic stateful Docx double used by Task 11/12 flows. */
export class FakeLarkDocumentProvider {
  public readonly documents = new Map<
    string,
    { revision: number; blocks: readonly Record<string, unknown>[] }
  >();
  public readonly comments = new Map<
    string,
    { id: string; text: string; replies: string[]; solved: boolean }[]
  >();
  public readonly calls: Array<{ method: string; payload: unknown }> = [];
  private next = 1;
  public readonly client = {
    docx: {
      document: {
        create: async (payload: unknown) => {
          this.calls.push({ method: 'document.create', payload });
          const token = `fake-doc-${this.next++}`;
          this.documents.set(token, { revision: 1, blocks: [] });
          this.comments.set(token, []);
          return { data: { document: { document_id: token, revision_id: 1 } } };
        },
      },
      documentBlockChildren: {
        create: async (payload: any) => {
          this.calls.push({ method: 'documentBlockChildren.create', payload });
          const token = payload.path.document_id;
          const current = this.documents.get(token);
          if (current) {
            current.blocks = [
              ...current.blocks,
              ...(payload.data.children ?? []),
            ];
            current.revision += 1;
          }
          return { data: { document_revision_id: current?.revision ?? 1 } };
        },
        get: async (payload: any) => {
          this.calls.push({ method: 'documentBlockChildren.get', payload });
          const current = this.documents.get(payload.path.document_id);
          return {
            data: {
              items: [...(current?.blocks ?? [])],
              document_revision_id: current?.revision ?? 1,
            },
          };
        },
      },
    },
    drive: {
      permissionMember: {
        create: async (payload: unknown) => {
          this.calls.push({ method: 'permissionMember.create', payload });
          return { data: { member: payload } };
        },
      },
    },
    request: async (input: any) => {
      this.calls.push({ method: 'request', payload: input });
      const token = String(input.url).split('/')[5] ?? '';
      const list = this.comments.get(token) ?? [];
      if (String(input.url).endsWith('/comments'))
        return {
          data: {
            items: list
              .filter((item) => !item.solved)
              .map((item) => ({ comment_id: item.id, content: item.text })),
            has_more: false,
          },
        };
      const id = String(input.url).split('/')[7];
      const comment = list.find((item) => item.id === id);
      return {
        data: {
          items: comment
            ? [comment.text, ...comment.replies].map((content) => ({ content }))
            : [],
          has_more: false,
        },
      };
    },
  } as any;
  public edit(token: string, blocks: readonly Record<string, unknown>[]): void {
    const current = this.documents.get(token);
    if (!current) throw new Error('fake document not found');
    current.blocks = blocks;
    current.revision += 1;
  }
  public setBody(
    token: string,
    blocks: readonly Record<string, unknown>[],
  ): void {
    this.edit(token, blocks);
  }
  public addComment(token: string, id: string, text: string): void {
    const list = this.comments.get(token) ?? [];
    list.push({ id, text, replies: [], solved: false });
    this.comments.set(token, list);
  }
  public addReply(token: string, id: string, text: string): void {
    const comment = this.comments.get(token)?.find((item) => item.id === id);
    if (!comment) throw new Error('fake comment not found');
    comment.replies.push(text);
  }
  public resolveComment(token: string, id: string): void {
    const comment = this.comments.get(token)?.find((item) => item.id === id);
    if (!comment) throw new Error('fake comment not found');
    comment.solved = true;
  }
}

const workspaceId = '00000000-0000-4000-8000-000000006006';

export const larkE2eConfig = {
  enabled: true as const,
  connectionKey: 'lark/ingress-e2e',
  appId: 'lark-ingress-e2e-app',
  domain: 'lark' as const,
  appSecret: 'lark-ingress-e2e-secret',
  botOpenId: 'ou_lark_ingress_e2e_bot',
  allowedChatId: 'oc_lark_ingress_e2e_chat',
  allowedOpenId: 'ou_lark_ingress_e2e_user',
  tenantId: 'tenant_alpha',
  workspaceId,
  serviceAccountId: 'svc_enabled',
  publishedAgentVersionId: defaultPublishedAgentVersionId,
  policyVersion: 'policy-2026-07-22',
  docWebBaseUrl: 'https://lark.test',
};

export async function createLarkTestService(
  options: {
    readonly runtime?: FakeRuntimeOptions;
    readonly database?: TestDatabase;
    readonly config?: Partial<typeof larkE2eConfig>;
  } = {},
) {
  const config = { ...larkE2eConfig, ...options.config };
  const ownsDatabase = options.database === undefined;
  const runtime = new FakeAgentRuntime({
    responseText: 'LARK_INGRESS_E2E_OK',
    ...options.runtime,
  });
  const documentProvider = new FakeLarkDocumentProvider();
  const documents = createLarkMemoryDocumentAdapter(config, {
    client: documentProvider.client,
  });
  const databaseControl: { database?: TestDatabase } = {};
  const dispatcherControl: { dispatcher?: PostgresRunDispatcher } = {};
  const sessionRepositoryControl: { repository?: any } = {};
  const memoryReviewControl: {
    review?: import('../../src/application/memory/review-memory-proposal.js').ReviewMemoryProposal;
    managedMemory?: import('../../src/application/memory/managed-memory.js').ManagedMemory;
  } = {};
  const deliveries: Array<
    import('../../src/application/ports/lark-delivery.js').LarkDeliveryInput
  > = [];
  let memoryReviewSurface: PublishMemoryReviewSurface | undefined;
  await createTestApp(runtime, {
    workspaceId: config.workspaceId,
    seedManagedAgent: true,
    startDispatcher: false,
    databaseControl,
    ...(options.database ? { database: options.database } : {}),
    publishedAgentVersionId: config.publishedAgentVersionId,
    dispatcherControl,
    sessionRepositoryControl,
    memoryReviewControl,
    memoryReviewNotifier: {
      execute: (input) => memoryReviewSurface!.execute(input),
    },
  });
  const database = databaseControl.database;
  const dispatcher = dispatcherControl.dispatcher;
  const sessions = sessionRepositoryControl.repository;
  if (!database || !dispatcher || !sessions)
    throw new Error('fixture setup failed');
  const repositoryDatabase = database as any;

  const channel = new PostgresChannelRepository(repositoryDatabase);
  const realMemoryReviewSurface = new PublishMemoryReviewSurface(
    {
      listPendingProposalsBySourceRunForOwner: (runId, owner) =>
        database
          .query<any>(
            `SELECT * FROM workspace_memory_proposals WHERE source_run_id=$1 AND status='pending'`,
            [runId],
          )
          .then((result) =>
            result.rows
              .map(
                (row) =>
                  ({
                    id: row.id,
                    tenantId: row.tenant_id,
                    workspaceId: row.workspace_id,
                    principalType: row.principal_type,
                    principalId: row.principal_id,
                    originalContent: row.original_content,
                    originalCategory: row.original_category,
                    status: row.status,
                    sourceRunId: row.source_run_id,
                  }) as any,
              )
              .filter(
                (proposal) =>
                  proposal.tenantId === owner.tenantId &&
                  proposal.workspaceId === owner.workspaceId,
              ),
          ),
    },
    channel,
    channel,
    config.connectionKey,
    new PostgresLarkReviewSurfaceRepository(database),
    createMemoryReviewActionTokenDeriver(config.appSecret),
    documents,
    config.allowedOpenId,
  );
  memoryReviewSurface = realMemoryReviewSurface;
  dispatcher.start();
  const processor = new ProcessChannelIngress(
    new ResolveLarkBinding(channel, config),
    new SubmitSessionTurn(sessions),
    channel,
    config,
  );
  const commandProcessor = new ApplyMemoryReviewCommand(
    channel,
    memoryReviewControl.review!,
    memoryReviewControl.managedMemory!,
    config,
  );
  const processLarkIngress = new ProcessLarkIngress(
    processor,
    commandProcessor,
    new ApplyMemoryReviewControl(
      channel,
      new PostgresLarkReviewSurfaceRepository(database),
      memoryReviewControl.review!,
      memoryReviewControl.managedMemory!,
      config,
      documents,
      new SynthesizeMemoryDocument(runtime),
    ),
  );
  const worker = new LarkIngressWorker(channel, processLarkIngress, {
    workerId: 'lark-ingress-e2e-worker',
    leaseMs: 30_000,
    pollIntervalMs: 1,
  });

  let eventDispatcher!: EventDispatcher;
  const client = {
    start: async (input: { eventDispatcher: EventDispatcher }) => {
      eventDispatcher = input.eventDispatcher;
    },
    close: () => undefined,
  };
  const receiver = createLarkWebsocketReceiver({
    config,
    repository: channel,
    clientFactory: () => client,
  });
  const delivery = new DeliverChannelOutbox(
    {
      deliver: async (input) => {
        deliveries.push(input);
        return {
          result: 'delivered',
          providerMessageId: `fake-${deliveries.length}`,
        };
      },
    },
    channel,
    {
      tokenDeriver: createMemoryReviewActionTokenDeriver(config.appSecret),
      validateCardPublication: (input) =>
        new PostgresLarkReviewSurfaceRepository(
          database,
        ).validateCardPublication(input),
      finalizeCardDelivery: (input) =>
        new PostgresLarkReviewSurfaceRepository(database).finalizeCardDelivery(
          input,
        ),
      docWebBaseUrl: config.docWebBaseUrl,
    },
  );
  const outboxWorker = new LarkOutboxWorker(channel, delivery, {
    workerId: 'lark-outbox-e2e-worker',
    leaseMs: 30_000,
    pollIntervalMs: 1,
  });

  await receiver.start();
  worker.start();
  outboxWorker.start();

  return {
    database,
    config,
    runtime,
    documentProvider,
    deliveries,
    dispatch: (event: unknown) =>
      eventDispatcher.invoke(event, { needCheck: false }),
    close: async () => {
      await receiver.stop();
      await worker.stop();
      await outboxWorker.stop();
      await dispatcher.stop();
      await runtime.close();
      if (
        ownsDatabase &&
        'close' in database &&
        typeof database.close === 'function'
      )
        await database.close();
    },
  };
}
