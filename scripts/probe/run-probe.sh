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
docker exec "$PSO" bash -lc 'paseo ls --json -g -a --host 127.0.0.1:16767' 2>&1 | tee "$OUT/02-paseo-ls-before.json" | head -c 2000

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
docker exec "$PSO" bash -lc 'paseo ls --json -g -a --host 127.0.0.1:16767' > "$OUT/04-paseo-ls-after.json" 2>&1
head -c 3000 "$OUT/04-paseo-ls-after.json"

say "step 5: role -> agent id via label filter alone (public CLI)"
for ROLE in lead builder analyst; do
  echo "--- member_name=$ROLE ---"
  docker exec "$PSO" bash -lc "paseo ls --json -g -a --host 127.0.0.1:16767 --label member_name=$ROLE" \
    > "$OUT/05-paseo-ls-$ROLE.json" 2>&1
  head -c 1200 "$OUT/05-paseo-ls-$ROLE.json"; echo
  ID=$(node -e '
    const fs=require("fs");
    let raw=fs.readFileSync(process.argv[1],"utf8");
    let v; try { v=JSON.parse(raw); } catch { process.exit(0); }
    const list=Array.isArray(v)?v:(v.agents??v.items??[]);
    if(list[0]&&list[0].id) process.stdout.write(String(list[0].id));
  ' "$OUT/05-paseo-ls-$ROLE.json" 2>/dev/null)
  echo "RESOLVED_AGENT_ID[$ROLE]=$ID" | tee -a "$OUT/05-role-agent-ids.txt"
  [ -n "$ID" ] || { echo "  (no agent id resolved for $ROLE)"; continue; }

  echo "--- paseo logs $ROLE (public CLI) ---"
  docker exec "$PSO" bash -lc "paseo logs --host 127.0.0.1:16767 --tail 200 $ID" \
    > "$OUT/05-paseo-logs-$ROLE.txt" 2>&1
  wc -l "$OUT/05-paseo-logs-$ROLE.txt"; head -c 1500 "$OUT/05-paseo-logs-$ROLE.txt"; echo

  echo "--- paseo inspect $ROLE (public CLI) ---"
  docker exec "$PSO" bash -lc "paseo inspect --host 127.0.0.1:16767 --json $ID" \
    > "$OUT/05-paseo-inspect-$ROLE.json" 2>&1
  head -c 1200 "$OUT/05-paseo-inspect-$ROLE.json"; echo

  echo "--- fetchAgentTimeline $ROLE (SDK public API) ---"
  docker exec "$PSO" bash -lc "PASEO_WS_URL=ws://127.0.0.1:16767/ws node /workspace/scripts/probe/paseo-fetch-timeline.mjs $ID" \
    > "$OUT/05-sdk-timeline-$ROLE.ndjson" 2>&1
  wc -c "$OUT/05-sdk-timeline-$ROLE.ndjson"; head -c 1500 "$OUT/05-sdk-timeline-$ROLE.ndjson"; echo
done

say "step 6: stop the live probe and keep its raw capture"
docker exec "$PSO" bash -lc 'pkill -f paseo-live-stream.mjs; sleep 1; wc -l /runtime-state/live-stream.ndjson'
docker exec "$PSO" bash -lc 'cat /runtime-state/live-stream.ndjson' > "$OUT/06-live-stream.ndjson" 2>&1
wc -l "$OUT/06-live-stream.ndjson"

say "step 7: what the database says the role -> paseo agent id chain is"
# provider_agent_id lives in two places (runtime_sessions and runtime_session_bindings);
# dump both rather than assume which one a team member populates.
docker exec "$API" bash -lc 'cd /workspace && node -e "
const pg=require(\"pg\");
(async()=>{
  const p=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const out={};
  const q=async(k,sql)=>{ try{ out[k]=(await p.query(sql)).rows; }catch(e){ out[k]={error:String(e)}; } };
  await q(\"members\",\`SELECT team_run_id,name,role,status,runtime_session_id,created_at FROM team_member_runs ORDER BY created_at\`);
  await q(\"runtime_sessions\",\`SELECT id,scope_kind,scope_id,task_id,provider_agent_id,paseo_workspace_id,created_at FROM runtime_sessions ORDER BY created_at\`);
  await q(\"joined\",\`SELECT m.name,m.role,m.status,m.runtime_session_id,s.provider_agent_id,s.paseo_workspace_id FROM team_member_runs m LEFT JOIN runtime_sessions s ON s.id=m.runtime_session_id ORDER BY m.created_at\`);
  await q(\"bindings\",\`SELECT run_id,provider_agent_id,created_at FROM runtime_session_bindings ORDER BY created_at\`);
  console.log(JSON.stringify(out,null,2));
  await p.end();
})().catch(e=>{console.error(String(e));process.exit(1)});
"' > "$OUT/07-db-role-chain.json" 2>&1
head -c 6000 "$OUT/07-db-role-chain.json"

say "step 8: does a FINISHED agent still return a timeline? (SDK, after the run ended)"
IDS=$(sed -n 's/^RESOLVED_AGENT_ID\[[a-z]*\]=//p' "$OUT/05-role-agent-ids.txt" 2>/dev/null | tr '\n' ' ')
echo "IDS=$IDS"
if [ -n "${IDS// /}" ]; then
  docker exec "$PSO" bash -lc "PASEO_WS_URL=ws://127.0.0.1:16767/ws node /workspace/scripts/probe/paseo-fetch-timeline.mjs $IDS" \
    > "$OUT/08-sdk-timeline-after-run.ndjson" 2>&1
  wc -c "$OUT/08-sdk-timeline-after-run.ndjson"; head -c 2000 "$OUT/08-sdk-timeline-after-run.ndjson"
else
  echo "PROBE_NOTE: no agent ids resolved, step 8 is MISSING not FAIL"
fi

say "done; artifacts in $OUT"
ls -la "$OUT"
