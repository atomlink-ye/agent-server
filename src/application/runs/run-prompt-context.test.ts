import { describe, expect, it, vi } from 'vitest';

import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import type { Task } from '../../domain/tasks/task.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import { RunPromptContext } from './run-prompt-context.js';

describe('RunPromptContext', () => {
  it('keeps the compatibility initial prompt free of managed-agent extensions', async () => {
    const resolver = { resolvePublished: vi.fn(async () => null) };
    const context = new RunPromptContext(resolver, {} as never);

    const resolved = await context.resolveInitial({
      prompt: 'first prompt',
      ownerScope: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'service_account',
        principalId: 'principal-1',
      },
      invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      task: {} as Task,
    });

    expect(resolved.turnPrompt).toBe('first prompt');
    expect(resolved.proposalLimit).toBe(0);
    expect(resolved.skills).toEqual([]);
    expect(resolved.toolRefs).toEqual([]);
    expect(resolver.resolvePublished).not.toHaveBeenCalled();
  });

  it('rebuilds continuation context from verified pinned memory without resolving extensions', async () => {
    const resolver = { resolvePublished: vi.fn(async () => null) };
    const fileStore = {
      readVerified: vi.fn(async () => 'pinned memory'),
    };
    const context = new RunPromptContext(
      resolver,
      {} as never,
      fileStore as never,
    );
    const task = {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      memorySnapshotId: 'snapshot-1',
      memorySnapshotHash: 'sha256:memory',
    } as Task;

    const resolved = await context.resolveContinuation({
      prompt: 'next prompt',
      ownerScope: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'service_account',
        principalId: 'principal-1',
      },
      invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      task,
    });

    expect(resolved.turnPrompt).toBe(
      'Pinned verified MEMORY.md:\npinned memory\n\nCurrent Task input:\nnext prompt',
    );
    expect(fileStore.readVerified).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      snapshotId: 'snapshot-1',
      expectedContentHash: 'sha256:memory',
    });
    expect(resolver.resolvePublished).not.toHaveBeenCalled();
  });

  it('keeps the bounded collaboration snapshot and durable workboard/mailbox rules in Lead prompt assembly', async () => {
    const context = new RunPromptContext(
      { resolvePublished: vi.fn(async () => null) },
      {} as never,
    );
    const team = { id: 'team-run-1234567890' } as TeamRun;
    const lead = {
      id: 'lead-1',
      name: 'research-lead',
      role: 'lead',
    } as TeamMemberRun;
    const task = {
      teamTaskKind: 'lead_turn',
      teamSequence: 3,
    } as Task;

    const prompts = await context.buildTurnPrompts({
      resolved: {
        systemPrompt: 'base system',
        turnPrompt: 'goal',
        proposalLimit: 0,
        agentVersionId: 'agent-version-1',
        modelPolicyRef: 'free-only',
        skills: [],
        toolRefs: [],
      },
      priorExternalSessionId: null,
      team,
      member: lead,
      teamMembers: [lead],
      leadState: {
        workItems: [],
        attempts: [],
        policy: {
          allowedCommands: [],
          eligibleAcceptWorkItemIds: [],
          eligibleReworkWorkItemIds: [],
          eligibleCancelWorkItemIds: [],
          limits: {
            maxLeadTurns: 8,
            remainingLeadTurns: 8,
            maxWorkItems: 4,
            remainingWorkItems: 4,
            maxAttemptsPerItem: 2,
          },
        },
      },
      task,
    });

    expect(prompts.deliveredTurnPrompt).toContain(
      'Current bounded collaboration snapshot:',
    );
    expect(prompts.deliveredTurnPrompt).toContain(
      'A natural-language message never changes ownership or Work state',
    );
    expect(prompts.deliveredTurnPrompt).toContain(
      'Tool availability does not imply that an operation is currently legal',
    );
    expect(prompts.deliveredTurnPrompt).toContain(
      'If a collaboration tool returns a typed error, read collaboration_state again',
    );
    expect(prompts.deliveredTurnPrompt).not.toContain('capabilities');
    expect(prompts.deliveredTurnPrompt).toContain('board_create/board_assign');
    expect(prompts.deliveredTurnPrompt).toContain('goal');
    expect(prompts.systemPrompt).toContain('base system');
    expect(prompts.systemPrompt).toContain('durable Workboard and Mailbox');
  });
});
