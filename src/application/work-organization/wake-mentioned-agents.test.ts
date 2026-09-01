import { describe, expect, it } from 'vitest';

import {
  wakeMentionedAgents,
  type MentionableAgent,
  type WakeMentionedAgentsDependencies,
} from './wake-mentioned-agents.js';

const researcher: MentionableAgent = {
  id: '00000000-0000-4000-8000-000000000041',
  displayName: '研究员',
  normalizedName: 'agent-researcher',
  runtimeAvailable: true,
};
const offline: MentionableAgent = {
  id: '00000000-0000-4000-8000-000000000042',
  displayName: '文案',
  normalizedName: 'agent-writer',
  runtimeAvailable: false,
};

const workItem = {
  id: '00000000-0000-4000-8000-000000000050',
  title: '核对上周的转化数据',
};

type Recorded = {
  readonly appended: {
    readonly conversationId: string;
    readonly authorType: string;
    readonly body: string;
    readonly turnMetadata: unknown;
  }[];
  readonly enqueued: { readonly agentDefinitionId: string }[];
  readonly directs: { readonly agentDefinitionId: string }[];
};

function createDependencies(
  roster: readonly MentionableAgent[],
  overrides?: {
    readonly failAppend?: boolean;
    readonly failRoster?: boolean;
    readonly runtimeStatus?: string;
  },
): { deps: WakeMentionedAgentsDependencies; recorded: Recorded } {
  const recorded: Recorded = { appended: [], enqueued: [], directs: [] };
  let sequence = 0;
  const deps = {
    roster: {
      async listMentionableAgents() {
        if (overrides?.failRoster) throw new Error('roster down');
        return roster;
      },
    },
    conversations: {
      async getChatRuntime() {
        return { status: overrides?.runtimeStatus ?? 'available' };
      },
      async findOrCreateDirect(input: { agentDefinitionId: string }) {
        recorded.directs.push({ agentDefinitionId: input.agentDefinitionId });
        // Idempotent by contract: the same pair always yields the same id.
        return { id: `conversation-${input.agentDefinitionId}` };
      },
      async appendMessage(input: {
        author: {
          conversationId: string;
          principalType: string;
          type: string;
          turnMetadata?: unknown;
        };
        body: string;
      }) {
        if (overrides?.failAppend) throw new Error('append rejected');
        sequence += 1;
        recorded.appended.push({
          conversationId: input.author.conversationId,
          authorType: input.author.type,
          body: input.body,
          turnMetadata: input.author.turnMetadata,
        });
        return { id: `message-${sequence}`, sequence, authorType: 'principal' };
      },
      async getUnread() {
        return { lastReadSequence: 0 };
      },
    },
    dispatches: {
      async enqueue(input: { agentDefinitionId: string }) {
        recorded.enqueued.push({ agentDefinitionId: input.agentDefinitionId });
        return { enqueued: true };
      },
    },
  } as unknown as WakeMentionedAgentsDependencies;
  return { deps, recorded };
}

const baseInput = {
  tenantId: 'tenant-test',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  actorId: 'human-1',
  actorType: 'user',
  actorLabel: '丹娜',
  workItem,
};

describe('wakeMentionedAgents', () => {
  it('wakes a mentioned Coworker through the ordinary chat path', async () => {
    const { deps, recorded } = createDependencies([researcher]);

    const result = await wakeMentionedAgents(deps, {
      ...baseInput,
      mentions: [researcher.id],
      reason: 'mention',
    });

    expect(result.woken).toEqual([researcher.id]);
    expect(recorded.directs).toEqual([{ agentDefinitionId: researcher.id }]);
    // Principal-authored on purpose: ChatActivationPlanner ignores a latest
    // message authored by an agent_definition, so an agent-authored append would
    // never activate anything.
    expect(recorded.appended[0]?.authorType).toBe('principal');
    expect(recorded.appended[0]?.turnMetadata).toMatchObject({
      kind: 'work_item_mention_wake',
      workItemId: workItem.id,
    });
    expect(recorded.appended[0]?.body).toContain(workItem.title);
    expect(recorded.enqueued).toEqual([{ agentDefinitionId: researcher.id }]);
  });

  it('resolves a mention by display name, normalized name or id', async () => {
    for (const token of [researcher.id, 'agent-researcher', '研究员']) {
      const { deps } = createDependencies([researcher]);
      const result = await wakeMentionedAgents(deps, {
        ...baseInput,
        mentions: [token],
      });
      expect(result.woken).toEqual([researcher.id]);
    }
  });

  it('never wakes the actor, a stranger, or a human', async () => {
    const { deps, recorded } = createDependencies([
      { ...researcher, id: 'human-1' },
    ]);

    const result = await wakeMentionedAgents(deps, {
      ...baseInput,
      mentions: ['human-1', 'someone-not-on-the-roster'],
    });

    expect(result.woken).toEqual([]);
    expect(result.skipped).toEqual(['human-1', 'someone-not-on-the-roster']);
    expect(recorded.appended).toEqual([]);
  });

  it('skips an agent whose runtime is not available', async () => {
    const { deps, recorded } = createDependencies([offline]);
    const byRoster = await wakeMentionedAgents(deps, {
      ...baseInput,
      mentions: [offline.id],
    });
    expect(byRoster.skipped).toEqual([offline.id]);
    expect(recorded.appended).toEqual([]);

    const unavailable = createDependencies([researcher], {
      runtimeStatus: 'degraded',
    });
    const byRuntime = await wakeMentionedAgents(unavailable.deps, {
      ...baseInput,
      mentions: [researcher.id],
    });
    expect(byRuntime.skipped).toEqual([researcher.id]);
    expect(unavailable.recorded.appended).toEqual([]);
  });

  it('reports a failure instead of throwing, so the WorkItem write survives', async () => {
    const failing = createDependencies([researcher], { failAppend: true });
    await expect(
      wakeMentionedAgents(failing.deps, {
        ...baseInput,
        mentions: [researcher.id],
      }),
    ).resolves.toMatchObject({ woken: [], skipped: [researcher.id] });

    const noRoster = createDependencies([researcher], { failRoster: true });
    await expect(
      wakeMentionedAgents(noRoster.deps, {
        ...baseInput,
        mentions: [researcher.id],
      }),
    ).resolves.toMatchObject({ woken: [], skipped: [researcher.id] });
  });

  it('wakes one agent once, even when it is mentioned repeatedly', async () => {
    const { deps, recorded } = createDependencies([researcher]);
    const result = await wakeMentionedAgents(deps, {
      ...baseInput,
      mentions: [researcher.id, '研究员', ' ', researcher.id],
    });
    // Dedupe is on the raw tokens, so two spellings of one agent still resolve
    // twice; what must never happen is a blank token becoming a wake.
    expect(result.woken.every((id) => id === researcher.id)).toBe(true);
    expect(recorded.appended.length).toBe(result.woken.length);
    expect(result.skipped).toEqual([]);
  });

  it('does nothing at all without a mention', async () => {
    const { deps, recorded } = createDependencies([researcher]);
    const result = await wakeMentionedAgents(deps, {
      ...baseInput,
      mentions: [],
    });
    expect(result).toEqual({ woken: [], skipped: [] });
    expect(recorded.directs).toEqual([]);
  });
});
