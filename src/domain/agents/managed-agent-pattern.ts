import { RE2JS } from 're2js';

export const MAX_MANAGED_PATTERN_LENGTH = 1024;
export const MAX_MANAGED_PATTERN_PROGRAM_SIZE = 2048;
export const MAX_MANAGED_PATTERN_INPUT_LENGTH = 16 * 1024;
export const MANAGED_PATTERN_DIALECT = 're2' as const;
export const MANAGED_PATTERN_COMPILER_VERSION = 're2js-2.8.6' as const;

export interface ManagedPattern {
  readonly source: string;
  readonly programSize: number;
}

export class ManagedPatternError extends Error {
  constructor(
    readonly code: 'invalid_regex' | 'pattern_input_limit',
    readonly path: '$.pattern' | '$.input',
  ) {
    super(code);
    this.name = 'ManagedPatternError';
  }
}

const fail = (
  code: ManagedPatternError['code'],
  path: ManagedPatternError['path'],
): never => {
  throw new ManagedPatternError(code, path);
};

export function validateManagedPattern(source: string): ManagedPattern {
  if (typeof source !== 'string' || source.length > MAX_MANAGED_PATTERN_LENGTH)
    fail('invalid_regex', '$.pattern');
  const compiled: RE2JS = (() => {
    try {
      return RE2JS.compile(source);
    } catch {
      return fail('invalid_regex', '$.pattern');
    }
  })();
  const programSize = compiled.programSize();
  if (programSize > MAX_MANAGED_PATTERN_PROGRAM_SIZE)
    fail('invalid_regex', '$.pattern');
  return Object.freeze({ source, programSize });
}

export function matchesManagedPattern(source: string, input: string): boolean {
  if (
    typeof input !== 'string' ||
    input.length > MAX_MANAGED_PATTERN_INPUT_LENGTH
  )
    fail('pattern_input_limit', '$.input');
  const pattern = validateManagedPattern(source);
  try {
    return RE2JS.compile(pattern.source).test(input);
  } catch {
    return fail('invalid_regex', '$.pattern');
  }
}
