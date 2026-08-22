import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceFilePattern = /\.(?:ts|tsx|mts|cts)$/u;
const legacyAgentModules = new Set([
  'src/domain/invokables/agent-definition.ts',
  'src/domain/invokables/agent-version.ts',
]);
// Only a legacy projection module itself may reference its own path. Entries for
// modules that no longer exist are removed with them: a deleted path left here
// would let the duplicate model return at that exact path while this guard
// stayed green.
const allowedLegacyReaders = new Set(['src/domain/invokables/agent-definition.ts']);
const importSpecifier = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu;

/**
 * Resolve every import specifier against the importing file so that a relative
 * specifier such as './agent-definition.js' is judged by what it actually
 * targets. Matching raw substrings would miss exactly the sibling-relative
 * import a restored duplicate model would use.
 */
function importsLegacyAgentModule(path: string, source: string): boolean {
  const fromDirectory = dirname(path);
  for (const match of source.matchAll(importSpecifier)) {
    const specifier = match[1];
    if (!specifier) continue;
    const target = specifier.startsWith('.')
      ? join(fromDirectory, specifier)
      : specifier;
    const normalized = target.replace(/\.js$/u, '.ts');
    for (const legacy of legacyAgentModules)
      if (normalized === legacy || normalized === legacy.replace(/\.ts$/u, ''))
        return true;
  }
  return false;
}

function productionSources(): string[] {
  return execFileSync('git', ['ls-files', 'src'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((path) => sourceFilePattern.test(path))
    .filter((path) => !path.includes('.test.'));
}

describe('canonical Agent identity boundary', () => {
  it('keeps legacy Agent projections out of normal production modules', () => {
    const violations: string[] = [];
    for (const path of productionSources()) {
      if (allowedLegacyReaders.has(path)) continue;
      const source = readFileSync(resolve(root, path), 'utf8');
      if (importsLegacyAgentModule(path, source)) violations.push(path);
    }
    expect(violations).toEqual([]);
  });

  it('keeps InvokableRepository and its Postgres adapter Agent-free', () => {
    const port = readFileSync(
      resolve(root, 'src/application/ports/invokable-repository.ts'),
      'utf8',
    );
    const postgres = readFileSync(
      resolve(root, 'src/infrastructure/postgres/postgres-invokable-repository.ts'),
      'utf8',
    );
    for (const source of [port, postgres]) {
      expect(source).not.toMatch(/\bsaveAgent(?:Definition|Version)\b/u);
      expect(source).not.toMatch(/\bfindAgent(?:Definition|Version)ById\b/u);
      expect(source).not.toMatch(/\bfindPublishedAgentVersionById\b/u);
    }
  });

  it('requires machine-readable Agent identity in the scripted runtime', () => {
    const source = readFileSync(
      resolve(root, 'src/adapters/runtime/scripted-execution-plane.ts'),
      'utf8',
    );
    expect(source).toContain('spec.invocationContext?.agentDefinitionId');
    expect(source).not.toContain('Agent definition ID:');
    expect(source).not.toContain('exec(spec.systemPrompt)');
  });

  it('creates Golden Path Agents through the managed Agent application path', () => {
    const source = readFileSync(
      resolve(root, 'tests/harness/seed/agent.ts'),
      'utf8',
    );
    expect(source).toContain('importAgent');
    expect(source).toContain('publishAgentVersion');
    expect(source).toContain('PostgresAgentRegistry');
    expect(source).not.toMatch(/INSERT\s+INTO\s+agent_definitions/iu);
    expect(source).not.toMatch(/INSERT\s+INTO\s+agent_versions/iu);
  });

  it('requires an explicit AgentResolutionApi when constructing InvokeTask', () => {
    const source = readFileSync(
      resolve(root, 'src/application/tasks/invoke-task.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /private readonly resolver: AgentResolutionApi(?!\s*=)/u,
    );
    expect(source).not.toMatch(/legacyFixtureResolver/u);
  });
});
