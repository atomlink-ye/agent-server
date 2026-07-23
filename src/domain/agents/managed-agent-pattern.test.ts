import { describe, expect, it } from 'vitest';
import { RE2JS } from 're2js';
import {
  MANAGED_PATTERN_COMPILER_VERSION,
  MANAGED_PATTERN_DIALECT,
  MAX_MANAGED_PATTERN_LENGTH,
  MAX_MANAGED_PATTERN_PROGRAM_SIZE,
  MAX_MANAGED_PATTERN_INPUT_LENGTH,
  matchesManagedPattern,
  validateManagedPattern,
} from './managed-agent-pattern.js';

describe('managed RE2 patterns', () => {
  it('accepts ordinary RE2 patterns and preserves the source', () => {
    for (const source of [
      '^(foo|bar)$',
      'a?b?',
      '^[a-z]+$',
      '^a{2,4}$',
      '^foo\\d+$',
    ]) {
      expect(validateManagedPattern(source).source).toBe(source);
    }
    expect(MANAGED_PATTERN_DIALECT).toBe('re2');
    expect(MANAGED_PATTERN_COMPILER_VERSION).toBe('re2js-2.8.6');
  });

  it('uses JSON Schema search semantics unless anchors are supplied', () => {
    expect(matchesManagedPattern('foo', 'xxfooyy')).toBe(true);
    expect(matchesManagedPattern('^foo$', 'xxfooyy')).toBe(false);
    expect(matchesManagedPattern('^foo$', 'foo')).toBe(true);
  });

  it('rejects backreferences and lookarounds without echoing source', () => {
    for (const source of ['(foo)\\1', '(?=foo)foo', '(?!foo)bar']) {
      try {
        validateManagedPattern(source);
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'invalid_regex',
          path: '$.pattern',
        });
        expect(JSON.stringify(error)).not.toContain(source);
      }
    }
  });

  it('rejects oversized source, compiled program, and candidate input', () => {
    expect(() =>
      validateManagedPattern('a'.repeat(MAX_MANAGED_PATTERN_LENGTH + 1)),
    ).toThrow();
    const largeProgram = '(ab){1000}';
    const compiled = RE2JS.compile(largeProgram);
    expect(largeProgram.length).toBeLessThan(MAX_MANAGED_PATTERN_LENGTH);
    expect(compiled.programSize()).toBeGreaterThan(
      MAX_MANAGED_PATTERN_PROGRAM_SIZE,
    );
    let error: unknown;
    try {
      validateManagedPattern(largeProgram);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'invalid_regex', path: '$.pattern' });
    expect(JSON.stringify(error)).not.toContain(largeProgram);
    expect(() =>
      matchesManagedPattern(
        'a',
        'a'.repeat(MAX_MANAGED_PATTERN_INPUT_LENGTH + 1),
      ),
    ).toThrow();
    expect(MAX_MANAGED_PATTERN_PROGRAM_SIZE).toBe(2048);
  });

  it('handles adversarial nested repetition with bounded RE2 execution', () => {
    const input = 'a'.repeat(MAX_MANAGED_PATTERN_INPUT_LENGTH - 1) + 'b';
    expect(matchesManagedPattern('(a+)+$', input)).toBe(false);
  });
});
