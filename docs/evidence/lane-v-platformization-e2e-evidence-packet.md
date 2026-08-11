# Lane V platformization HTTP E2E acceptance evidence

Status: **FAIL — steps 1-3 pass; step 4 starts but the real WorkRun fails; steps 5-6 are only partially testable on the failed run**

Acceptance base: `verify/round-merged@aa13455c5f415be233909efcf885034e38b794f0`

Final evidence label: `lane-v-final-aa13455`

## Conclusion

An external user can now validate/import Definitions, publish them, create a Work in the server-derived default workspace, and receive a bound WorkRun. The real provider-backed execution does not complete: the Lead runtime child fails after about 61 seconds while Paseo continues the same agent-creation request and completes it after 96.858 seconds.

The complete six-step journey therefore does **not** pass. It reaches step 4 of 6. The failed run's trace and record endpoints are readable, but the trace has no Team state or typed edges and cannot by itself explain the actual TeamRun failure. A successful four-edge Timeline, WorkRun/event cross-page coverage, and owner-scope isolation remain unverified.

No internal function, MCP tool, smoke shortcut, DB write, direct DB seed, or configuration restart was used to advance a journey step. All product mutations and reads in steps 1-6 were HTTP calls.

## Environment and startup acceptance

- Cube: `agent-server-lane-v-20260811` (`0d8cb72e9ebc49ddbff7babe88e8dfef`)
- workspace: `/root/workspace/verify-merged`
- image: `agent-server-runner:latest`
- dependency stamp: `f3af85b97dea77f4acf7f72780d9df692cf81ed8c4c47e47a0a016e9c5112286`
- provider credential: local and remote files matched at 88 bytes, SHA-256 prefix `a165a35f`, mode `600`; the value was never printed or recorded.
- final `docker compose ps`: Postgres and agent-server both healthy.
- final `GET /health/ready`: 200; `paseo_websocket`, `paseo_workspace`, and `opencode_model` all `ready`.
- Lane F's running container had non-committed enlarged startup/provider timeout environment. Lane V did not rebuild or restart it.

### Startup defect: blank Compose environment defaults

The original default Compose start exited with:

```text
PASEO_DAEMON_STARTUP_TIMEOUT_MS must be a positive decimal safe integer.
```

Lane V independently verified both repaired parser paths at `2703517`:

- `pnpm exec vitest run --config vitest.unit.config.ts scripts/dev/paseo-process.test.mjs src/shared/config.test.ts`
- 2 files passed, 38 tests passed, exit 0.
- empty and whitespace values defaulted for daemon, connect, and execution timeouts.
- nonnumeric, zero/below-minimum, negative, decimal, above-maximum, and unsafe values remained rejected.

The final default-value code reached HTTP readiness. This defect is signed off.

### Startup defect: root-owned Cube bind is not writable by container `node`

A fresh Cube checkout was `root:root 0755`, bind-mounted rw at `/workspace`, while the image and container run as `node`. Paseo's pnpm check attempted `/workspace/_tmp_*` and failed deterministically with EACCES; agent-server exited before opening HTTP.

The task owner manually changed the workspace mount-point owner to uid/gid 1000 and recursively aligned `.local`. Only after that environment workaround did startup proceed. Every newly provisioned Cube requires equivalent manual preparation today. This remains a real user-facing startup defect; the workaround is not treated as a product fix.

After the workaround, Paseo also recreated `/workspace/node_modules` and downloaded 497 packages before readiness. That cold-volume/runtime-layout cost is already tracked with the ownership tooling work and is not counted as a new Lane V defect.

## OI-27 independent fix verification

The OI-27 default-scope repair passes its hard gates:

- `CreateWorkRequestSchema` remains `.strict()` with only `definition_id`, `definition_version_id`, and `title`; there is no caller-selected `workspace_id`.
- `POST /api/v1/works` still derives `owner` with `WorkIdentityApi.ownerFromAccessContext(accessContext)`.
- Definition/Work owner checks remain server-derived.
- default Compose service-account workspace is the UUID `00000000-0000-4000-8000-000000000001`.
- startup provisions the configured service-account workspace and verifies tenant/principal ownership.
- the previously generic missing-scope database errors are mapped to HTTP 409 `workspace_scope_unavailable`.

HTTP proof is in step 3: the default-scope Work returned 201 with that UUID. A permitted read-only DB corroboration returned:

```text
default_workspace=00000000-0000-4000-8000-000000000001|tenant=tenant_local|principal_type=service_account|principal_id=svc_local
```

The query only verified the API-visible default scope. It did not create, bind, or alter data and was not used to supply a later request.

The known larger limitation remains: an API-created workspace still cannot be selected/bound for the Definition→Work chain. This is OI-27's explicitly deferred multi-workspace capability gap, not a new Lane V defect.

## Step-by-step HTTP evidence

All requests used `Authorization: Bearer <redacted>` and JSON unless noted.

### 1. Validate and import Definitions — PASS

