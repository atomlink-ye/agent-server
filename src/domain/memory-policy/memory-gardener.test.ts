import { describe, expect, it } from 'vitest';
import { suggestMemoryGardenerActions } from './memory-gardener.js';

describe('memory gardener', () => {
  it('only suggests duplicate, supersession, and expiry actions', () => {
    const duplicate = suggestMemoryGardenerActions(
      {
        category: 'terminology',
        content: ' Use   Workspace. ',
        expiresAt: '2027-01-01T00:00:00Z',
      },
      [{ category: 'terminology', content: 'use workspace.' }],
    );
    expect(duplicate.map((item) => item.kind)).toEqual(['duplicate', 'expiry']);
    const contradiction = suggestMemoryGardenerActions(
      { category: 'terminology', content: 'Use dossier.' },
      [{ category: 'terminology', content: 'Use workspace.' }],
    );
    expect(contradiction[0]).toMatchObject({
      kind: 'supersession',
      reasonCode: 'same_category_contradiction_candidate',
    });
  });
});
