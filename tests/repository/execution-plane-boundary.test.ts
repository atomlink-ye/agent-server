import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(root = 'src'): Promise<string[]> {
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

describe('Execution Plane architecture boundary', () => {
  it('keeps the retired giant adapter and provider binding API out of source', async () => {
    const files = await sourceFiles();
    const corpus = (
      await Promise.all(files.map(async (path) => readFile(path, 'utf8')))
    ).join('\n');
    expect(corpus).not.toContain('PaseoRuntimeAdapter');
    expect(corpus).not.toContain('findPaseoWorkspaceByTeamRun');
    expect(corpus).not.toContain('bindProvider(');
  });

  it('keeps the Paseo client port free of the pinned SDK implementation', async () => {
    const port = await readFile(
      'src/adapters/paseo/paseo-client-port.ts',
      'utf8',
    );
    expect(port).not.toContain('@getpaseo/client');
    expect(port).not.toContain('class PaseoSdkClient');
  });

  it('allows AgentRuntime compatibility only inside its retired contract file', async () => {
    const files = (await sourceFiles()).filter(
      (path) =>
        relative('.', path).replaceAll('\\', '/') !==
        'src/application/ports/agent-runtime.ts',
    );
    const offenders: string[] = [];
    for (const path of files) {
      const source = await readFile(path, 'utf8');
      if (source.includes("ports/agent-runtime.js")) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps provider-native adapters out of Agent Server', async () => {
    const files = await sourceFiles();
    const offenders: string[] = [];
    for (const path of files) {
      const source = await readFile(path, 'utf8');
      if (/class\s+(?:Claude|Codex|OpenCode)\w*Adapter\b/u.test(source))
        offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
