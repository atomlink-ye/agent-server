import { createHash } from 'node:crypto';

export interface RootTaskRunRequest {
  readonly prompt: string;
}

const ROOT_TASK_INPUT_SNAPSHOT_PREFIX = 'inline:run-request:';

export function normalizeRootTaskRunRequest(
  input: RootTaskRunRequest,
): RootTaskRunRequest {
  return {
    prompt: input.prompt.trim(),
  };
}

export function fingerprintRootTaskRunRequest(
  input: RootTaskRunRequest,
): string {
  return `sha256:${createHash('sha256')
    .update(serializeRootTaskRunRequest(input))
    .digest('hex')}`;
}

export function encodeRootTaskRunRequestSnapshotRef(
  input: RootTaskRunRequest,
): string {
  return `${ROOT_TASK_INPUT_SNAPSHOT_PREFIX}${Buffer.from(
    serializeRootTaskRunRequest(input),
    'utf8',
  ).toString('base64url')}`;
}

export function decodeRootTaskRunRequestSnapshotRef(
  snapshotRef: string,
): RootTaskRunRequest {
  if (!snapshotRef.startsWith(ROOT_TASK_INPUT_SNAPSHOT_PREFIX)) {
    throw new Error('Unsupported root task input snapshot ref');
  }

  const encoded = snapshotRef.slice(ROOT_TASK_INPUT_SNAPSHOT_PREFIX.length);
  const parsed = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  ) as Partial<RootTaskRunRequest>;

  if (typeof parsed.prompt !== 'string') {
    throw new Error('Root task input snapshot must include a prompt');
  }

  return normalizeRootTaskRunRequest({ prompt: parsed.prompt });
}

function serializeRootTaskRunRequest(input: RootTaskRunRequest): string {
  return JSON.stringify(normalizeRootTaskRunRequest(input));
}
