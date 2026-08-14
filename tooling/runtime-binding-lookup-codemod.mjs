import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/infrastructure/postgres/postgres-runtime-session-lookup.ts';
let source = await readFile(path, 'utf8');
const anchor = `  public async findById(id: string): Promise<RuntimeSession | null> {\n`;
if (!source.includes(anchor)) throw new Error('findById anchor missing');
const classEnd = `  }\n}\n\nfunction mapRuntimeSession`;
if (!source.includes(classEnd)) throw new Error('class end anchor missing');
source = source.replace(
  classEnd,
  `  }\n\n  public async findByExecutionSessionBinding(\n    binding: Parameters<RuntimeSessionLookup['findByExecutionSessionBinding']>[0],\n  ): Promise<RuntimeSession | null> {\n    if (binding.plane !== 'paseo') return null;\n    const result = await this.db.query(\n      \`SELECT rs.*, sls.workspace_id, sls.agent_version_id,\n              sls.environment_version_id, sls.resolved_skills, sls.tool_refs\n       FROM runtime_sessions rs\n       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id\n       WHERE rs.provider_agent_id=$1\n       ORDER BY rs.created_at DESC\n       LIMIT 2\`,\n      [binding.externalSessionId],\n    );\n    if ((result.rows?.length ?? 0) > 1)\n      throw new Error('Execution session binding resolves to multiple RuntimeSessions.');\n    return result.rows?.[0] ? mapRuntimeSession(result.rows[0]) : null;\n  }\n}\n\nfunction mapRuntimeSession`,
);
source = source
  .replace(/\n\s*paseoWorkspaceId,\n\s*providerAgentId,/, '')
  .replace(/\n\s*\/\*\* @deprecated[^\n]*\*\/\n\s*readonly paseoWorkspaceId:[^\n]*;/g, '')
  .replace(/\n\s*\/\*\* @deprecated[^\n]*\*\/\n\s*readonly providerAgentId:[^\n]*;/g, '');
await writeFile(path, source);
