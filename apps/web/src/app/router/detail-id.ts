const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/iu;
const AGENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type DetailResource = 'agent' | 'board' | 'task' | 'work';

export function isValidDetailId(
  resource: DetailResource,
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  return (resource === 'agent' ? AGENT_ID_PATTERN : UUID_PATTERN).test(id);
}
