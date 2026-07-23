import { describe, expect, it } from 'vitest';
import { assembleContext } from './assemble-context.js';

describe('assembleContext', () => {
  it('keeps exact order and excludes session history', () => {
    const prompt = assembleContext({
      instructions: 'Be concise.',
      taskInput: 'Current question',
      memory: 'Known fact',
    });
    expect(prompt.indexOf('Runtime contract:')).toBeLessThan(
      prompt.indexOf('Published AgentVersion instructions:'),
    );
    expect(prompt.indexOf('Published AgentVersion instructions:')).toBeLessThan(
      prompt.indexOf('Current Task input:'),
    );
    expect(prompt.indexOf('Current Task input:')).toBeLessThan(
      prompt.indexOf('Pinned verified MEMORY.md:'),
    );
    expect(prompt).not.toContain('old session history');
  });
});
