export type LogicalRefKind =
  'tool-profile' | 'skill' | 'environment' | 'worker' | 'team' | 'memory';

export type LogicalRef<K extends LogicalRefKind = LogicalRefKind> =
  `${K}://${string}`;
export type ToolProfileRef = LogicalRef<'tool-profile'>;
export type SkillRef = LogicalRef<'skill'>;
export type EnvironmentRef = LogicalRef<'environment'>;
export type WorkerRef = LogicalRef<'worker'>;
export type TeamRef = LogicalRef<'team'>;
export type MemoryRef = LogicalRef<'memory'>;
export type WorkspaceRef = 'workspace://default';

export const logicalRef = <K extends LogicalRefKind>(
  kind: K,
  name: string,
): LogicalRef<K> => `${kind}://${name}` as LogicalRef<K>;

export function parseLogicalRef(value: string): LogicalRef {
  if (
    !/^(tool-profile|skill|environment|worker|team|memory):\/\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
      value,
    )
  )
    throw new Error('Invalid logical reference.');
  return value as LogicalRef;
}
