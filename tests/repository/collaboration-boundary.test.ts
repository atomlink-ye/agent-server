import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && entry.name.endsWith('.ts')) output.push(next);
    }
  }
  await walk(root);
  return output;
}

describe('Work Collaboration architecture boundary', () => {
  it('keeps collaboration semantics free of Paseo and provider identities', async () => {
    const files = [
      ...(await sourceFiles('src/domain/collaboration')),
      ...(await sourceFiles('src/application/collaboration')),
    ];
    const offenders: string[] = [];
    for (const path of files) {
      const source = await readFile(path, 'utf8');
      if (
        /adapters\/paseo|Paseo|providerAgentId|externalSessionId|RuntimeSessionBinding/u.test(
          source,
        )
      )
        offenders.push(relative('.', path).replaceAll('\\', '/'));
    }
    expect(offenders).toEqual([]);
  });

  it('keeps model-facing collaboration schemas free of control-plane identifiers', async () => {
    const source = await readFile(
      'src/adapters/collaboration-mcp/collaboration-mcp-tools.ts',
      'utf8',
    );
    for (const forbidden of [
      'tenant_id',
      'workspace_id',
      'principal_id',
      'team_run_id',
      'task_id',
      'run_id',
      'runtime_session',
      'provider_agent',
      'expected_revision',
      'command_hash',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
