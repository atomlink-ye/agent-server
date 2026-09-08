import { join } from 'node:path';

/**
 * One working directory per Agent, not one per deployment and not one per run.
 *
 * An Agent's files are part of who it is. It writes notes between wake-ups and
 * expects to find them on the next one, and the person who hired it expects
 * those files to be that Coworker's -- not a shared drawer every Coworker on
 * the server reaches into. A single configured directory gave every Agent the
 * same drawer: two Coworkers working at once saw, overwrote and cited each
 * other's files, and nothing in the product said they should.
 *
 * The Agent definition id is the identity that outlives runs, versions and
 * provider sessions, so it is what names the directory. The configured value
 * stays the root that holds them, which keeps one place to point at a volume
 * and one place the runtime prepares.
 *
 * A Computer names the execution namespace an Agent runs under (cloud, a
 * paired local machine, a VPS), so it sits above the per-Agent directory: a
 * null computerId is today's single shared runtime and resolves to a
 * `default` namespace, keeping the directory shape ready for real multi-machine
 * placement without another path migration.
 *
 * A Work is a separate piece of Agent work, so its optional directory lives
 * below that Agent identity. Leaving it absent deliberately preserves the
 * established chat directory exactly; adding Work placement never moves or
 * hides the Agent's existing files.
 */
export function agentWorkspaceCwd(
  root: string,
  agentDefinitionId: string,
  computerId: string | null,
  workId?: string,
): string {
  if (!isSafeDirectorySegment(agentDefinitionId))
    throw new Error('agent_workspace_cwd_identity_invalid');
  const computerSegment = computerId ?? 'default';
  if (!isSafeDirectorySegment(computerSegment))
    throw new Error('agent_workspace_cwd_identity_invalid');
  if (workId !== undefined && !isSafeDirectorySegment(workId))
    throw new Error('agent_workspace_cwd_identity_invalid');
  return workId === undefined
    ? join(root, computerSegment, agentDefinitionId)
    : join(root, computerSegment, agentDefinitionId, 'works', workId);
}

/**
 * The id reaches a filesystem path, so it is checked as one rather than
 * trusted for being internal. Agent definition ids are UUIDs; anything that is
 * not a plain single path segment is refused instead of escaped, because there
 * is no legitimate Agent whose directory needs to be anywhere but under the
 * root.
 */
function isSafeDirectorySegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && value !== '..';
}
