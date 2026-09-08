import { describe, expect, it } from 'vitest';

import { RuntimeModelUnavailableError } from './errors.js';
import {
  isExplicitlyFreeModel,
  selectRuntimeModel,
  type PaseoModelDescriptor,
} from './model-selector.js';

const openCodeModels = [
  { id: 'opencode/paid', label: 'Paid Model' },
  { id: 'opencode/north-mini-code-free', label: 'North Free' },
  { id: 'opencode/deepseek-v4-flash-free', label: 'DeepSeek V4 Flash Free' },
] as const;

/**
 * What Paseo 0.7.0 reports for Claude: one default marker, legacy aliases that
 * answer but are not selectable, and no free/paid marker anywhere -- which is
 * why the free-only filter can only ever empty this catalog.
 */
const claudeModels: readonly PaseoModelDescriptor[] = [
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    description: 'Most capable',
    isDefault: true,
  },
  {
    id: 'claude-fable-5',
    label: 'Fable 5',
    description: 'Most powerful model',
  },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', description: 'Latest release' },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    description: 'Best for everyday tasks',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    description: 'Fastest for quick answers',
  },
];

describe('selectRuntimeModel', () => {
  describe('opencode', () => {
    it('selects the highest-priority currently available free model', () => {
      expect(
        selectRuntimeModel({ provider: 'opencode', models: openCodeModels }).id,
      ).toBe('opencode/deepseek-v4-flash-free');
    });

    it('allows an explicit operator model only when it exists', () => {
      expect(
        selectRuntimeModel({
          provider: 'opencode',
          models: openCodeModels,
          requestedModel: 'opencode/paid',
        }).id,
      ).toBe('opencode/paid');
      expect(() =>
        selectRuntimeModel({
          provider: 'opencode',
          models: openCodeModels,
          requestedModel: 'opencode/missing',
        }),
      ).toThrow(RuntimeModelUnavailableError);
    });

    it('never automatically falls back to a model without a free marker', () => {
      expect(() =>
        selectRuntimeModel({
          provider: 'opencode',
          models: [{ id: 'opencode/paid', label: 'Paid' }],
        }),
      ).toThrow(RuntimeModelUnavailableError);
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

  describe('claude', () => {
    it('honours the operator-pinned demo model', () => {
      expect(
        selectRuntimeModel({
          provider: 'claude',
          models: claudeModels,
          requestedModel: 'claude-sonnet-5',
        }).id,
      ).toBe('claude-sonnet-5');
    });

    it('falls back to the catalog default rather than requiring a free marker', () => {
      expect(
        selectRuntimeModel({ provider: 'claude', models: claudeModels }).id,
      ).toBe('claude-opus-5');
    });

    it('falls back to the first model when Paseo marks no default', () => {
      const unmarked = claudeModels.map(
        ({ isDefault: _unused, ...rest }) => rest,
      );
      expect(
        selectRuntimeModel({ provider: 'claude', models: unmarked }).id,
      ).toBe('claude-opus-5');
    });

    it('never auto-selects a legacy alias entry Paseo marks unselectable', () => {
      const withAlias: readonly PaseoModelDescriptor[] = [
        { id: 'claude-fable-5-legacy', label: 'Fable 5', isSelectable: false },
        { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      ];
      expect(
        selectRuntimeModel({ provider: 'claude', models: withAlias }).id,
      ).toBe('claude-sonnet-5');
    });

    it('still honours an alias an operator pinned explicitly', () => {
      const withAlias: readonly PaseoModelDescriptor[] = [
        { id: 'claude-fable-5-legacy', label: 'Fable 5', isSelectable: false },
        { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      ];
      expect(
        selectRuntimeModel({
          provider: 'claude',
          models: withAlias,
          requestedModel: 'claude-fable-5-legacy',
        }).id,
      ).toBe('claude-fable-5-legacy');
    });

    it('names the provider and the real catalog when a pinned model is absent', () => {
      expect(() =>
        selectRuntimeModel({
          provider: 'claude',
          models: claudeModels,
          requestedModel: 'claude-sonnet-4-5',
        }),
      ).toThrow(
        /Configured claude model is unavailable: claude-sonnet-4-5\..*claude-sonnet-5/,
      );
    });

    it('reports an empty catalog as a provider problem, not a model problem', () => {
      expect(() =>
        selectRuntimeModel({ provider: 'claude', models: [] }),
      ).toThrow(/Paseo reported no claude models/);
    });
  });

  describe('codex', () => {
    it('keeps honouring the pinned model the existing demo runs on', () => {
      const codexModels = [
        { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', isDefault: true },
        { id: 'gpt-5.6-terra-mini', label: 'GPT-5.6 Terra Mini' },
      ];
      expect(
        selectRuntimeModel({
          provider: 'codex',
          models: codexModels,
          requestedModel: 'gpt-5.6-terra',
        }).id,
      ).toBe('gpt-5.6-terra');
      expect(() =>
        selectRuntimeModel({
          provider: 'codex',
          models: codexModels,
          requestedModel: 'gpt-4o',
        }),
      ).toThrow(RuntimeModelUnavailableError);
      expect(
        selectRuntimeModel({ provider: 'codex', models: codexModels }).id,
      ).toBe('gpt-5.6-terra');
    });
  });
});
