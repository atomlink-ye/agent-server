import { describe, expect, it, vi } from 'vitest';
import { createDesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';
import {
  runtimeSpecRevision,
  type RuntimeSession,
} from '../../domain/runtime/runtime-session.js';
import {
  createRuntimeSessionSpec,
  type RuntimeSessionSpec,
} from '../../domain/runtime/runtime-session-spec.js';
import { EnsureDesiredRuntimeSpecService } from './ensure-desired-runtime-spec.js';

describe('EnsureDesiredRuntimeSpecService', () => {
  it('appends exactly one next desired revision when an existing owner changes', async () => {
    const session = runtimeSession(1);
    const first = spec(session.id, 'next-prompt', ['tool-a']);
    const next = spec(session.id, 'next-prompt', ['tool-b']);
    const findByScope = vi.fn(async () => session);
    const findById = vi.fn(async () => runtimeSession(2));
    const getDesired = vi
      .fn<(_session: RuntimeSession) => Promise<RuntimeSessionSpec>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(next);
    const append = vi.fn(async () => undefined);
    const service = new EnsureDesiredRuntimeSpecService(
      { findByScope, findById, createWithInitialSpec: vi.fn() } as never,
      { getDesired, append } as never,
      {
        execute: vi.fn((input) =>
          createRuntimeSessionSpec({
            ...next,
            runtimeSessionId:
              input.target.kind === 'revision'
                ? input.target.runtimeSessionId
                : session.id,
            revision:
              input.target.kind === 'revision'
                ? input.target.revision
                : runtimeSpecRevision(1),
          }),
        ),
      },
      () => new Date('2026-08-24T00:00:00.000Z'),
    );

    const desiredSystemPrompt = createDesiredRuntimeSystemPrompt('next-prompt');
    const result = await service.execute({
      owner: session.owner,
      scope: session.scope,
      agentVersionId: 'agent-version-2',
      environmentVersionId: null,
      resolvedSkills: [],
      toolRefs: [],
      configuration: {
        provider: 'opencode',
        model: null,
        cwd: '/runtime',
        contextEpoch: 1,
        desiredSystemPrompt,
      },
    });

    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith({
      spec: expect.objectContaining({
        runtimeSessionId: session.id,
        revision: runtimeSpecRevision(2),
        systemPromptDigest: next.systemPromptDigest,
        toolRefs: ['tool-b'],
      }),
      expectedDesiredRevision: runtimeSpecRevision(1),
    });
    expect(result.session.desiredSpecRevision).toBe(2);
    expect(result.spec).toBe(next);
  });

  it('accepts a CAS loser when another writer installed the equivalent desired spec', async () => {
    const session = runtimeSession(1);
    const desired = spec(session.id, 'next-prompt', ['tool-b']);
    const findById = vi.fn(async () => runtimeSession(2));
    const getDesired = vi
      .fn<(_session: RuntimeSession) => Promise<RuntimeSessionSpec>>()
      .mockResolvedValueOnce(spec(session.id, 'next-prompt', ['tool-a']))
      .mockResolvedValueOnce(desired);
    const append = vi.fn(async () => {
      throw new Error('Runtime session desired revision changed.');
    });
    const service = new EnsureDesiredRuntimeSpecService(
      {
        findByScope: vi.fn(async () => session),
        findById,
        createWithInitialSpec: vi.fn(),
      } as never,
      { getDesired, append } as never,
      {
        execute: vi.fn((input) =>
          spec(
            input.target.kind === 'revision'
              ? input.target.runtimeSessionId
              : session.id,
            input.configuration.desiredSystemPrompt.text,
            input.toolRefs,
            input.target.kind === 'revision'
              ? input.target.revision
              : runtimeSpecRevision(1),
          ),
        ),
      },
    );

    const result = await service.execute({
      owner: session.owner,
      scope: session.scope,
      agentVersionId: 'agent-version-2',
      environmentVersionId: null,
      resolvedSkills: [],
      toolRefs: ['tool-b'],
      configuration: {
        provider: 'opencode',
        model: null,
        cwd: '/runtime',
        contextEpoch: 1,
        desiredSystemPrompt: createDesiredRuntimeSystemPrompt('next-prompt'),
      },
    });

    expect(append).toHaveBeenCalledOnce();
    expect(findById).toHaveBeenCalledOnce();
    expect(result.spec).toBe(desired);
  });
});

function runtimeSession(revision: number): RuntimeSession {
  return {
    id: 'runtime-session-1' as RuntimeSession['id'],
    owner: {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
    },
    scope: { kind: 'agent_chat', id: 'chat-1', epoch: 1 },
    desiredSpecRevision: runtimeSpecRevision(revision),
    currentGenerationId: null,
    status: 'ready',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    closedAt: null,
  };
}

function spec(
  runtimeSessionId: RuntimeSession['id'],
  prompt: string,
  toolRefs: readonly string[],
  revision = runtimeSpecRevision(1),
): RuntimeSessionSpec {
  return createRuntimeSessionSpec({
    runtimeSessionId,
    revision,
    workspaceId: 'workspace-1',
    agentVersionId: 'agent-version-1',
    environmentVersionId: null,
    resolvedSkills: [],
    toolRefs,
    provider: 'opencode',
    model: null,
    cwd: '/runtime',
    systemPromptDigest: createDesiredRuntimeSystemPrompt(prompt).digest,
    skillSetDigest: 'skills',
    toolCatalogDigest: 'catalog',
    extensionSetDigest: 'extensions',
    contextEpoch: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
  });
}
