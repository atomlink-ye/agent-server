import { describe, expect, it } from 'vitest';

import type { WorkProjectionFacts } from '../work/work-projection-facts.js';
import { mapWorkProjectionFacts } from './work-projection-facts-source.js';

const rootTaskId = '00000000-0000-4000-8000-000000000101';
const teamRunId = '00000000-0000-4000-8000-000000000102';
const actorId = '00000000-0000-4000-8000-000000000103';
const messageId = '00000000-0000-4000-8000-000000000104';
const at = '2026-08-16T00:00:00.000Z';

describe('work projection facts source', () => {
  it('omits a system claim wake from sender-required product identity', () => {
    const facts: WorkProjectionFacts = {
      rootTaskId,
      teamRunId,
      workItems: [],
      actors: [
        { id: actorId, name: 'Analyst', sourceRefs: { rootTaskId, teamRunId } },
      ],
      dependencies: [],
      messages: [
        {
          id: messageId,
          senderId: null,
          recipientId: actorId,
          workItemId: null,
          attemptId: null,
          sequence: 1,
          createdAt: at,
          senderName: null,
          recipientName: 'Analyst',
          bodyCapture: 'present',
          sourceRefs: { rootTaskId, teamRunId, teamMessageId: messageId },
        },
      ],
    };

    expect(mapWorkProjectionFacts(facts)).toMatchObject({
      actors: [{ id: actorId }],
      messages: [],
    });
  });
});
