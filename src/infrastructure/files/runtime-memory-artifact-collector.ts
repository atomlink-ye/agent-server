import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import type {
  RuntimeMemoryCandidate,
  RuntimeMemoryCandidateCollector,
  RuntimeMemoryCandidateSession,
} from '../../application/ports/runtime-memory-candidate-collector.js';

const MEMORY_ARTIFACT_MAX_BYTES = 64 * 1024;
const MEMORY_ARTIFACT_MAX_PROPOSALS = 64;
const MEMORY_CONTENT_MAX_CHARS = 4096;
const MEMORY_CATEGORIES = new Set([
  'terminology',
  'output_preference',
  'project_constraint',
  'confirmed_workflow_procedure',
]);

export class RuntimeMemoryArtifactError extends Error {
  public constructor(message = 'Invalid memory proposal artifact.') {
    super(message);
    this.name = 'RuntimeMemoryArtifactError';
  }
}

export class LocalRuntimeMemoryCandidateCollector
  implements RuntimeMemoryCandidateCollector
{
  public async prepare(input: {
    readonly runId: string;
    readonly cwd: string;
    readonly proposalLimit: number;
  }): Promise<RuntimeMemoryCandidateSession> {
    if (input.proposalLimit <= 0) return NOOP_SESSION;
    const relativePath = join(
      'scratchpad',
      'runs',
      input.runId,
      'memory-proposals.json',
    );
    const artifact = await prepareArtifactPath(relativePath, input.cwd);
    await clearArtifact(artifact, input.cwd);
    return {
      decoratePrompt(prompt) {
        return `${prompt}\n\n${memoryArtifactInstruction(relativePath)}`;
      },
      collect: () => readMemoryCandidates(artifact, input.cwd),
    };
  }
}

const NOOP_SESSION: RuntimeMemoryCandidateSession = {
  decoratePrompt: (prompt) => prompt,
  collect: async () => [],
};

async function clearArtifact(path: string, cwd: string): Promise<void> {
  await assertSafePath(path, resolve(cwd, 'scratchpad'));
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function readMemoryCandidates(
  path: string,
  cwd: string,
): Promise<readonly RuntimeMemoryCandidate[]> {
  await assertSafePath(path, resolve(cwd, 'scratchpad'));
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new RuntimeMemoryArtifactError(
      'Unable to inspect memory proposal artifact.',
    );
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new RuntimeMemoryArtifactError();
    const buffer = Buffer.alloc(MEMORY_ARTIFACT_MAX_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, null);
      offset += read.bytesRead;
      if (read.bytesRead === 0) break;
    }
    if (offset > MEMORY_ARTIFACT_MAX_BYTES)
      throw new RuntimeMemoryArtifactError();
    const parsed: unknown = JSON.parse(buffer.subarray(0, offset).toString('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Object.keys(parsed).length !== 1 ||
      !('proposals' in parsed) ||
      !Array.isArray(parsed.proposals) ||
      parsed.proposals.length > MEMORY_ARTIFACT_MAX_PROPOSALS
    )
      throw new RuntimeMemoryArtifactError();
    return parsed.proposals.map((proposal): RuntimeMemoryCandidate => {
      if (
        !proposal ||
        typeof proposal !== 'object' ||
        Object.keys(proposal).some(
          (key) => key !== 'category' && key !== 'content',
        )
      )
        throw new RuntimeMemoryArtifactError();
      const candidate = proposal as { category?: unknown; content?: unknown };
      if (
        typeof candidate.category !== 'string' ||
        !MEMORY_CATEGORIES.has(candidate.category) ||
        typeof candidate.content !== 'string' ||
        candidate.content.trim() === '' ||
        candidate.content.length > MEMORY_CONTENT_MAX_CHARS
      )
        throw new RuntimeMemoryArtifactError();
      return {
        category: candidate.category as RuntimeMemoryCandidate['category'],
        content: candidate.content,
      };
    });
  } catch (error) {
    if (error instanceof RuntimeMemoryArtifactError) throw error;
    throw new RuntimeMemoryArtifactError();
  } finally {
    await handle.close();
  }
}

async function prepareArtifactPath(
  relativePath: string,
  cwd: string,
): Promise<string> {
  const scratchRoot = resolve(cwd, 'scratchpad');
  await assertSafePath(scratchRoot, scratchRoot);
  await mkdir(scratchRoot, { recursive: true });
  const runDirectory = dirname(resolve(cwd, relativePath));
  await assertSafePath(runDirectory, scratchRoot);
  await mkdir(runDirectory, { recursive: true });
  const absolute = resolve(cwd, relativePath);
  await assertSafePath(absolute, scratchRoot);
  return absolute;
}

async function assertSafePath(
  path: string,
  configuredRoot: string,
): Promise<void> {
  const root = resolve(configuredRoot);
  const candidate = resolve(path);
  const lexicalRelative = relative(root, candidate);
  if (
    lexicalRelative.startsWith('..') ||
    lexicalRelative.split('/').includes('..')
  )
    throw new RuntimeMemoryArtifactError(
      'Memory proposal artifact path is outside the runtime scratch root.',
    );
  await rejectSymlinkIfPresent(root, true);
  let current = root;
  for (const part of lexicalRelative.split('/').filter(Boolean)) {
    current = join(current, part);
    await rejectSymlinkIfPresent(current, current === candidate);
  }
}

async function rejectSymlinkIfPresent(
  path: string,
  existingRequired: boolean,
): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new RuntimeMemoryArtifactError(
        existingRequired
          ? 'Invalid memory proposal artifact path: the runtime scratch root or its ancestor is a symbolic link (symbolic-link ancestor).'
          : 'Memory proposal artifact path contains a symbolic-link ancestor (symbolic link).',
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

function memoryArtifactInstruction(relativePath: string): string {
  return [
    'Internal runtime artifact contract (server-controlled; do not mention host paths):',
    `Write proposals only to the exact relative path ${JSON.stringify(relativePath)}.`,
    'The complete JSON value must match exactly {"proposals":[{"category":string,"content":string}]} with no additional properties.',
    'Allowed category values: terminology, output_preference, project_constraint, confirmed_workflow_procedure.',
    `Maximum proposals: ${MEMORY_ARTIFACT_MAX_PROPOSALS}; maximum content length: ${MEMORY_CONTENT_MAX_CHARS} characters.`,
  ].join('\n');
}
