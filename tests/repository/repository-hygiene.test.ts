import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tracked = execFileSync('git', ['ls-files'], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

const forbiddenRoots = [
  '.local/',
  'artifacts/',
  'evidence/',
  'reports/',
  'docs/evidence/',
  'docs/exec-plans/',
  'docs/superpowers/',
  'scripts/ci/',
  'scripts/e2e/',
  'scripts/foundation/',
  'scripts/probes/',
  'scripts/record/',
];
const forbiddenExact = ['Makefile', 'docs/agents/exec-plan-protocol.md'];
const temporaryName =
  /(?:^|[-_.\/])(?:phase[-_a-z0-9]*|lane[-_a-z0-9]*|worker-[a-z0-9]+|n\d+)(?:[-_.\/]|$)/i;

describe('repository hygiene', () => {
  it('keeps generated evidence and task-run artifacts out of HEAD', () => {
    for (const path of forbiddenExact) expect(tracked).not.toContain(path);
    for (const prefix of forbiddenRoots) {
      expect(
        tracked.some(
          (path) => path === prefix.slice(0, -1) || path.startsWith(prefix),
        ),
        `tracked path under ${prefix}`,
      ).toBe(false);
    }
    expect(tracked.some((path) => path.endsWith('.log'))).toBe(false);
  });

  it('keeps temporary phase and lane names out of long-lived source paths', () => {
    const candidates = tracked.filter(
      (path) =>
        !path.startsWith('src/infrastructure/postgres/migrations/') &&
        !path.startsWith('docs/decisions/'),
    );
    expect(candidates.filter((path) => temporaryName.test(path))).toEqual([]);
  });

  it('keeps package commands semantic and pnpm-native', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const names = Object.keys(packageJson.scripts ?? {});
    for (const prefix of [
      'foundation:',
      'modularization:',
      'guard:',
      'record:',
      'probe:',
    ]) {
      expect(names.some((name) => name.startsWith(prefix))).toBe(false);
    }
    expect(
      names.some((name) => /(?:phase|worker-|lane-|\be\d+\b)/i.test(name)),
    ).toBe(false);
    expect(
      Object.values(packageJson.scripts ?? {}).some((command) =>
        /\bmake\b/.test(command),
      ),
    ).toBe(false);
  });

  it('uses one ignored location for generated test runs', () => {
    const ignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
    expect(ignore).toContain('.local/test-runs/');
    expect(tracked.some((path) => path.startsWith('.local/test-runs/'))).toBe(
      false,
    );
  });
});
