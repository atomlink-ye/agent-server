import { describe, expect, it } from 'vitest';

import { OpenCodeModelUnavailableError } from './errors.js';
import {
  isExplicitlyFreeModel,
  selectOpenCodeModel,
} from './model-selector.js';

const models = [
  { id: 'opencode/paid', label: 'Paid Model' },
  { id: 'opencode/north-mini-code-free', label: 'North Free' },
  { id: 'opencode/deepseek-v4-flash-free', label: 'DeepSeek V4 Flash Free' },
] as const;

describe('selectOpenCodeModel', () => {
  it('selects the highest-priority currently available free model', () => {
    expect(selectOpenCodeModel(models).id).toBe(
      'opencode/deepseek-v4-flash-free',
    );
  });

  it('allows an explicit operator model only when it exists', () => {
    expect(selectOpenCodeModel(models, 'opencode/paid').id).toBe(
      'opencode/paid',
    );
    expect(() => selectOpenCodeModel(models, 'opencode/missing')).toThrow(
      OpenCodeModelUnavailableError,
    );
  });

  it('never automatically falls back to a model without a free marker', () => {
    expect(() =>
      selectOpenCodeModel([{ id: 'opencode/paid', label: 'Paid' }]),
    ).toThrow(OpenCodeModelUnavailableError);
  });

  it('recognizes explicit free metadata without relying only on the id', () => {
    expect(
      isExplicitlyFreeModel({
        id: 'opencode/promo',
        label: 'Promotional Free Model',
      }),
    ).toBe(true);
  });
});
