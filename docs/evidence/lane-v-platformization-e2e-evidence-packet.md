# Lane V platformization HTTP E2E acceptance evidence

Status: **PARTIAL PASS — a pure-HTTP WorkRun succeeded and most read surfaces are usable, but Timeline completeness is false and three required isolation/pagination/edge cases remain unverified**

Acceptance base: `verify/round-merged@8f14455`

Final Lane V evidence label: `lane-v-final-dda1b85-20260811`

## Conclusion

An external user can now perform the main journey through HTTP only: validate/import five Definitions, publish them, create a Work in the server-derived default workspace, start a real provider-backed WorkRun, reach a successful TeamRun, and enumerate Work/WorkRun/Task/TeamRun/Run/event/trace records. WorkRun cursor pagination also works across two records.

The journey is not fully accepted because its primary Timeline contract is misleading. On a successful WorkRun with nine succeeded technical Runs, 97 events, two accepted work items, and seven edges, both the exact WorkRun projection and trace return `capture_status=complete` while `root_task=null` and `team_run=null`. The exact projection additionally returns empty Run/event arrays. Trace alone cannot say that the TeamRun succeeded or provide the root Task result. This confirms and materially upgrades OI-31 with a positive real-execution sample.

Three required cases remain unverified: true event pagination (no Run exceeded 16 events), `declared_dependency` edges (the Lead never created the requested C item), and foreign-owner isolation (no second token was provisioned). The other three edge kinds, ordering, guarantees, and event equality were verified. A separate cancellation defect was observed: `POST /tasks/:id:cancel` returned HTTP 200 with `status=terminal`, but the active Task was not cancelled and later succeeded.

No internal function, MCP tool, smoke shortcut, DB write, direct DB seed, or configuration restart was used to advance a journey step. All product mutations and reads in steps 1-6 were HTTP calls. Container and PostgreSQL logs were read only after an HTTP outage to diagnose it; those logs did not advance the journey and are not used as API-contract evidence.

## Environment and startup acceptance

- Cube: `agent-server-lane-v-20260811` (`0d8cb72e9ebc49ddbff7babe88e8dfef`)
- workspace: `/root/workspace/verify-merged`
- image: `agent-server-runner:latest`
- dependency stamp: `f3af85b97dea77f4acf7f72780d9df692cf81ed8c4c47e47a0a016e9c5112286`
- provider credential: local and remote files matched at 88 bytes, SHA-256 prefix `a165a35f`, mode `600`; the value was never printed or recorded.
- final `GET /health/ready`: 200; `paseo_websocket`, `paseo_workspace`, and `opencode_model` all `ready`.
- final committed defaults include `PASEO_SESSION_RPC_TIMEOUT_MS=300000`, `PASEO_EXECUTION_TIMEOUT_MS=150000`, explicit forwarding to the API child, blank/whitespace filtering, and a 45-minute healthcheck start period.
- Lane V did not rebuild, restart, or change environment/configuration after the Cube was handed back.

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

## Final six-step HTTP result at `8f14455`

All requests used `Authorization: Bearer <redacted>`. Lane V created this data under the label `lane-v-final-dda1b85-20260811`; no Lane F evidence directory was reused.

### 1. Validate and import Definitions — PASS

Every validate endpoint returned 200 with `valid=true` and a `sha256:` fingerprint. Every import endpoint returned 201 with coherent draft lineage.

| Definition  | Validate/import                                                                              | Definition ID                          | Version ID                             |
| ----------- | -------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------- |
| Environment | `POST /api/v1/environment-packages:validate` → 200; `POST /api/v1/environments:import` → 201 | `27ddce9d-9644-465d-abfc-90f878105060` | `1aaab93a-0bbf-4fa3-a838-2c8642fa19ba` |
| Lead        | `POST /api/v1/agent-packages:validate` → 200; `POST /api/v1/agents:import` → 201             | `e581863d-d238-4f69-a77e-f691dd366daa` | `fc045b18-9f21-4220-b610-63af94dab577` |
| Worker      | same endpoints → 200/201                                                                     | `a99b6133-f14f-4dac-a99b-15560bb3e355` | `123436b9-85c7-4d3e-ae00-2b62c68bbad5` |
| Reviewer    | same endpoints → 200/201                                                                     | `364ac446-2751-4c95-99ca-b86680bb9b26` | `4774ef54-5a28-429a-8c23-51dcdf70cf68` |
| Team        | `POST /api/v1/team-packages:validate` → 200; `POST /api/v1/teams:import` → 201               | `27be3897-92b9-46d6-bc2e-7b71f62ad3bd` | `b4ca2272-2d2a-452a-abce-36eb5c46c04c` |

### 2. Publish versions — PASS

The five Environment/Agent/Team publish endpoints all returned 200 with `status=published`, preserved lineage, and non-null `published_at`.

