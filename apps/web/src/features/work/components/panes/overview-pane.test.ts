import { describe, expect, it } from 'vitest';

import { outcomeBody, outcomeHeadline } from './overview-pane';

describe('Work outcome presentation', () => {
  it('renders a one-line unheaded result once', () => {
    expect(outcomeHeadline('Done')).toBe('Done');
    expect(outcomeBody('Done')).toBe('');
  });

  it('removes the promoted first line from a multi-paragraph unheaded result', () => {
    const outcome = 'Investigation complete\n\nThe root cause was a stale binding.';
    expect(outcomeHeadline(outcome)).toBe('Investigation complete');
    expect(outcomeBody(outcome)).toBe('The root cause was a stale binding.');
  });

  it('removes an explicit Markdown heading from the rendered body', () => {
    const outcome = '# Final report\n\n- Finding A\n- Finding B';
    expect(outcomeHeadline(outcome)).toBe('Final report');
    expect(outcomeBody(outcome)).toBe('- Finding A\n- Finding B');
  });
});
