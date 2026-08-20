import { createHash } from 'node:crypto';
import type { AccessContext } from '../../platform/access-context.js';

export const MAX_AGENT_HOME_CONTENT_BYTES = 64 * 1024;
export const MAX_AGENT_HOME_PATH_LENGTH = 512;

export const AGENT_HOME_NAMESPACES = [
  'definition',
  'organization',
  'space',
  'agent-shared',
  'user',
  'conversation',
  'work',
  'scratch',
] as const;
export type AgentHomeNamespace = (typeof AGENT_HOME_NAMESPACES)[number];

export class InvalidAgentHomePathError extends Error {
  public readonly code = 'invalid_agent_home_path';
  public constructor() {
    super(
      'The agent home path must be a normalized relative POSIX path.',
    );
  }
}

export class InvalidAgentHomeContentError extends Error {
  public readonly code = 'invalid_agent_home_content';
  public constructor() {
    super(
      'Agent home content must be non-empty UTF-8 text no larger than 64 KiB.',
    );
  }
}

export class AgentHomeNamespaceReadOnlyError extends Error {
  public readonly code = 'namespace_read_only';
  public constructor() {
    super('The definition namespace is read-only.');
  }
}

export class AgentHomeScopeRequiredError extends Error {
  public readonly code = 'scope_required';
  public constructor(public readonly namespace: AgentHomeNamespace) {
    super(
      `The ${namespace} namespace requires a scope parameter.`,
    );
  }
}

export interface AgentHomeScopeParams {
  readonly workspaceId?: string;
  readonly conversationId?: string;
  readonly workId?: string;
  readonly runtimeSessionId?: string;
}

export function normalizeAgentHomePath(path: string): string {
  if (
    path.length === 0 ||
    path.length > MAX_AGENT_HOME_PATH_LENGTH ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/')
  )
    throw new InvalidAgentHomePathError();
  const segments = path.split('/');
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  )
    throw new InvalidAgentHomePathError();
  return segments.join('/');
}

export function validateAgentHomeContent(content: string): string {
  const size = Buffer.byteLength(content, 'utf8');
  if (
    size === 0 ||
    size > MAX_AGENT_HOME_CONTENT_BYTES ||
    content.includes('\0') ||
    hasUnpairedSurrogate(content)
  )
    throw new InvalidAgentHomeContentError();
  return content;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff)
        return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function resolveAgentHomeScopeKey(
  namespace: AgentHomeNamespace,
  accessContext: Pick<
    AccessContext,
    'tenantId' | 'workspaceId' | 'principalId'
  > & { readonly principalType: string },
  scopeParams: AgentHomeScopeParams,
  isWrite: boolean = false,
): string {
  if (namespace === 'definition') {
    if (isWrite) {
      throw new AgentHomeNamespaceReadOnlyError();
    }
    // Read path for definition doesn't need a scope key, it's computed
    return '';
  }

  if (namespace === 'organization') {
    return '';
  }

  if (namespace === 'space') {
    if (!scopeParams.workspaceId) {
      throw new AgentHomeScopeRequiredError(namespace);
    }
    return scopeParams.workspaceId;
  }

  if (namespace === 'agent-shared') {
    if (!scopeParams.workspaceId) {
      throw new AgentHomeScopeRequiredError(namespace);
    }
    return scopeParams.workspaceId;
  }

  if (namespace === 'user') {
    // User namespace always uses principalId from access context, ignoring any caller-supplied value
    return accessContext.principalId;
  }

  if (namespace === 'conversation') {
    if (!scopeParams.conversationId) {
      throw new AgentHomeScopeRequiredError(namespace);
    }
    return scopeParams.conversationId;
  }

  if (namespace === 'work') {
    if (!scopeParams.workId) {
      throw new AgentHomeScopeRequiredError(namespace);
    }
    return scopeParams.workId;
  }

  if (namespace === 'scratch') {
    if (!scopeParams.runtimeSessionId) {
      throw new AgentHomeScopeRequiredError(namespace);
    }
    return scopeParams.runtimeSessionId;
  }

  throw new Error(`Unknown namespace: ${namespace}`);
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function contentSizeBytes(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}
