import { describe, expect, it } from 'vitest';

import { outcomeBody } from './overview-pane';

describe('Work outcome presentation', () => {
  it('keeps a one-line result as its complete document', () => {
    expect(outcomeBody('Done')).toBe('Done');
  });

  it('keeps the first line of a multi-paragraph result', () => {
    const outcome =
      'Investigation complete\n\nThe root cause was a stale binding.';
    expect(outcomeBody(outcome)).toBe(outcome);
  });

  it('keeps an explicit Markdown heading in the rendered result', () => {
    const outcome = '# Final report\n\n- Finding A\n- Finding B';
    expect(outcomeBody(outcome)).toBe(outcome);
  });
});
