import type {
  Memory,
  MemoryStore,
} from '../../domain/memory-api/memory-api.js';
import type {
  ProjectControlPlane,
  PublishedResource,
  InvokedTeamTask,
  ProjectTask,
  ProjectTaskTree,
  ValidationResult,
  WorkspaceResource,
} from '../../application/projects/project-control-plane.js';
import {
  MAX_TASK_REQUEST_BYTES,
  GetTaskResponseSchema,
  GetTaskTreeResponseSchema,
  InvokeTaskResponseSchema,
} from '../../contracts/tasks.js';

export class AgentProjectHttpControlPlane implements ProjectControlPlane {
  private readonly root: string;
  public constructor(
    private readonly baseUrl: string,
    private readonly bearerToken: string,
    private readonly authenticatedWorkspaceId: string,
  ) {
    this.root = baseUrl.replace(/\/$/, '');
  }
  public getWorkspace() {
    return this.request<unknown>(
      `/api/v1/workspaces/${encodeURIComponent(this.authenticatedWorkspaceId)}`,
    )
      .then((r) => workspace(r, this.authenticatedWorkspaceId))
      .catch((e) => (isNotFound(e) ? null : Promise.reject(e)));
  }
  public invokeTeam(input: {
    versionId: string;
    input: string;
    idempotencyKey: string;
  }): Promise<InvokedTeamTask> {
    return this.request<unknown>(
      '/api/v1/tasks:invoke',
      'POST',
      {
        invokable: { kind: 'team', version_id: input.versionId },
        input: { text: input.input },
        workspace_id: this.authenticatedWorkspaceId,
      },
      input.idempotencyKey,
      true,
    ).then((value) => {
      const parsed = InvokeTaskResponseSchema.safeParse(value);
      if (!parsed.success) invalid();
      const body = parsed.data;
      const expected = `/api/v1/tasks/${body.task_id}`;
      if (
        body.links.self !== expected ||
        body.links.tree !== `${expected}/tree`
      )
        invalid();
      return { taskId: body.task_id, status: 'queued' };
    });
  }
  public getTask(taskId: string, signal?: AbortSignal): Promise<ProjectTask> {
    return this.request<unknown>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}`,
      'GET',
      undefined,
      undefined,
      false,
      signal,
    ).then((value) => {
      const parsed = GetTaskResponseSchema.safeParse(value);
      if (!parsed.success) invalid();
      return task(parsed.data);
    });
  }
  public getTaskTree(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<ProjectTaskTree> {
    return this.request<unknown>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/tree`,
      'GET',
      undefined,
      undefined,
      false,
      signal,
    ).then((value) => {
      const parsed = GetTaskTreeResponseSchema.safeParse(value);
      if (!parsed.success || parsed.data.root_task_id !== taskId) invalid();
      const ids = new Set<string>();
      const tasks = parsed.data.tasks.map((item) => {
        if (
          ids.has(item.task_id) ||
          item.root_task_id !== parsed.data.root_task_id
        )
          invalid();
        ids.add(item.task_id);
        return task(item);
      });
      if (!ids.has(taskId)) invalid();
      return { rootTaskId: parsed.data.root_task_id, tasks };
    });
  }
  public validateEnvironment(source: string) {
    return this.request<unknown>(
      '/api/v1/environment-packages:validate',
      'POST',
      { source },
    ).then(validation);
  }
  public importEnvironment(source: string, key: string) {
    return this.request<unknown>(
      '/api/v1/environments:import',
      'POST',
      { source },
      key,
    ).then(resource);
  }
  public publishEnvironment(versionId: string, key: string) {
    return this.request<unknown>(
      `/api/v1/environment-versions/${versionId}:publish`,
      'POST',
      {},
      key,
    ).then(resourceVersion);
  }
  public validateAgent(source: string) {
    return this.request<unknown>('/api/v1/agent-packages:validate', 'POST', {
      source,
    }).then(validation);
  }
  public importAgent(source: string, key: string) {
    return this.request<unknown>(
      '/api/v1/agents:import',
      'POST',
      { source },
      key,
    ).then(resource);
  }
  public publishAgent(versionId: string, key: string) {
    return this.request<unknown>(
      `/api/v1/agent-versions/${versionId}:publish`,
      'POST',
      {},
      key,
    ).then(resourceVersion);
  }
  public validateTeam(source: string) {
    return this.request<unknown>('/api/v1/team-packages:validate', 'POST', {
      source,
    }).then(validation);
  }
  public importTeam(source: string, key: string) {
    return this.request<unknown>(
      '/api/v1/teams:import',
      'POST',
      { source },
      key,
    ).then(resource);
  }
  public publishTeam(versionId: string, key: string) {
    return this.request<unknown>(
      `/api/v1/team-versions/${versionId}:publish`,
      'POST',
      {},
      key,
    ).then(resourceVersion);
  }
  public listMemoryStores(workspaceId: string) {
    return this.request<unknown>(
      `/api/v1/memory-stores?workspace_id=${encodeURIComponent(workspaceId)}`,
    ).then((r) => object(r, 'memory_stores', array).map(store));
  }
  public getMemoryStore(id: string) {
    return this.request<unknown>(`/api/v1/memory-stores/${id}`)
      .then((r) => store(field(r, 'memory_store')))
      .catch((e) => (isNotFound(e) ? null : Promise.reject(e)));
  }
  public createMemoryStore(input: {
    workspaceId: string;
    name: string;
    description?: string;
  }) {
    return this.request<unknown>('/api/v1/memory-stores', 'POST', {
      workspace_id: input.workspaceId,
      name: input.name,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
    }).then((r) => store(field(r, 'memory_store')));
  }
  public listMemories(storeId: string) {
    return this.request<unknown>(
      `/api/v1/memory-stores/${storeId}/memories`,
    ).then((r) => object(r, 'memories', array).map(memory));
  }
  public getMemory(storeId: string, memoryId: string) {
    return this.request<unknown>(
      `/api/v1/memory-stores/${storeId}/memories/${memoryId}`,
    )
      .then((r) => memory(field(r, 'memory')))
      .catch((e) => (isNotFound(e) ? null : Promise.reject(e)));
  }
  public createMemory(input: {
    storeId: string;
    path: string;
    content: string;
  }) {
    return this.request<unknown>(
      `/api/v1/memory-stores/${input.storeId}/memories`,
      'POST',
      { path: input.path, content: input.content },
    ).then((r) => memory(field(r, 'memory')));
  }
  public updateMemory(input: {
    storeId: string;
    memoryId: string;
    content: string;
    expectedSha256: string;
  }) {
    return this.request<unknown>(
      `/api/v1/memory-stores/${input.storeId}/memories/${input.memoryId}`,
      'POST',
      {
        content: input.content,
        precondition: {
          type: 'content_sha256',
          content_sha256: input.expectedSha256,
        },
      },
    ).then((r) => memory(field(r, 'memory')));
  }
  private async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    idempotencyKey?: string,
    enforceRequestLimit = false,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.bearerToken}`,
      accept: 'application/json',
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    let response: Response;
    let serializedBody: string | undefined;
    if (body !== undefined) {
      try {
        serializedBody = JSON.stringify(body);
      } catch {
        throw new Error('control_plane_invalid_request');
      }
      if (
        enforceRequestLimit &&
        Buffer.byteLength(serializedBody, 'utf8') > MAX_TASK_REQUEST_BYTES
      )
        throw new Error('control_plane_request_too_large');
    }
    try {
      response = await fetch(`${this.root}${path}`, {
        method,
        headers,
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      if (signal?.aborted) throw new Error('control_plane_timeout');
      throw new Error('control_plane_unavailable');
    }
    if (!response.ok) throw new AgentProjectHttpError(response.status);
    try {
      return (await response.json()) as T;
    } catch {
      if (signal?.aborted) throw new Error('control_plane_timeout');
      throw new Error('control_plane_invalid_response');
    }
  }
}
export { deterministicIdempotencyKey } from '../../domain/projects/agent-project-idempotency.js';
export class AgentProjectHttpError extends Error {
  public constructor(readonly status: number) {
    super(`control_plane_http_${status}`);
  }
}
function resource(value: unknown): PublishedResource {
  const body = record(value);
  const x = record(body.version ?? body.team ?? body.agent);
  return {
    definitionId: uuid(x.definition_id),
    versionId: uuid(x.id),
    ...(x.fingerprint === undefined ? {} : { fingerprint: sha(x.fingerprint) }),
    outcome: importOutcome(body.result),
    status: status(x.status ?? body.status),
  };
}
function task(value: unknown): ProjectTask {
  const x = record(value);
  const invokable = record(x.invokable);
  const latest = x.latest_run === null ? null : record(x.latest_run);
  const valueStatus = x.status;
  if (
    valueStatus !== 'queued' &&
    valueStatus !== 'active' &&
    valueStatus !== 'completed' &&
    valueStatus !== 'failed' &&
    valueStatus !== 'cancelled'
  )
    invalid();
  const kind = invokable.kind;
  if (kind !== 'agent' && kind !== 'team') invalid();
  return {
    taskId: uuid(x.task_id),
    status: valueStatus,
    invokable: { kind, versionId: uuid(invokable.version_id) },
    rootTaskId: uuid(x.root_task_id),
    latestRunId: latest === null ? null : uuid(latest.run_id),
  };
}
function resourceVersion(value: unknown): PublishedResource {
  const body = record(value);
  return {
    definitionId: uuid(body.definition_id),
    versionId: uuid(body.id),
    ...(body.fingerprint === undefined
      ? {}
      : { fingerprint: sha(body.fingerprint) }),
    status: status(body.status),
  };
}
function memory(value: unknown): Memory {
  const x = record(value);
  return {
    id: uuid(x.memory_id),
    storeId: uuid(x.memory_store_id),
    path: string(x.path),
    current: {
      id: uuid(x.memory_version_id),
      memoryId: uuid(x.memory_id),
      version: positiveInt(x.version),
      content: string(x.content),
      contentSha256: digest(x.content_sha256),
      contentSizeBytes: positiveInt(x.content_size_bytes),
      operation: 'modified',
      previousVersionId: null,
      createdAt: string(x.updated_at),
    },
    createdAt: string(x.created_at),
    updatedAt: string(x.updated_at),
  };
}
function store(value: unknown): MemoryStore {
  const x = record(value);
  return {
    id: uuid(x.memory_store_id),
    owner: {
      workspaceId: uuid(x.workspace_id),
      tenantId: '',
      principalType: '',
      principalId: '',
    },
    name: string(x.name),
    description: x.description === null ? null : string(x.description),
    createdAt: string(x.created_at),
    updatedAt: string(x.updated_at),
  };
}
function workspace(value: unknown, expectedId: string): WorkspaceResource {
  const x = record(value);
  const id = uuid(x.workspace_id);
  if (id !== expectedId) invalid();
  return { id, name: string(x.name) };
}
function validation(value: unknown): ValidationResult {
  return { fingerprint: sha(record(value).fingerprint) };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function field(value: unknown, name: string): unknown {
  const x = record(value)[name];
  if (x === undefined) invalid();
  return x;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}
function object(
  value: unknown,
  name: string,
  parser: (value: unknown) => unknown[],
): unknown[] {
  return parser(field(value, name));
}
function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) invalid();
  return value;
}
function uuid(value: unknown): string {
  const result = string(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  )
    invalid();
  return result;
}
function sha(value: unknown): string {
  const result = string(value);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) invalid();
  return result;
}
function digest(value: unknown): string {
  const result = string(value);
  if (!/^[0-9a-f]{64}$/.test(result)) invalid();
  return result;
}
function importOutcome(value: unknown): 'created' | 'converged' | 'replayed' {
  if (value === 'created' || value === 'converged' || value === 'replayed')
    return value;
  invalid();
}
function positiveInt(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) invalid();
  return value as number;
}
function status(value: unknown): 'draft' | 'published' {
  if (value !== 'draft' && value !== 'published') invalid();
  return value;
}
function invalid(): never {
  throw new Error('control_plane_invalid_response');
}
function isNotFound(error: unknown): error is AgentProjectHttpError {
  return error instanceof AgentProjectHttpError && error.status === 404;
}