### 3. Create Work — PASS

`POST /api/v1/works` returned 201 for the main Work `17aebf08-0fe6-4900-bb61-69bd5e2b4cbb` and sibling Works `446b3cbd-a44f-41ed-8e7e-b2ea784ac222` and `67574878-3dc1-410b-9e1d-ebe10dadd357`. The main response used the server-derived default workspace `00000000-0000-4000-8000-000000000001`; the request contained no `workspace_id`.

### 4. Run WorkRun — PASS with one infrastructure-interrupted run and one successful run

The first `POST /api/v1/works/17aebf08-.../runs` returned 202:

- WorkRun `f3697347-2b8e-4db6-a732-7bdd9fdbc46c`;
- root Task `ba0d5360-6ff5-4914-849b-72d24577b932`;
- TeamRun `57d0530d-400f-4388-a056-ddf8ff684ce6`.

That run had real execution: four technical Runs, 19 events, two work items, and member provider activity. At 09:35:48 UTC PostgreSQL received the quick-exit mechanism corresponding to SIGQUIT, terminated all connections, and did crash recovery. The agent-server pg pool then emitted an unhandled `Connection terminated unexpectedly`; HTTP became unavailable. After Manager-authorized recovery, HTTP showed the root Task failed with `The Team could not recover an expired turn`, and TeamRun ended `turn_lease_expired`. The PostgreSQL/log inspection was diagnostic only; all state reads remained HTTP.

Lane V then created a second WorkRun through the public endpoint for pagination coverage. It returned 202:

- WorkRun `731e1303-e32d-4ad5-b786-1c40380c4c4f`;
- root Task `7fe6d87a-821e-410d-815f-61b9f9f49add`;
- TeamRun `a57c0757-faa4-45c7-be88-0ea7aa1cc5f7`.

This run reached a genuine positive terminal state through HTTP:

- root Task `completed`; root technical Run `de7d250e-7359-443a-8088-5c1569e98db8` `succeeded`;
- Task result: `Called team_finish successfully. All accepted, no active attempts, and no authorized actions remain.`;
- TeamRun `succeeded`, `phase=done`, revision 12, five Lead turns;
- Task tree contained nine unique completed Tasks;
- trace contained nine succeeded Runs, including populated real runtime labels, and 97 events.

The final timeout repair is therefore independently effective on the main path: agent creation and member execution crossed the former 60/120-second danger windows without `runtime_timed_out` in this successful WorkRun.

### 5. Timeline/trace — DATA PRESENT, CONTRACT FAIL (OI-31)

`GET /api/v1/works/17aebf08-.../runs/731e1303-.../trace` returned 200 and `capture_status=complete`.

Positive evidence:

- nine succeeded Runs and 97 globally ordered events;
- two accepted work items, A and B;
- A had two attempts; attempt 2 had honestly redacted feedback;
- B had one completed attempt;
- seven ordered edges;
- edge kinds present: `assignment`, `feedback`, `observed_message`;
- guarantees matched kinds, assignments exactly covered all attempts, and feedback correlated exactly to A attempt 2;
- public Run-event pages exactly matched all 97 trace `(run_id, sequence)` keys.

OI-31 still fails on this rich success sample:

- trace says `capture_status=complete` but `root_task=null` and `team_run=null`;
- the exact WorkRun projection also says `capture_status=complete`, has the two work items, but returns `root_task=null`, `team_run=null`, `runs=[]`, and `events=[]`;
- trace does not contain the TeamRun success state or root Task result;
- the earlier clean `lead_no_progress` WorkRun showed the same null root/team fields and additionally showed terminal Team work items as `in_progress`.

Timeline-only narrative verdict: **fail**. A user can say that A and B were assigned, A was retried after feedback, and nine technical Runs succeeded. From trace alone the user cannot say that the TeamRun succeeded, quote the root result, or explain a Team failure such as `lead_no_progress`/`turn_lease_expired`. Separate Task and TeamRun endpoints are required to recover those facts, even though trace claims completeness.

`declared_dependency` was not observed. The Lead never created the Definition-requested C item, so there was no dependency relationship to capture. Lane V did not repeat stochastic provider runs merely to manufacture that positive sample. Four-edge coverage is therefore 3/4, not a pass.

### 6. Enumerate interface records — PARTIAL PASS

All relevant reads returned 200: Works, WorkRuns, exact WorkRun, trace, Task/tree, TeamRun/members/tasks/direct-messages, technical Runs, and Run events.

- WorkRun pagination passed: `limit=1` page 1 returned `f3697347-...`, its cursor returned `731e1303-...` on page 2, with no duplicate/loss and final `next_cursor=null`.
- Success trace/public-event equality passed for all nine Runs and 97 event keys.
- True event cross-page coverage remains unverified: the largest Run contained 16 events and every events response had `next_cursor=null`.
- Team member reads returned Lead/Worker/Reviewer idle after success; Team tasks returned A/B accepted; the Definition-requested C and direct-message marker were absent.
- Foreign-owner isolation remains unverified because no second token was provisioned. No internal credential or DB workaround was used.

