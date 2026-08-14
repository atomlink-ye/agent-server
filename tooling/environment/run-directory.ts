import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { repositoryRoot } from './profiles.js';

export interface TestRunDirectory {
  readonly id: string;
  readonly path: string;
}

export async function createTestRunDirectory(): Promise<TestRunDirectory> {
  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const path = resolve(repositoryRoot, '.local/test-runs', id);
  await mkdir(path, { recursive: true });
  return { id, path };
}

export async function removeTestRunDirectory(
  run: TestRunDirectory,
): Promise<void> {
  await rm(run.path, { recursive: true, force: true });
}