Every validate/import body was `{source:<complete Definition YAML>}`. Import requests included label-specific idempotency keys. Validation required `valid=true` and a `sha256:` fingerprint; imports returned coherent draft lineage.

| Definition | Validate | Import | Key fields |
| --- | --- | --- | --- |
| Environment | `POST /api/v1/environment-packages:validate` → 200 | `POST /api/v1/environments:import` → 201 | definition `b5cbae74-9f76-4da3-8c06-9f8721c9b6bd`; version `d0823b65-7390-4083-813c-2d0785823bb7`; fingerprint `sha256:27565d29...` |
| Lead | `POST /api/v1/agent-packages:validate` → 200 | `POST /api/v1/agents:import` → 201 | definition `6eae5ed6-b733-4cb5-9a96-450944776b6f`; version `7ef2a405-d1fb-4090-8e00-9a1f3b459b94`; fingerprint `sha256:a8523757...` |
| Worker | `POST /api/v1/agent-packages:validate` → 200 | `POST /api/v1/agents:import` → 201 | definition `be11dc9b-720c-4ff7-8b6f-f980865d2af6`; version `02ad1f07-17a7-4c28-85d1-e224cf207b32`; fingerprint `sha256:f220eeef...` |
| Reviewer | `POST /api/v1/agent-packages:validate` → 200 | `POST /api/v1/agents:import` → 201 | definition `60bf7e85-ff5f-4fc0-9925-1a2694190f87`; version `710a1cc6-213f-45ea-a882-baa45f49ac19`; fingerprint `sha256:c41f4f4c...` |
| Team | `POST /api/v1/team-packages:validate` → 200 | `POST /api/v1/teams:import` → 201 | definition `e8031947-c093-4fad-a8b3-8641e9506b27`; version `38cd045c-49fb-42a1-ad6c-0569f265fba2`; environment version `d0823b65-7390-4083-813c-2d0785823bb7`; fingerprint `sha256:3ef5a406...` |

### 2. Publish versions — PASS

Each publish used an empty JSON body and a label-specific idempotency key. Every response preserved definition/version lineage, returned `status=published`, and had non-null `published_at`.

| Definition | Request | Status | Key response |
| --- | --- | --- | --- |
| Environment | `POST /api/v1/environment-versions/d0823b65-7390-4083-813c-2d0785823bb7:publish` | 200 | same definition/version; published |
| Lead | `POST /api/v1/agent-versions/7ef2a405-d1fb-4090-8e00-9a1f3b459b94:publish` | 200 | definition `6eae5ed6-...`; published |
| Worker | `POST /api/v1/agent-versions/02ad1f07-17a7-4c28-85d1-e224cf207b32:publish` | 200 | definition `be11dc9b-...`; published |
| Reviewer | `POST /api/v1/agent-versions/710a1cc6-213f-45ea-a882-baa45f49ac19:publish` | 200 | definition `60bf7e85-...`; published |
| Team | `POST /api/v1/team-versions/38cd045c-49fb-42a1-ad6c-0569f265fba2:publish` | 200 | definition `e8031947-...`; exact Environment/Lead/Worker/Reviewer versions retained; published |

### 3. Create Work — PASS

Main request:

```json
{
  "definition_id": "e8031947-c093-4fad-a8b3-8641e9506b27",
  "definition_version_id": "38cd045c-49fb-42a1-ad6c-0569f265fba2",
  "title": "lane-v-final-aa13455 main"
}
```

- `POST /api/v1/works` → 201.
- Work `61ed79d6-333e-4ff7-bbd2-e0c425339ac7`.
- `tenant_id=tenant_local`.
- `workspace_id=00000000-0000-4000-8000-000000000001`.
- definition/version IDs matched the published Team; `origin=created`.
- two sibling Work requests also returned 201: `816f01ff-59e9-461f-a8fe-822af8143db3` and `e57c0cd9-7f99-42b7-be08-e9cbc247f82b`.

### 4. Run WorkRun — FAIL after accepted start

Request:

```text
POST /api/v1/works/61ed79d6-333e-4ff7-bbd2-e0c425339ac7/runs
{"trigger_kind":"manual","trigger_ref":"lane-v-final-aa13455-main-run"}
```

Initial response: 202.

- WorkRun `cf999751-dcca-439f-90cf-1ae665a69ede`.
- `bound_at=2026-08-11T08:51:11.221Z`.
- execution receipt `reused=false`.
- root Task `2e6f37ee-7985-48a0-8a9b-776381be03ab`.

Terminal HTTP reads:

- root Task: `status=failed`; latest Run `1d5f111a-1353-4dda-a2ba-38749a73aa5f`, `status=failed`; error `runtime_execution_failed`, “The Team Lead could not complete its turn.”
- child runtime Task `962973da-1e13-419a-9226-77c1ede7d23a`: failed.
- child technical Run `1898f437-f334-49df-a38a-0098901fd589`: failed after about 61.46 seconds; “The runtime could not complete the run.”
- TeamRun `f2e8213c-7e88-46c0-9ff2-38d0e6ca5a2f`: `status=failed`, `phase=done`, `control_state=terminal`, `lead_turn_count=1`, `stop_reason=lead_run_failed`.

