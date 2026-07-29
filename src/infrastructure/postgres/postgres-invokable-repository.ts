import type {
  InvokableOwnerScope,
  InvokableRepository,
} from '../../application/ports/invokable-repository.js';
import { InvokableVersionImmutableError } from '../../application/ports/invokable-repository.js';
import {
  rehydrateAgentDefinition,
  type AgentDefinition,
} from '../../domain/invokables/agent-definition.js';
import {
  rehydrateAgentVersion,
  type AgentVersion,
} from '../../domain/invokables/agent-version.js';
import {
  createCompiledDagTeamPlan,
  createCompiledSequentialTeamPlan,
  type CompiledSequentialTeamPlan,
  type CompiledSequentialTeamStep,
  type CompiledTeamPlan,
} from '../../domain/invokables/compiled-team-plan.js';
import {
  rehydrateTeamDefinition,
  type TeamDefinition,
} from '../../domain/invokables/team-definition.js';
import {
  rehydrateTeamVersion,
  type TeamVersion,
} from '../../domain/invokables/team-version.js';
import { type TeamGraph } from '../../domain/invokables/team-graph.js';

interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

interface DefinitionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

interface AgentVersionRow extends DefinitionRow {
  readonly definition_id: string;
  readonly status: AgentVersion['status'];
  readonly instructions: string;
  readonly published_at: string | Date | null;
}

interface TeamVersionRow extends DefinitionRow {
  readonly definition_id: string;
  readonly status: TeamVersion['status'];
  readonly graph: TeamGraph;
  readonly published_at: string | Date | null;
  readonly environment_version_id: string | null;
}

interface CompiledPlanRow {
  readonly team_version_id: string;
  readonly compiler_version: string;
  readonly entry_node_id: string;
  readonly final_output_node_id: string;
  readonly compiled_at: string | Date;
  readonly steps: CompiledSequentialTeamStep[] | unknown[];
  readonly environment_version_id: string | null;
}

export class PostgresInvokableRepository implements InvokableRepository {
  public constructor(private readonly database: PostgresQueryable) {}

