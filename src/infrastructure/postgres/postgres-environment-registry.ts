import type {
  EnvironmentRegistry,
  EnvironmentDefinition,
  EnvironmentVersion,
} from '../../application/ports/environment-registry.js';
import type { ManagedAgentOwner } from '../../domain/agents/managed-agent-owner.js';
import { canonicalizeManagedEnvironmentJson } from '../../domain/environments/managed-environment-package.js';
export class PostgresEnvironmentRegistry implements EnvironmentRegistry {
  constructor(private readonly db: any) {}
  private where(o: ManagedAgentOwner) {
    return [o.tenantId, o.principalType, o.principalId];
  }
  async importEnvironment(c: any) {
    const now = new Date().toISOString(),
      q = await this.db.query(
        `SELECT * FROM environment_registry_idempotency WHERE operation='import' AND tenant_id=$1 AND principal_type=$2 AND principal_id=$3 AND idempotency_key=$4`,
        [...this.where(c.owner), c.idempotencyKey],
      );
    if (q.rows?.[0]) {
      if (q.rows[0].request_fingerprint !== c.requestFingerprint)
        throw new Error('idempotency_conflict');
      const d = await this.findDefinition(c.owner, q.rows[0].definition_id),
        v = await this.findVersion(c.owner, q.rows[0].version_id);
      if (d && v) return { kind: 'replayed', definition: d, version: v };
    }
    const d = await this.db.query(
      `INSERT INTO environment_definitions(id,tenant_id,principal_type,principal_id,normalized_name,display_name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT (tenant_id,principal_type,principal_id,normalized_name) DO UPDATE SET updated_at=environment_definitions.updated_at RETURNING *`,
      [
        c.definition.id,
        ...this.where(c.owner),
        c.definition.normalizedName,
        c.definition.displayName,
        now,
      ],
    );
    const def = mapD(d.rows[0]);
    const ex = await this.db.query(
      `SELECT * FROM environment_versions WHERE definition_id=$1 AND fingerprint=$2`,
      [def.id, c.version.fingerprint],
    );
    let ver = ex.rows?.[0] ? mapV(ex.rows[0]) : null;
    if (!ver) {
      const r = await this.db.query(
        `INSERT INTO environment_versions(id,definition_id,tenant_id,principal_type,principal_id,status,display_name,canonical_package,fingerprint,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$9) RETURNING *`,
        [
          c.version.id,
          def.id,
          ...this.where(c.owner),
          c.version.displayName,
          c.version.package,
          c.version.fingerprint,
          now,
        ],
      );
      ver = mapV(r.rows[0]);
    }
    await this.db.query(
      `INSERT INTO environment_registry_idempotency(operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,definition_id,version_id,created_at,updated_at) VALUES('import',$1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT DO NOTHING`,
      [
        ...this.where(c.owner),
        c.idempotencyKey,
        c.requestFingerprint,
        def.id,
        ver.id,
        now,
      ],
    );
    return {
      kind: ex.rows?.[0] ? 'converged' : 'created',
      definition: def,
      version: ver,
    };
  }
  async publishEnvironmentVersion(c: any) {
    const q = await this.db.query(
      `SELECT * FROM environment_registry_idempotency WHERE operation='publish' AND tenant_id=$1 AND principal_type=$2 AND principal_id=$3 AND idempotency_key=$4`,
      [...this.where(c.owner), c.idempotencyKey],
    );
    if (q.rows?.[0]) {
      if (q.rows[0].request_fingerprint !== c.requestFingerprint)
        throw new Error('idempotency_conflict');
      const v = await this.findVersion(c.owner, q.rows[0].version_id);
      if (v) return v;
    }
    const r = await this.db.query(
      `UPDATE environment_versions SET status='published',published_at=COALESCE(published_at,$2),updated_at=$2 WHERE id=$1 AND tenant_id=$3 AND principal_type=$4 AND principal_id=$5 AND status='draft' RETURNING *`,
      [c.versionId, new Date().toISOString(), ...this.where(c.owner)],
    );
    if (!r.rows?.[0]) {
      const v = await this.findVersion(c.owner, c.versionId);
      if (!v) throw new Error('not_found');
      const existing = await this.db.query(
        `SELECT request_fingerprint FROM environment_registry_idempotency WHERE operation='publish' AND tenant_id=$1 AND principal_type=$2 AND principal_id=$3 AND idempotency_key=$4`,
        [...this.where(c.owner), c.idempotencyKey],
      );
      if (
        existing.rows?.[0] &&
        existing.rows[0].request_fingerprint !== c.requestFingerprint
      )
        throw new Error('idempotency_conflict');
      if (existing.rows?.[0]) return v;
      await this.db.query(
        `INSERT INTO environment_registry_idempotency(operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,version_id,created_at,updated_at) VALUES('publish',$1,$2,$3,$4,$5,$6,$7,$7)`,
        [
          ...this.where(c.owner),
          c.idempotencyKey,
          c.requestFingerprint,
          v.id,
          new Date().toISOString(),
        ],
      );
      return v;
    }
    const v = mapV(r.rows[0]);
    await this.db.query(
      `INSERT INTO environment_registry_idempotency(operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,version_id,created_at,updated_at) VALUES('publish',$1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT DO NOTHING`,
      [
        ...this.where(c.owner),
        c.idempotencyKey,
        c.requestFingerprint,
        v.id,
        new Date().toISOString(),
      ],
    );
    return v;
  }
  async findDefinition(o: ManagedAgentOwner, id: string) {
    const r = await this.db.query(
      `SELECT * FROM environment_definitions WHERE id=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4`,
      [id, ...this.where(o)],
    );
    return r.rows?.[0] ? mapD(r.rows[0]) : null;
  }
  async findVersion(o: ManagedAgentOwner, id: string) {
    const r = await this.db.query(
      `SELECT * FROM environment_versions WHERE id=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4`,
      [id, ...this.where(o)],
    );
    return r.rows?.[0] ? mapV(r.rows[0]) : null;
  }
  async countPublished(o: ManagedAgentOwner) {
    const r = await this.db.query(
      `SELECT count(*)::int AS count FROM environment_versions WHERE tenant_id=$1 AND principal_type=$2 AND principal_id=$3 AND status='published'`,
      this.where(o),
    );
    return Number(r.rows?.[0]?.count ?? 0);
  }
}
const mapD = (r: any): EnvironmentDefinition => ({
  id: r.id,
  tenantId: r.tenant_id,
  workspaceId: r.workspace_id,
  principalType: r.principal_type,
  principalId: r.principal_id,
  normalizedName: r.normalized_name,
  displayName: r.display_name,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
const mapV = (r: any): EnvironmentVersion => ({
  id: r.id,
  definitionId: r.definition_id,
  tenantId: r.tenant_id,
  workspaceId: r.workspace_id,
  principalType: r.principal_type,
  principalId: r.principal_id,
  status: r.status,
  displayName: r.display_name,
  package: r.canonical_package,
  canonicalJson: canonicalizeManagedEnvironmentJson(r.canonical_package),
  fingerprint: r.fingerprint,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
  publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
});
