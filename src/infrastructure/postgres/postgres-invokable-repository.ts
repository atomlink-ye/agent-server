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
  type TeamCollaborationSpec,
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
  readonly execution_mode: string;
  readonly collaboration_spec: unknown;
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

  public async importTeamVersionAtomically(input: {
    definition: TeamDefinition;
    version: TeamVersion;
    idempotencyKey: string;
    requestFingerprint: string;
  }) {
    return this.withTransaction(async (tx) => {
      const owner = ownerValuesForTeam(input.version);
      await tx.query(
        `INSERT INTO team_registry_idempotency(operation,tenant_id,workspace_id,principal_type,principal_id,idempotency_key,request_fingerprint,created_at,updated_at) VALUES('import',$1,$2,$3,$4,$5,$6,now(),now()) ON CONFLICT DO NOTHING`,
        [...owner, input.idempotencyKey, input.requestFingerprint],
      );
      const claim = await tx.query<any>(
        `SELECT request_fingerprint,definition_id,version_id FROM team_registry_idempotency WHERE operation='import' AND tenant_id=$1 AND workspace_id=$2 AND principal_type=$3 AND principal_id=$4 AND idempotency_key=$5 FOR UPDATE`,
        [...owner, input.idempotencyKey],
      );
      const row = claim.rows?.[0];
      if (row.request_fingerprint !== input.requestFingerprint)
        throw new Error('idempotency_conflict');
      const repo = new PostgresInvokableRepository(tx);
      if (row.definition_id && row.version_id) {
        const definition = await repo.findTeamDefinitionById(row.definition_id);
        const version = await repo.findTeamVersionById(row.version_id);
        if (definition && version)
          return { kind: 'replayed' as const, definition, version };
      }
      await repo.saveTeamDefinition(input.definition);
      await repo.saveTeamVersion(input.version);
      await tx.query(
        `UPDATE team_registry_idempotency SET definition_id=$1,version_id=$2,updated_at=now() WHERE operation='import' AND tenant_id=$3 AND workspace_id=$4 AND principal_type=$5 AND principal_id=$6 AND idempotency_key=$7`,
        [input.definition.id, input.version.id, ...owner, input.idempotencyKey],
      );
      return {
        kind: 'created' as const,
        definition: input.definition,
        version: input.version,
      };
    });
  }

  public async publishTeamVersionAtomically(input: {
    version: TeamVersion;
    idempotencyKey: string;
    requestFingerprint: string;
  }) {
    return this.withTransaction(async (tx) => {
      const owner = ownerValuesForTeam(input.version);
      await tx.query(
        `INSERT INTO team_registry_idempotency(operation,tenant_id,workspace_id,principal_type,principal_id,idempotency_key,request_fingerprint,created_at,updated_at) VALUES('publish',$1,$2,$3,$4,$5,$6,now(),now()) ON CONFLICT DO NOTHING`,
        [...owner, input.idempotencyKey, input.requestFingerprint],
      );
      const claim = await tx.query<any>(
        `SELECT request_fingerprint,version_id FROM team_registry_idempotency WHERE operation='publish' AND tenant_id=$1 AND workspace_id=$2 AND principal_type=$3 AND principal_id=$4 AND idempotency_key=$5 FOR UPDATE`,
        [...owner, input.idempotencyKey],
      );
      const row = claim.rows?.[0];
      if (row.request_fingerprint !== input.requestFingerprint)
        throw new Error('idempotency_conflict');
      const repo = new PostgresInvokableRepository(tx);
      if (row.version_id) {
        const existing = await repo.findTeamVersionById(row.version_id);
        if (existing) return existing;
      }
      await repo.saveTeamVersion(input.version);
      await tx.query(
        `UPDATE team_registry_idempotency SET version_id=$1,updated_at=now() WHERE operation='publish' AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5 AND idempotency_key=$6`,
        [input.version.id, ...owner, input.idempotencyKey],
      );
      return input.version;
    });
  }

  private async withTransaction<T>(
    work: (tx: PostgresQueryable) => Promise<T>,
  ): Promise<T> {
    const connectable = this.database as PostgresQueryable & {
      connect?: () => Promise<PostgresQueryable & { release(): void }>;
    };
    const tx = connectable.connect
      ? await connectable.connect()
      : this.database;
    await tx.query('BEGIN');
    try {
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      if ('release' in tx && typeof tx.release === 'function') tx.release();
    }
  }

  public async findTeamRegistryIdempotency(input: {
    operation: 'import' | 'publish';
    idempotencyKey: string;
    requestFingerprint: string;
    ownerScope: InvokableOwnerScope;
  }) {
    const r = await this.database.query<{
      request_fingerprint: string;
      definition_id: string | null;
      version_id: string | null;
    }>(
      `SELECT request_fingerprint,definition_id,version_id FROM team_registry_idempotency WHERE operation=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5 AND idempotency_key=$6`,
      [
        input.operation,
        ...ownerValuesForTeam(input.ownerScope),
        input.idempotencyKey,
      ],
    );
    const row = r.rows?.[0];
    if (!row) return { definitionId: null, versionId: null };
    if (row.request_fingerprint !== input.requestFingerprint)
      throw new Error('idempotency_conflict');
    return { definitionId: row.definition_id, versionId: row.version_id };
  }

  public async recordTeamRegistryIdempotency(input: {
    operation: 'import' | 'publish';
    idempotencyKey: string;
    requestFingerprint: string;
    definitionId?: string | null;
    versionId?: string | null;
    ownerScope: InvokableOwnerScope;
  }) {
    await this.database.query(
      `INSERT INTO team_registry_idempotency(operation,tenant_id,workspace_id,principal_type,principal_id,idempotency_key,request_fingerprint,definition_id,version_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now()) ON CONFLICT DO NOTHING`,
      [
        input.operation,
        ...ownerValuesForTeam(input.ownerScope),
        input.idempotencyKey,
        input.requestFingerprint,
        input.definitionId ?? null,
        input.versionId ?? null,
      ],
    );
    return this.findTeamRegistryIdempotency(input);
  }

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

  public async listTeamVersionsByDefinitionId(
    id: string,
    owner: InvokableOwnerScope,
    limit: number,
    cursor: string | null = null,
  ): Promise<{ items: TeamVersion[]; nextCursor: string | null }> {
    const result = await this.database.query<TeamVersionRow>(
      `SELECT id, definition_id, tenant_id, workspace_id, principal_type, principal_id, status, name, description, graph, execution_mode, collaboration_spec, environment_version_id, created_at, updated_at, published_at FROM team_versions WHERE definition_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5 ORDER BY created_at,id LIMIT $6`,
      [
        id,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
        limit + 1,
      ],
    );
    const rows = result.rows ?? [];
    const selected = rows.slice(0, limit);
    return {
      items: await Promise.all(
        selected.map(async (row) =>
          mapTeamVersionRow(
            row,
            await this.findCompiledTeamPlanByVersionId(row.id),
          ),
        ),
      ),
      nextCursor: rows.length > limit ? (selected.at(-1)?.id ?? null) : null,
    };
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
      if (version.executionMode === 'collaborative_mve') {
        // Collaborative versions do not have compiled plans.
        await this.database.query(
          `
            INSERT INTO team_versions (
              id, definition_id, tenant_id, workspace_id, principal_type, principal_id,
              status, name, description, graph, execution_mode, collaboration_spec,
              environment_version_id, created_at, updated_at, published_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16
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
              execution_mode = EXCLUDED.execution_mode,
              collaboration_spec = EXCLUDED.collaboration_spec,
              environment_version_id = EXCLUDED.environment_version_id,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              published_at = EXCLUDED.published_at
          `,
          teamVersionValues(version),
        );
        return;
      }
      const compiledPlan = version.compiledPlan;
      if (!compiledPlan) {
        throw new Error('Published team versions require a compiled plan');
      }
      await this.database.query(
        `
          WITH upserted_team_version AS (
            INSERT INTO team_versions (
              id, definition_id, tenant_id, workspace_id, principal_type,
              principal_id, status, name, description, graph, execution_mode,
              collaboration_spec, environment_version_id, created_at, updated_at,
              published_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb,
              $13, $14, $15, $16
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
              execution_mode = EXCLUDED.execution_mode,
              collaboration_spec = EXCLUDED.collaboration_spec,
              environment_version_id = EXCLUDED.environment_version_id,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              published_at = EXCLUDED.published_at
            RETURNING id
          )
          INSERT INTO compiled_team_plans (
            team_version_id, compiler_version, entry_node_id,
            final_output_node_id, compiled_at, steps, environment_version_id
          )
          SELECT
            upserted_team_version.id, $17, $18, $19, $20, $21::jsonb, $22
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
          execution_mode,
          collaboration_spec,
          environment_version_id,
          created_at,
          updated_at,
          published_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16
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
          execution_mode = EXCLUDED.execution_mode,
          collaboration_spec = EXCLUDED.collaboration_spec,
          environment_version_id = EXCLUDED.environment_version_id,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          published_at = EXCLUDED.published_at
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
          execution_mode,
          collaboration_spec,
          environment_version_id,
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
          execution_mode,
          collaboration_spec,
          environment_version_id,
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
    version.graph === null ? null : JSON.stringify(version.graph),
    version.executionMode,
    version.collaborationSpec
      ? JSON.stringify(version.collaborationSpec)
      : null,
    version.environmentVersionId,
    version.createdAt,
    version.updatedAt,
    version.publishedAt,
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

function ownerValuesForTeam(owner: InvokableOwnerScope): readonly string[] {
  return [
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
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
  const executionMode: string =
    typeof row.execution_mode === 'string'
      ? row.execution_mode
      : 'legacy_graph';
  const collaborationSpec =
    row.collaboration_spec != null
      ? (row.collaboration_spec as Record<string, unknown>)
      : null;

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
    executionMode: executionMode as TeamVersion['executionMode'],
    collaborationSpec: collaborationSpec
      ? {
          lead: (collaborationSpec.lead ?? {}) as TeamCollaborationSpec['lead'],
          roster: (collaborationSpec.roster ??
            []) as TeamCollaborationSpec['roster'],
          environmentVersionId: String(
            collaborationSpec.environmentVersionId ?? '',
          ),
        }
      : null,
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