### Additional defect: Task cancel reports terminal but does not cancel

Immediately after the second WorkRun was accepted, Lane V called `POST /api/v1/tasks/7fe6d87a-...:cancel` through HTTP. It returned 200:

```json
{
  "task_id": "7fe6d87a-821e-410d-815f-61b9f9f49add",
  "run_id": "de7d250e-7359-443a-8088-5c1569e98db8",
  "status": "terminal"
}
```

Subsequent `GET /tasks/:id` still showed `active/waiting_children`; the Task continued executing for about six minutes and finally succeeded. Thus the public cancel response neither describes the contemporaneous Task state nor results in cancellation. Lane V sent no second cancel and did not use an internal cleanup path.

## Earlier `aa13455` baseline evidence

All requests used `Authorization: Bearer <redacted>` and JSON unless noted.

### 1. Validate and import Definitions — PASS

Every validate/import body was `{source:<complete Definition YAML>}`. Import requests included label-specific idempotency keys. Validation required `valid=true` and a `sha256:` fingerprint; imports returned coherent draft lineage.

| Definition  | Validate                                           | Import                                   | Key fields                                                                                                                                                                                      |
| ----------- | -------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment | `POST /api/v1/environment-packages:validate` → 200 | `POST /api/v1/environments:import` → 201 | definition `b5cbae74-9f76-4da3-8c06-9f8721c9b6bd`; version `d0823b65-7390-4083-813c-2d0785823bb7`; fingerprint `sha256:27565d29...`                                                             |
| Lead        | `POST /api/v1/agent-packages:validate` → 200       | `POST /api/v1/agents:import` → 201       | definition `6eae5ed6-b733-4cb5-9a96-450944776b6f`; version `7ef2a405-d1fb-4090-8e00-9a1f3b459b94`; fingerprint `sha256:a8523757...`                                                             |
| Worker      | `POST /api/v1/agent-packages:validate` → 200       | `POST /api/v1/agents:import` → 201       | definition `be11dc9b-720c-4ff7-8b6f-f980865d2af6`; version `02ad1f07-17a7-4c28-85d1-e224cf207b32`; fingerprint `sha256:f220eeef...`                                                             |
| Reviewer    | `POST /api/v1/agent-packages:validate` → 200       | `POST /api/v1/agents:import` → 201       | definition `60bf7e85-ff5f-4fc0-9925-1a2694190f87`; version `710a1cc6-213f-45ea-a882-baa45f49ac19`; fingerprint `sha256:c41f4f4c...`                                                             |
| Team        | `POST /api/v1/team-packages:validate` → 200        | `POST /api/v1/teams:import` → 201        | definition `e8031947-c093-4fad-a8b3-8641e9506b27`; version `38cd045c-49fb-42a1-ad6c-0569f265fba2`; environment version `d0823b65-7390-4083-813c-2d0785823bb7`; fingerprint `sha256:3ef5a406...` |

### 2. Publish versions — PASS

Each publish used an empty JSON body and a label-specific idempotency key. Every response preserved definition/version lineage, returned `status=published`, and had non-null `published_at`.

| Definition  | Request                                                                          | Status | Key response                                                                                   |
| ----------- | -------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Environment | `POST /api/v1/environment-versions/d0823b65-7390-4083-813c-2d0785823bb7:publish` | 200    | same definition/version; published                                                             |
| Lead        | `POST /api/v1/agent-versions/7ef2a405-d1fb-4090-8e00-9a1f3b459b94:publish`       | 200    | definition `6eae5ed6-...`; published                                                           |
| Worker      | `POST /api/v1/agent-versions/02ad1f07-17a7-4c28-85d1-e224cf207b32:publish`       | 200    | definition `be11dc9b-...`; published                                                           |
| Reviewer    | `POST /api/v1/agent-versions/710a1cc6-213f-45ea-a882-baa45f49ac19:publish`       | 200    | definition `60bf7e85-...`; published                                                           |
| Team        | `POST /api/v1/team-versions/38cd045c-49fb-42a1-ad6c-0569f265fba2:publish`        | 200    | definition `e8031947-...`; exact Environment/Lead/Worker/Reviewer versions retained; published |

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

Other non-API evidence was limited to Compose/container health, logs, mount ownership, committed-code inspection, and configured timeout values after API-observed failures. PostgreSQL/agent-server logs were read only to explain the 09:35 UTC HTTP outage. Those checks diagnosed causes; they did not advance the journey or supply product records. No database query was used during the final successful WorkRun/trace/read-surface verification.
