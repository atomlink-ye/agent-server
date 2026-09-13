import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
function cssFiles(): string[] {
  return authoredFiles()
    .filter((file) => file.path.endsWith('.css'))
    .map((file) => join(dirname(sourceRoot), file.path));
}

it('keeps every CSS font size on the CJK-safe scale, including font shorthands', () => {
  const violations: string[] = [];
  for (const path of cssFiles()) {
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

// Include HTML, SVG, inline React styles, fixtures, and configuration outside src.
// Git's authored-file inventory excludes installed dependencies and generated output,
// and includes new files before they have been staged.
function authoredFiles() {
  const appRoot = dirname(sourceRoot);
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '.'],
    { cwd: appRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .map((path) => ({ path, text: readFileSync(join(appRoot, path), 'utf8') }));
}

function rawSizes(text: string) {
  return [
    ...text.matchAll(
      /(?:\b(?:font-size|fontSize|font)|["'](?:font-size|fontSize|font)["'])\s*[:=]\s*([^;\n}]+)/gi,
    ),
  ]
    .filter((match) =>
      /(?:^\s*["'`{]?\s*[+-]?(?:\d*\.)?\d+)|(?:\d(?:px|rem|em|%|pt|vw|vh|vmin|vmax|ch|ex)(?![\w-]))/i.test(
        match[1]!,
      ),
    )
    .map((match) => match[0]);
}

it('audits the complete authored apps/web tree with positive controls before claiming zero raw sizes', () => {
  const files = authoredFiles();
  // Known-true production symbol proves the inventory reaches the UI stylesheet.
  expect(
    files.some(
      (file) =>
        file.path === 'src/index.css' &&
        file.text.includes('font-size: var(--text-title)'),
    ),
  ).toBe(true);
  // Known violations prove the detector handles CSS, HTML/SVG, and React numbers.
  const property = 'font' + '-size';
  expect(
    rawSizes(
      `${property}: 9px; ${property}="10"; font${'Size'}: 11; "${property}": '0.85em'; "font${'Size'}": ${12}`,
    ),
  ).toHaveLength(5);
  const violations = files.flatMap((file) =>
    rawSizes(file.text).map((value) => `${file.path}: ${value}`),
  );
  expect(
    rawSizes(
      `${property}: clamp(0.75rem, 2vw, 20px); ${'font'}: bold ${12}px/1.5 sans-serif`,
    ),
  ).toHaveLength(2);
  const declarations = files
    .filter((file) => file.path.endsWith('.css'))
    .reduce(
      (count, file) =>
        count + [...file.text.matchAll(/\bfont-size\s*:/g)].length,
      0,
    );
  console.info(
    JSON.stringify({
      authoredFiles: files.length,
      fontSizeDeclarations: declarations,
      rawSizeDeclarations: violations.length,
    }),
  );
  expect(violations).toEqual([]);
});

it('pins the minimum size and the compact, body, and heading scale', () => {
  const css = readFileSync(join(sourceRoot, 'index.css'), 'utf8');
  const root = css.match(/:root\s*{([\s\S]*?)\n}/)?.[1] ?? '';
  const tokens = Object.fromEntries(
    [...root.matchAll(/(--text-[\w-]+):\s*([^;]+);/g)].map((match) => [
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

it('uses a smaller, more open shared type scale for zh-CN', () => {
  const css = readFileSync(join(sourceRoot, 'index.css'), 'utf8');
  const cjk =
    css.match(/:root:lang\(zh-CN\) \.work-main\s*{([\s\S]*?)\n}/)?.[1] ?? '';
  const tokens = Object.fromEntries(
    [...cjk.matchAll(/(--(?:text|leading)-[\w-]+):\s*([^;]+);/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  expect(tokens).toEqual({
    '--text-md': '12px',
    '--text-lg': '13px',
    '--text-heading': '15px',
    '--text-title': '18px',
    '--text-display': '22px',
    '--leading-tight': '1.5',
    '--leading-body': '1.75',
  });
});

it('centralizes leading so dense CJK text cannot regain a local cramped line height', () => {
  const violations: string[] = [];
  for (const path of cssFiles()) {
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
  const root = css.match(/:root\s*{([\s\S]*?)\n}/)?.[1] ?? '';
  const tokens = Object.fromEntries(
    [...root.matchAll(/(--leading-[\w-]+):\s*([^;]+);/g)].map((match) => [
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
