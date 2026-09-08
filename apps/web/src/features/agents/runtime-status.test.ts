import { expect, it } from 'vitest';

import { translate } from '../../i18n';
import { STATUS_FILTERS, runtimeStatusLabel } from './runtime-status';

it('gives all four roster filters distinct labels in every shipped locale', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    const labels = STATUS_FILTERS.map((status) =>
      runtimeStatusLabel((key, vars) => translate(locale, key, vars), status),
    );

    expect(labels).toHaveLength(4);
    expect(new Set(labels)).toHaveLength(4);
  }
});
