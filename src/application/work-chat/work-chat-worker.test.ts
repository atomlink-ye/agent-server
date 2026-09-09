import { describe, expect, it } from 'vitest';
import {
  parseLeadOutput,
  renderWorkChatInputSchemaPrompt,
} from './work-chat-worker.js';

describe('parseLeadOutput', () => {
  it('extracts the bounded preparation envelope', () => {
    expect(
      parseLeadOutput(
        JSON.stringify({
          reply: 'Need a topic.',
          candidate_input: { topic: 'alpha' },
          missing: [],
          ambiguities: [],
        }),
      ),
    ).toEqual({
      replyText: 'Need a topic.',
      candidateInput: { topic: 'alpha' },
      missing: [],
      ambiguities: [],
    });
  });

  it('falls back to safe text when the model claims readiness without an envelope', () => {
    expect(parseLeadOutput('Everything is ready.')).toEqual({
      replyText: 'Everything is ready.',
      candidateInput: {},
      missing: [],
      ambiguities: [],
    });
  });

  it('includes the current schema properties and required fields in the intake prompt', () => {
    const prompt = renderWorkChatInputSchemaPrompt({
      type: 'object',
      properties: {
        topic: { type: 'string', min_length: 1 },
        row_count: { type: 'integer', minimum: 1 },
      },
      required: ['topic'],
      additional_properties: false,
    });
    expect(prompt).toContain('topic');
    expect(prompt).toContain('row_count');
    expect(prompt).toContain('required');
    expect(prompt).toContain('additional_properties');
  });
});
