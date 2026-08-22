export interface CompatibilitySurfaceRecord {
  readonly symbol: string;
  readonly productionConsumers: readonly string[];
  readonly owner: string;
  readonly reason: string;
  readonly removeWhen: string;
}

export const compatibilitySurfaceRecords: readonly CompatibilitySurfaceRecord[] =
  [
    {
      symbol: 'RuntimeWorkspace',
      productionConsumers: [
        'src/infrastructure/postgres/postgres-runtime-workspace-repository.ts:PostgresRuntimeWorkspaceRepository',
      ],
      owner: 'application/runtime',
      reason:
        'The PostgreSQL runtime workspace repository exposes the established workspace result type.',
      removeWhen: 'The repository returns ExecutionWorkspaceState directly.',
    },
    {
      symbol: 'Workspace',
      productionConsumers: [
        'src/infrastructure/postgres/postgres-session-repository.ts:PostgresSessionRepository',
      ],
      owner: 'application/sessions',
      reason:
        'The PostgreSQL session repository exposes the established workspace result type.',
      removeWhen: 'The repository returns ProductWorkspace directly.',
    },
  ];
