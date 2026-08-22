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
      symbol: 'LegacyAgentDefinitionProjection',
      productionConsumers: [
        'src/domain/invokables/agent-definition.ts:rehydrateLegacyAgentDefinitionProjection',
      ],
      owner: 'domain/invokables',
      reason:
        'Historical invokable records require a read-only projection during import.',
      removeWhen:
        'All persisted invokable records use the managed AgentDefinition shape.',
    },
    {
      symbol: 'LegacyAgentDefinitionSnapshot',
      productionConsumers: [
        'src/domain/invokables/agent-definition.ts:rehydrateLegacyAgentDefinitionProjection',
      ],
      owner: 'domain/invokables',
      reason:
        'Historical invokable snapshots are decoded through the legacy projection.',
      removeWhen:
        'All persisted invokable records use the managed AgentDefinition shape.',
    },
    {
      symbol: 'createAgentDefinition',
      productionConsumers: [
        'src/domain/invokables/agent-definition.ts:rehydrateLegacyAgentDefinitionProjection',
      ],
      owner: 'domain/invokables',
      reason:
        'Invokable records are constructed through the legacy projection boundary.',
      removeWhen:
        'All callers construct managed AgentDefinition records directly.',
    },
    {
      symbol: 'rehydrateAgentDefinition',
      productionConsumers: [
        'src/domain/invokables/agent-definition.ts:rehydrateLegacyAgentDefinitionProjection',
      ],
      owner: 'domain/invokables',
      reason:
        'Invokable snapshots are decoded through the legacy projection boundary.',
      removeWhen:
        'All persisted invokable records use the managed AgentDefinition shape.',
    },
    {
      symbol: 'LegacyPostgresAgentHomeRepository',
      productionConsumers: [
        'src/infrastructure/postgres/postgres-agent-home-repository.ts:PostgresAgentHomeRepository',
      ],
      owner: 'infrastructure/postgres',
      reason:
        'Existing agent-home rows remain readable during the datastore cutover.',
      removeWhen: 'The agent-home cutover has removed all legacy rows.',
    },
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