  public async saveAgentDefinition(definition: AgentDefinition): Promise<void> {
    await this.database.query(
      `
        INSERT INTO agent_definitions (
          id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          name,
          description,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        ON CONFLICT (id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          workspace_id = EXCLUDED.workspace_id,
          principal_type = EXCLUDED.principal_type,
          principal_id = EXCLUDED.principal_id,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      definitionValues(definition),
    );
  }

  public async findAgentDefinitionById(
    id: string,
  ): Promise<AgentDefinition | null> {
    const result = await this.database.query<DefinitionRow>(
      `
        SELECT
          id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          name,
          description,
          created_at,
          updated_at
        FROM agent_definitions
        WHERE id = $1
      `,
      [id],
    );

    const row = result.rows?.[0];
    return row ? mapDefinitionRow(row, rehydrateAgentDefinition) : null;
  }

  public async saveAgentVersion(version: AgentVersion): Promise<void> {
    const existing = await this.findAgentVersionById(version.id);
    if (
      existing?.status === 'published' &&
      JSON.stringify(existing) !== JSON.stringify(version)
    ) {
      throw new InvokableVersionImmutableError();
    }

    await this.database.query(
      `
        INSERT INTO agent_versions (
          id,
          definition_id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          status,
          name,
          description,
          instructions,
          created_at,
          updated_at,
          published_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        ON CONFLICT (id) DO UPDATE SET
          definition_id = EXCLUDED.definition_id,
          tenant_id = EXCLUDED.tenant_id,
          workspace_id = EXCLUDED.workspace_id,
          principal_type = EXCLUDED.principal_type,
          principal_id = EXCLUDED.principal_id,
          status = EXCLUDED.status,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          instructions = EXCLUDED.instructions,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          published_at = EXCLUDED.published_at
      `,
      agentVersionValues(version),
    );
  }

  public async findAgentVersionById(id: string): Promise<AgentVersion | null> {
    const result = await this.database.query<AgentVersionRow>(
      `
        SELECT
          id,
          definition_id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          status,
          name,
          description,
          instructions,
          created_at,
          updated_at,
          published_at
        FROM agent_versions
        WHERE id = $1
      `,
      [id],
    );

    const row = result.rows?.[0];
    return row ? mapAgentVersionRow(row) : null;
  }

  public async findPublishedAgentVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<AgentVersion | null> {
    const result = await this.database.query<AgentVersionRow>(
      `
        SELECT
          id,
          definition_id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          status,
          name,
          description,
          instructions,
          created_at,
          updated_at,
          published_at
        FROM agent_versions
        WHERE id = $1
          AND tenant_id = $2
          AND workspace_id = $3
          AND principal_type = $4
          AND principal_id = $5
          AND status = 'published'
      `,
      ownerScopeValues(id, ownerScope),
    );

    const row = result.rows?.[0];
    return row ? mapAgentVersionRow(row) : null;
  }

  public async saveTeamDefinition(definition: TeamDefinition): Promise<void> {
    await this.database.query(
      `
        INSERT INTO team_definitions (
          id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          name,
          description,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        ON CONFLICT (id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          workspace_id = EXCLUDED.workspace_id,
          principal_type = EXCLUDED.principal_type,
          principal_id = EXCLUDED.principal_id,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      definitionValues(definition),
    );
  }

  public async findTeamDefinitionById(
    id: string,
  ): Promise<TeamDefinition | null> {
    const result = await this.database.query<DefinitionRow>(
      `
        SELECT
          id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          name,
          description,
          created_at,
          updated_at
        FROM team_definitions
        WHERE id = $1
      `,
      [id],
    );

    const row = result.rows?.[0];
    return row ? mapDefinitionRow(row, rehydrateTeamDefinition) : null;
  }

  public async saveTeamVersion(version: TeamVersion): Promise<void> {
    const existing = await this.findTeamVersionById(version.id);
    if (
      existing?.status === 'published' &&
      JSON.stringify(existing) !== JSON.stringify(version)
    ) {
      throw new InvokableVersionImmutableError();
    }

    if (version.status === 'published') {
      const compiledPlan = version.compiledPlan;
      if (!compiledPlan) {
        throw new Error('Published team versions require a compiled plan');
      }

      await this.database.query(
        `
          WITH upserted_team_version AS (
            INSERT INTO team_versions (
              id,
              definition_id,
              tenant_id,
              workspace_id,
              principal_type,
              principal_id,
              status,
              name,
              description,
              graph,
              created_at,
              updated_at,
              published_at,
               environment_version_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14
            )
            ON CONFLICT (id) DO UPDATE SET
              definition_id = EXCLUDED.definition_id,
              tenant_id = EXCLUDED.tenant_id,
              workspace_id = EXCLUDED.workspace_id,
              principal_type = EXCLUDED.principal_type,
              principal_id = EXCLUDED.principal_id,
              status = EXCLUDED.status,
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              graph = EXCLUDED.graph,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              published_at = EXCLUDED.published_at,
               environment_version_id = EXCLUDED.environment_version_id
            RETURNING id
          )
          INSERT INTO compiled_team_plans (
            team_version_id,
            compiler_version,
            entry_node_id,
            final_output_node_id,
            compiled_at,
            steps,
             environment_version_id
          )
          SELECT
            upserted_team_version.id,
             $15,
             $16,
             $17,
             $18,
             $19::jsonb,
             $20
          FROM upserted_team_version
          ON CONFLICT (team_version_id) DO UPDATE SET
            compiler_version = EXCLUDED.compiler_version,
            entry_node_id = EXCLUDED.entry_node_id,
            final_output_node_id = EXCLUDED.final_output_node_id,
            compiled_at = EXCLUDED.compiled_at,
            steps = EXCLUDED.steps,
             environment_version_id = EXCLUDED.environment_version_id
        `,
        [
          ...teamVersionValues(version),
          compiledPlan.compilerVersion,
          'entryNodeId' in compiledPlan
            ? compiledPlan.entryNodeId
            : compiledPlan.nodes[0]!.nodeId,
          compiledPlan.finalOutputNodeId,
          compiledPlan.compiledAt,
          JSON.stringify(
            'steps' in compiledPlan ? compiledPlan.steps : compiledPlan.nodes,
          ),
          'environmentVersionId' in compiledPlan
            ? compiledPlan.environmentVersionId
            : null,
        ],
      );
      return;
    }

    await this.database.query(
      `
        INSERT INTO team_versions (
          id,
          definition_id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          status,
          name,
          description,
          graph,
          created_at,
          updated_at,
          published_at,
               environment_version_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14
        )
        ON CONFLICT (id) DO UPDATE SET
          definition_id = EXCLUDED.definition_id,
          tenant_id = EXCLUDED.tenant_id,
          workspace_id = EXCLUDED.workspace_id,
          principal_type = EXCLUDED.principal_type,
          principal_id = EXCLUDED.principal_id,
          status = EXCLUDED.status,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          graph = EXCLUDED.graph,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          published_at = EXCLUDED.published_at,
               environment_version_id = EXCLUDED.environment_version_id
      `,
      teamVersionValues(version),
    );
  }

  public async findTeamVersionById(id: string): Promise<TeamVersion | null> {
    return this.findTeamVersionBySql(
      `
        SELECT
          id,
          definition_id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          status,
          name,
          description,
          graph,
          created_at,
          updated_at,
          published_at
        FROM team_versions
        WHERE id = $1
      `,
      [id],
    );
  }

  public async findPublishedTeamVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<TeamVersion | null> {
    return this.findTeamVersionBySql(
      `
        SELECT
          id,
          definition_id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          status,
          name,
          description,
          graph,
          created_at,
          updated_at,
          published_at
        FROM team_versions
        WHERE id = $1
          AND tenant_id = $2
          AND workspace_id = $3
          AND principal_type = $4
          AND principal_id = $5
          AND status = 'published'
      `,
      ownerScopeValues(id, ownerScope),
    );
  }

  public async saveCompiledTeamPlan(plan: CompiledTeamPlan): Promise<void> {
    const existing = await this.findCompiledTeamPlanByVersionId(
      plan.teamVersionId,
    );
    if (existing && JSON.stringify(existing) !== JSON.stringify(plan)) {
      throw new InvokableVersionImmutableError();
    }

    const teamVersionStatus = await this.loadTeamVersionStatus(
      plan.teamVersionId,
    );
    if (teamVersionStatus !== 'published') {
      throw new Error(
        'Compiled team plans require a persisted published team version',
      );
    }

    await this.database.query(
      `
        INSERT INTO compiled_team_plans (
          team_version_id,
          compiler_version,
          entry_node_id,
          final_output_node_id,
          compiled_at,
          steps,
           environment_version_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7
        )
        ON CONFLICT (team_version_id) DO UPDATE SET
          compiler_version = EXCLUDED.compiler_version,
          entry_node_id = EXCLUDED.entry_node_id,
          final_output_node_id = EXCLUDED.final_output_node_id,
          compiled_at = EXCLUDED.compiled_at,
          steps = EXCLUDED.steps,
           environment_version_id = EXCLUDED.environment_version_id
      `,
      [
        plan.teamVersionId,
        plan.compilerVersion,
        'entryNodeId' in plan ? plan.entryNodeId : plan.nodes[0]!.nodeId,
        plan.finalOutputNodeId,
        plan.compiledAt,
        JSON.stringify('steps' in plan ? plan.steps : plan.nodes),
        'environmentVersionId' in plan ? plan.environmentVersionId : null,
      ],
    );
  }

  public async findCompiledTeamPlanByVersionId(
    teamVersionId: string,
  ): Promise<CompiledTeamPlan | null> {
    const result = await this.database.query<CompiledPlanRow>(
      `
        SELECT
          team_version_id,
          compiler_version,
          entry_node_id,
          final_output_node_id,
          compiled_at,
          steps,
           environment_version_id
        FROM compiled_team_plans
        WHERE team_version_id = $1
      `,
      [teamVersionId],
    );

    const row = result.rows?.[0];
    if (!row) return null;
    const environment = await this.database.query<{
      environment_version_id: string | null;
    }>(
      'SELECT environment_version_id FROM compiled_team_plans WHERE team_version_id = $1',
      [teamVersionId],
    );
    return mapCompiledPlanRow({
      ...row,
      environment_version_id:
        environment.rows?.[0]?.environment_version_id ?? null,
    });
  }

  private async findTeamVersionBySql(
    sql: string,
    values: readonly unknown[],
  ): Promise<TeamVersion | null> {
    const result = await this.database.query<TeamVersionRow>(sql, values);
    const row = result.rows?.[0];
    if (!row) {
      return null;
    }

    const environment = await this.database.query<{
      environment_version_id: string | null;
    }>('SELECT environment_version_id FROM team_versions WHERE id = $1', [
      row.id,
    ]);
    const compiledPlan = await this.findCompiledTeamPlanByVersionId(row.id);
    return mapTeamVersionRow(
      {
        ...row,
        environment_version_id:
          environment.rows?.[0]?.environment_version_id ?? null,
      },
      compiledPlan,
    );
  }

  private async loadTeamVersionStatus(
    id: string,
  ): Promise<TeamVersion['status'] | null> {
    const result = await this.database.query<Pick<TeamVersionRow, 'status'>>(
      `
        SELECT status
        FROM team_versions
        WHERE id = $1
      `,
      [id],
    );

    return result.rows?.[0]?.status ?? null;
  }
}

function definitionValues(
  definition: AgentDefinition | TeamDefinition,
): readonly unknown[] {
  return [
    definition.id,
    definition.tenantId,
    definition.workspaceId,
    definition.principalType,
    definition.principalId,
    definition.name,
    definition.description,
    definition.createdAt,
    definition.updatedAt,
  ];
}

function agentVersionValues(version: AgentVersion): readonly unknown[] {
  return [
    version.id,
    version.definitionId,
    version.tenantId,
    version.workspaceId,
    version.principalType,
    version.principalId,
    version.status,
    version.name,
    version.description,
    version.instructions,
    version.createdAt,
    version.updatedAt,
    version.publishedAt,
  ];
}

function teamVersionValues(version: TeamVersion): readonly unknown[] {
  return [
    version.id,
    version.definitionId,
    version.tenantId,
    version.workspaceId,
    version.principalType,
    version.principalId,
    version.status,
    version.name,
    version.description,
    JSON.stringify(version.graph),
    version.createdAt,
    version.updatedAt,
    version.publishedAt,
    version.environmentVersionId,
  ];
}

function ownerScopeValues(
  id: string,
  ownerScope: InvokableOwnerScope,
): readonly unknown[] {
  return [
    id,
    ownerScope.tenantId,
    ownerScope.workspaceId,
    ownerScope.principalType,
    ownerScope.principalId,
  ];
}

function mapDefinitionRow<T>(
  row: DefinitionRow,
  rehydrate: (snapshot: T) => T,
): T {
  return rehydrate({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    name: row.name,
    description: row.description,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
  } as T);
}

function mapAgentVersionRow(row: AgentVersionRow): AgentVersion {
  return rehydrateAgentVersion({
    id: row.id,
    definitionId: row.definition_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    status: row.status,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
    publishedAt: row.published_at ? toIsoInstant(row.published_at) : null,
  });
}

function mapTeamVersionRow(
  row: TeamVersionRow,
  compiledPlan: CompiledTeamPlan | null,
): TeamVersion {
  return rehydrateTeamVersion({
    id: row.id,
    definitionId: row.definition_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    status: row.status,
    name: row.name,
    description: row.description,
    graph: row.graph,
    environmentVersionId: row.environment_version_id ?? null,
    compiledPlan,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
    publishedAt: row.published_at ? toIsoInstant(row.published_at) : null,
  });
}

function mapCompiledPlanRow(row: CompiledPlanRow): CompiledTeamPlan {
  if (row.compiler_version === 'dag-mve-v1') {
    return createCompiledDagTeamPlan({
      compilerVersion: 'dag-mve-v1',
      teamVersionId: row.team_version_id,
      environmentVersionId: row.environment_version_id ?? '',
      finalOutputNodeId: row.final_output_node_id,
      compiledAt: toIsoInstant(row.compiled_at),
      nodes: row.steps as never,
    });
  }
  return createCompiledSequentialTeamPlan({
    compilerVersion:
      row.compiler_version as CompiledSequentialTeamPlan['compilerVersion'],
    teamVersionId: row.team_version_id,
    entryNodeId: row.entry_node_id,
    finalOutputNodeId: row.final_output_node_id,
    compiledAt: toIsoInstant(row.compiled_at),
    steps: row.steps as CompiledSequentialTeamStep[],
  });
}

function toIsoInstant(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