Non-API diagnostic evidence, used only after the HTTP failure:

- Paseo logged `create_agent_request` completion after `96,858ms`.
- `@getpaseo/client` defaults `PASEO_SESSION_RPC_TIMEOUT_MS` to `60000`.
- Compose declares `PASEO_SESSION_RPC_TIMEOUT_MS`, but `scripts/dev/with-paseo.mjs` does not include it in `applicationEnvironmentNames`, so it is not forwarded to the `pnpm dev:api` child.
- Lane F's enlarged daemon/OpenCode/provider timeouts therefore did not cover this layer.

This is a concrete OI-28-family timeout forwarding/layering blocker. Lane V did not change the environment or retry the WorkRun.

### 5. Read run trace Timeline — HTTP readable, acceptance FAIL

`GET /api/v1/works/61ed79d6-333e-4ff7-bbd2-e0c425339ac7/runs/cf999751-dcca-439f-90cf-1ae665a69ede/trace` → 200.

Key response:

- `capture_status=complete`.
- exact Work and WorkRun IDs present.
- `root_task=null`, even though the root Task is separately readable.
- `team_run=null`, even though TeamRun `f2e8213c-...` is separately readable.
- two Runs, both failed; `provider=null`, `model=null`, `result_capture_status=not_present`.
- four globally time-ordered events: two `started`, two `failed`; failure payload capture is redacted.
- `work_items=[]` and `edges=[]`; none of `observed_message`, `declared_dependency`, `assignment`, or `feedback` appears.

Narrative verdict: **fail**. From trace alone a user can say that two technical runs started and failed. The user cannot see that this was a TeamRun, that the Lead failed, the `lead_run_failed` stop reason, or why runtime creation failed. `capture_status=complete` does not make that omission explicit. A successful four-edge trace could not be tested because step 4 failed before the Lead created Team Work.

### 6. Enumerate interface records — partial PASS

All of these returned HTTP 200:

- `GET /api/v1/works?limit=100`
- `GET /api/v1/works/:workId/runs?limit=100`
- `GET /api/v1/works/:workId/runs/:workRunId`
- trace endpoint above
- `GET /api/v1/tasks/:rootTaskId`
- `GET /api/v1/tasks/:rootTaskId/tree`
- `GET /api/v1/team-runs/:teamRunId`
- `GET /api/v1/team-runs/:teamRunId/members`
- `GET /api/v1/team-runs/:teamRunId/tasks`
- `GET /api/v1/team-runs/:teamRunId/direct-messages`
- `GET /api/v1/runs/:runId`
- `GET /api/v1/runs/:runId/events?after=0`
- `GET /api/v1/runs/:runId/events/stream?after=0` with `Accept: text/event-stream`

Observed records:

- Works list contained all three Lane V Works.
- `limit=1` cursor traversal returned 4 pages/4 unique IDs with no duplicate or loss relative to the full list.
- WorkRuns list contained WorkRun `cf999751-...`; only one WorkRun existed, so cross-page WorkRun pagination was not testable without launching another provider run.
- exact WorkRun projection returned `capture_status=complete` and exact Work/WorkRun, but `root_task=null`, `team_run=null`, and empty run/event arrays.
- Task tree contained the failed root and child Tasks exactly once.
- TeamRun members returned Lead `failed`, Worker `starting`, Reviewer `starting`.
- Team tasks and direct messages were empty because the Lead failed before creating Work A/B/C.
- root and child Run event pages each returned ordered sequences `1 started`, `2 failed`, `next_cursor=null`.
- SSE returned the same ordered terminal events for the root Run.

Not verified because step 4 failed or no credential was available:

- successful WorkRun terminal records;
- WorkRun cross-page pagination;
- event cross-page pagination beyond two events;
- A/B/C Team tasks, attempts, feedback, dependencies, assignments, and direct message;
- foreign-owner isolation and cross-owner cursor rejection.

Artifacts, provisional markers, the old `/team-runs:project` path, and the inaccessible positive `stuck` sample were explicitly out of scope.

## Database and non-API accounting

No PostgreSQL write was performed. Two task-owner-authorized read-only checks were used only to corroborate API/default-scope facts:

1. before OI-27 repair, `workspace_main_count=0`, while the UUID returned by `POST /workspaces` existed;
2. after OI-27 repair, the fixed default UUID existed with the expected tenant/service-account owner.

Neither query supplied an ID to a later request, created a workspace, changed credential scope, or replaced an API step.

Other non-API evidence was limited to Compose/container health, logs, mount ownership, committed-code inspection, and the dependency client's configured timeout after an API-observed failure. Those checks diagnosed causes; they did not advance the journey.
