// Show one team member's Paseo transcript, addressed by role name.
//
//   node scripts/ops/role-transcript.mjs --team-run <uuid>
//   node scripts/ops/role-transcript.mjs --team-run <uuid> --member analyst
//   node scripts/ops/role-transcript.mjs --team-run <uuid> --member lead --json
//
// With no --member it lists the roles that have a transcript. Read-only: one
// SELECT and one Paseo timeline fetch per role, no writes anywhere.
import pg from 'pg';
import { DaemonClient } from '@getpaseo/client';

import { PostgresRoleAgentBindingLookup } from '../../src/infrastructure/postgres/postgres-role-agent-binding-lookup.js';
import { RoleTranscriptReader } from '../../src/adapters/paseo/role-transcript-reader.js';

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const teamRunId = flag('team-run');
const memberName = flag('member');
const asJson = process.argv.includes('--json');
if (!teamRunId) {
  process.stderr.write(
    'usage: role-transcript.mjs --team-run <uuid> [--member <name>] [--json]\n',
  );
  process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const wsUrl = process.env.PASEO_WS_URL?.trim() ?? 'ws://127.0.0.1:16767/ws';

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = new DaemonClient({
  url: wsUrl,
  clientId: `role-transcript-${process.pid}`,
  clientType: 'cli',
  appVersion: 'agent-server-role-transcript/0.1.0',
  connectTimeoutMs: 30_000,
  reconnect: { enabled: false },
});

try {
  await client.connect();
  const reader = new RoleTranscriptReader(
    new PostgresRoleAgentBindingLookup(pool),
    client,
  );

  if (!memberName) {
    const roles = await reader.listRoles(teamRunId);
    if (asJson) process.stdout.write(`${JSON.stringify(roles, null, 2)}\n`);
    else if (roles.length === 0)
      process.stdout.write(`no member of team run ${teamRunId} has a Paseo agent yet\n`);
    else
      for (const role of roles)
        process.stdout.write(
          `${role.memberName}\t(${role.role}, ${role.status})\t${role.providerAgentId}\n`,
        );
  } else {
    const transcript = await reader.read({ teamRunId, memberName });
    if (asJson) {
      process.stdout.write(`${JSON.stringify(transcript, null, 2)}\n`);
    } else {
      process.stdout.write(
        `# ${transcript.memberName} (${transcript.role}, ${transcript.status})\n` +
          `# agent ${transcript.providerAgentId}  epoch ${transcript.epoch}  ${transcript.entries.length} entries\n\n`,
      );
      for (const entry of transcript.entries) {
        const seq = entry.seqStart === null ? '-' : String(entry.seqStart);
        process.stdout.write(
          `[${seq.padStart(4)}] ${entry.kind.padEnd(10)} ${entry.derivedSummary}\n`,
        );
      }
    }
  }
} finally {
  await client.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
}
