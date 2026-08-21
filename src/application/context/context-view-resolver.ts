import type { LogicalFileEntry, LogicalFileStore } from '../ports/logical-file-store.js';
import {
  agentContextScope,
  agentUserContextScope,
  conversationContextScope,
  organizationContextScope,
  runtimeScratchContextScope,
  workContextScope,
  workspaceContextScope,
  type ContextMount,
  type ContextView,
} from '../../domain/context/context-fs.js';
import type { PrincipalRef, ProductScope } from '../../domain/tenancy/product-context.js';

export interface ResolveChatContextViewInput {
  readonly productScope: ProductScope;
  readonly actor: PrincipalRef;
  readonly agentDefinitionId: string;
  readonly conversationId: string;
  readonly runtimeSessionId?: string;
}

export interface ResolveWorkerContextViewInput {
  readonly productScope: ProductScope;
  readonly agentDefinitionId: string;
  readonly workId: string;
  readonly runtimeSessionId?: string;
}

/**
 * Resolves mount manifests only. Storage is owned by LogicalFileStore and is
 * deliberately separate from the runtime cwd / provider workspace.
 */
export class ContextViewResolver {
  public forChat(input: ResolveChatContextViewInput): ContextView {
    const mounts: ContextMount[] = [
      {
        mountPath: '/agent',
        scope: agentContextScope({
          tenantId: input.productScope.tenantId,
          agentDefinitionId: input.agentDefinitionId,
        }),
        access: 'read_write',
      },
      {
        mountPath: '/organization',
        scope: organizationContextScope(input.productScope.tenantId),
        access: 'read_only',
      },
      {
        mountPath: '/workspace',
        scope: workspaceContextScope(input.productScope),
        access: 'read_write',
      },
      {
        mountPath: '/user',
        scope: agentUserContextScope({
          tenantId: input.productScope.tenantId,
          agentDefinitionId: input.agentDefinitionId,
          principal: input.actor,
        }),
        access: 'read_write',
      },
      {
        mountPath: '/conversation',
        scope: conversationContextScope({
          tenantId: input.productScope.tenantId,
          conversationId: input.conversationId,
        }),
        access: 'read_write',
      },
    ];
    if (input.runtimeSessionId) {
      mounts.push({
        mountPath: '/scratch',
        scope: runtimeScratchContextScope({
          tenantId: input.productScope.tenantId,
          runtimeSessionId: input.runtimeSessionId,
        }),
        access: 'read_write',
      });
    }
    return Object.freeze({ kind: 'chat', mounts: Object.freeze(mounts) });
  }

  public forWorker(input: ResolveWorkerContextViewInput): ContextView {
    const workScope = workContextScope({
      tenantId: input.productScope.tenantId,
      workspaceId: input.productScope.workspaceId,
      workId: input.workId,
    });
    const mounts: ContextMount[] = [
      {
        mountPath: '/agent',
        scope: agentContextScope({
          tenantId: input.productScope.tenantId,
          agentDefinitionId: input.agentDefinitionId,
        }),
        access: 'read_only',
      },
      {
        mountPath: '/organization',
        scope: organizationContextScope(input.productScope.tenantId),
        access: 'read_only',
      },
      {
        mountPath: '/workspace',
        scope: workspaceContextScope(input.productScope),
        access: 'read_only',
      },
      {
        mountPath: '/input',
        scope: workScope,
        access: 'read_only',
        pathPrefix: 'input',
      },
      {
        mountPath: '/work',
        scope: workScope,
        access: 'read_write',
      },
    ];
    if (input.runtimeSessionId) {
      mounts.push({
        mountPath: '/scratch',
        scope: runtimeScratchContextScope({
          tenantId: input.productScope.tenantId,
          runtimeSessionId: input.runtimeSessionId,
        }),
        access: 'read_write',
      });
    }
    return Object.freeze({ kind: 'worker', mounts: Object.freeze(mounts) });
  }
}

export interface ResolvedContextMount {
  readonly mount: ContextMount;
  readonly entries: readonly LogicalFileEntry[];
}

export interface ResolvedContextView {
  readonly view: ContextView;
  readonly mounts: readonly ResolvedContextMount[];
}

export class ContextViewReader {
  public constructor(private readonly files: LogicalFileStore) {}

  public async read(view: ContextView): Promise<ResolvedContextView> {
    const mounts = await Promise.all(
      view.mounts.map(async (mount) => {
        const entries = await this.files.list(mount.scope);
        const prefix = mount.pathPrefix
          ? `${mount.pathPrefix.replace(/\/$/u, '')}/`
          : null;
        return Object.freeze({
          mount,
          entries: Object.freeze(
            prefix
              ? entries
                  .filter((entry) => entry.path.startsWith(prefix))
                  .map((entry) => ({
                    ...entry,
                    path: entry.path.slice(prefix.length),
                  }))
              : [...entries],
          ),
        });
      }),
    );
    return Object.freeze({ view, mounts: Object.freeze(mounts) });
  }
}
