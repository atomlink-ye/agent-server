import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? cssFiles(path)
      : entry.name.endsWith('.css')
        ? [path]
        : [];
  });
}

it('keeps every CSS font size on the CJK-safe scale, including font shorthands', () => {
  const violations: string[] = [];
  for (const path of cssFiles(sourceRoot)) {
    const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(
      /(?:^|[;{])\s*(font-size|font)\s*:\s*([^;}]+)/g,
    )) {
      const value = match[2]!.trim();
      if (value === 'inherit') continue;
      if (
        match[1] === 'font-size' &&
        /^var\(--text-[\w-]+\)(?:\s*!important)?$/.test(value)
      )
        continue;
      if (
        match[1] === 'font' &&
        value.startsWith('var(--text-') &&
        !/\d+(?:px|rem|em|%)/.test(value)
      )
        continue;
      violations.push(
        `${path.slice(sourceRoot.length + 1)}: ${match[1]}: ${value}`,
      );
    }
  }
  expect(violations).toEqual([]);
});

it('pins the minimum size and the compact, body, and heading scale', () => {
  const css = readFileSync(join(sourceRoot, 'index.css'), 'utf8');
  const tokens = Object.fromEntries(
    [...css.matchAll(/(--text-[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  expect(tokens).toEqual({
    '--text-eyebrow': 'var(--text-xs)',
    '--text-xs': '12px',
    '--text-sm': 'var(--text-xs)',
    '--text-md': '13px',
    '--text-lg': '14px',
    '--text-heading': '16px',
    '--text-title': '20px',
    '--text-display': '24px',
  });
});

it('centralizes leading so dense CJK text cannot regain a local cramped line height', () => {
  const violations: string[] = [];
  for (const path of cssFiles(sourceRoot)) {
    const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(
      /(?:^|[;{])\s*line-height\s*:\s*([^;}]+)/g,
    )) {
      if (!/^var\(--leading-[\w-]+\)$/.test(match[1]!.trim())) {
        violations.push(`${path.slice(sourceRoot.length + 1)}: ${match[1]}`);
      }
    }
  }
  expect(violations).toEqual([]);
});

it('pins readable line-height tokens separately from symbol alignment', () => {
  const css = readFileSync(join(sourceRoot, 'index.css'), 'utf8');
  const tokens = Object.fromEntries(
    [...css.matchAll(/(--leading-[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  expect(tokens).toEqual({
    '--leading-tight': '1.35',
    '--leading-ui': '1.5',
    '--leading-body': '1.6',
    '--leading-code': '1.65',
    '--leading-icon': '1',
    '--leading-icon-tight': '0.7',
    '--leading-control': '24px',
  });
});
