#!/usr/bin/env bash
# Drives one real Agent Team run and reads each role's transcript back out of
# Paseo. Everything it reads comes from the public CLI or the published SDK
# surface; the only thing it writes to is its own artifact directory.
set -u
OUT=${PROBE_ARTIFACTS:-/root/probe-artifacts}
mkdir -p "$OUT"
say() { echo "=== $* ==="; }

API=$(docker ps --format '{{.Names}}' | grep -- '-agent-server-' | head -1)
PSO=$(docker ps --format '{{.Names}}' | grep -- '-paseo-runtime-' | head -1)
echo "API_CONTAINER=$API"
echo "PASEO_CONTAINER=$PSO"
[ -n "$API" ] && [ -n "$PSO" ] || { echo "PROBE_FATAL: containers not found"; docker ps -a --format '{{.Names}}\t{{.Status}}'; exit 91; }

say "step 0: paseo CLI identity (public CLI)"
docker exec "$PSO" bash -lc 'command -v paseo; paseo --version' 2>&1 | tee "$OUT/00-paseo-version.txt"
docker exec "$PSO" bash -lc 'paseo --help' 2>&1 | tee "$OUT/00-paseo-help.txt"

say "step 1: start the read-only live-stream probe (background, inside paseo-runtime)"
docker exec -d "$PSO" bash -lc \
  'PASEO_WS_URL=ws://127.0.0.1:16767/ws PROBE_OUT=/runtime-state/live-stream.ndjson PROBE_DURATION_MS=1800000 node /workspace/scripts/probe/paseo-live-stream.mjs > /runtime-state/live-stream.err 2>&1'
sleep 3
docker exec "$PSO" bash -lc 'wc -l /runtime-state/live-stream.ndjson 2>&1; cat /runtime-state/live-stream.err 2>&1 | head -20'

say "step 2: baseline paseo ls before the run (public CLI)"
docker exec "$PSO" bash -lc 'paseo ls --json -g -a' 2>&1 | tee "$OUT/02-paseo-ls-before.json" | head -c 2000

say "step 3: the real Agent Team run (three roles: lead / builder / analyst)"
docker exec \
  -e AGENT_SERVER_BASE_URL=http://127.0.0.1:3000 \
  -e AGENT_SERVER_SERVICE_TOKEN=token-local-dev \
  -e AGENT_SERVER_WORKSPACE_ID=00000000-0000-4000-8000-000000000001 \
  -e AGENT_TEAM_SMOKE_TIMEOUT_MS=900000 \
  "$API" bash -lc 'cd /workspace && node scripts/smoke/agent-team-main-flow.mjs' \
  > "$OUT/03-smoke.log" 2>&1
echo "SMOKE_RC=$?" | tee "$OUT/03-smoke-rc.txt"
tail -40 "$OUT/03-smoke.log"

say "step 4: paseo ls after the run (public CLI) — role labels are the mapping"
docker exec "$PSO" bash -lc 'paseo ls --json -g -a' > "$OUT/04-paseo-ls-after.json" 2>&1
head -c 3000 "$OUT/04-paseo-ls-after.json"

say "step 5: role -> agent id via label filter alone (public CLI)"
for ROLE in lead builder analyst; do
  echo "--- member_name=$ROLE ---"
  docker exec "$PSO" bash -lc "paseo ls --json -g -a --label member_name=$ROLE" \
    > "$OUT/05-paseo-ls-$ROLE.json" 2>&1
  head -c 1200 "$OUT/05-paseo-ls-$ROLE.json"; echo
done

say "step 6: stop the live probe and keep its raw capture"
docker exec "$PSO" bash -lc 'pkill -f paseo-live-stream.mjs; sleep 1; wc -l /runtime-state/live-stream.ndjson'
docker exec "$PSO" bash -lc 'cat /runtime-state/live-stream.ndjson' > "$OUT/06-live-stream.ndjson" 2>&1
wc -l "$OUT/06-live-stream.ndjson"

say "step 7: what the database says the role -> paseo agent id chain is"
docker exec "$API" bash -lc 'cd /workspace && node -e "
const pg=require(\"pg\");
(async()=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const q=await p.query(\`SELECT m.name,m.role,m.status,m.runtime_session_id,s.provider_agent_id,s.paseo_workspace_id FROM team_member_runs m LEFT JOIN runtime_sessions s ON s.id=m.runtime_session_id ORDER BY m.created_at\`);
console.log(JSON.stringify(q.rows,null,2));await p.end();})().catch(e=>{console.error(String(e));process.exit(1)});
"' > "$OUT/07-db-role-chain.json" 2>&1
cat "$OUT/07-db-role-chain.json"

say "done; artifacts in $OUT"
ls -la "$OUT"
