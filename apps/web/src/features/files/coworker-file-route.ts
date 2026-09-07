import { isValidDetailId } from '../../app/router/detail-id';

export type CoworkerFileScope = 'agent' | 'agent_user';

export type CoworkerFileRoute = Readonly<{
  scope: CoworkerFileScope;
  agentDefinitionId: string;
  path: string | null;
}>;

/** Encodes the Files view for one Coworker's shared or private Chat context. */
export function coworkerFilePath(
  scope: CoworkerFileScope,
  agentDefinitionId: string,
  path: string | null = null,
): string {
  const query = new URLSearchParams({
    scope,
    agent_definition_id: agentDefinitionId,
  });
  if (path) query.set('path', path);
  return `/files?${query.toString()}`;
}

/**
 * Reads a valid Coworker Context files route. Work file routes intentionally
 * return null here so their existing result-file handling stays authoritative.
 */
export function parseCoworkerFileRoute(
  search: string,
): CoworkerFileRoute | null {
  const query = new URLSearchParams(search);
  const scope = query.get('scope');
  const agentDefinitionId = query.get('agent_definition_id');
  if (
    (scope !== 'agent' && scope !== 'agent_user') ||
    !agentDefinitionId ||
    !isValidDetailId('agent', agentDefinitionId)
  ) {
    return null;
  }
  return { scope, agentDefinitionId, path: query.get('path') };
}

/** True when a URL asks for a Coworker Files scope, even if it is malformed. */
export function hasCoworkerFileScopeQuery(search: string): boolean {
  const scope = new URLSearchParams(search).get('scope');
  return scope === 'agent' || scope === 'agent_user';
}
