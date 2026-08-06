# Persistent Lead RuntimeSession MCP tool-refresh probe

## Outcome

**Dynamic-catalog design failed; static-catalog/dynamic-grant variant passed.** Paseo/OpenCode did not refresh the provider Agent's MCP tool catalog on continuation after the stable server-side grant changed and the MCP server called `sendToolListChanged()`. A third real probe then registered the full canonical Lead catalog at creation and proved that server-side grants can safely vary call authority across continued turns.

This evidence blocks Solution A exactly as drafted and supports a differently shaped static-envelope variant. No ownership implementation was started; Manager re-scope remains required.

## Initial run — non-decisive

- Local date: 2026-08-06 (Asia/Shanghai)
- UTC interval: 2026-08-05T16:19:43.227Z to 2026-08-05T16:20:05.418Z
- Branch/starting HEAD: `agent/team-ergonomics` / `31e9e152cea027b95a34ec69008277c94799205a`
- Model: `opencode-go/deepseek-v4-flash`
- Paseo: `0.1.110`
- OpenCode: `1.18.4`
- Provider Agent ID: `ed55e17d-0bb0-413e-b642-f5678856ef26`
- Paseo Workspace ID: `wks_24cb3e26d129cdc6`
- MCP session ID: `bae122fe-15e6-47cd-b624-ec913dc93fbf`
- Stable bearer: yes; the value was not logged
- Provider Agent distinct count: 1
- Raw local artifact: `.local/probe/persistent-lead-tool-refresh-2026-08-05T16-19-43-227Z-11599/evidence.json`
- Raw artifact SHA-256: `f1370dd01f51b564c35aa5fd88375d601db05545b7e168e277bd6f64900d4c05`

## Procedure and observations

One real OpenCode Agent was created with one HTTP MCP server and one stable bearer. The server registered the canonical Lead command names and atomically changed which registrations were enabled before every MCP request.

1. Epoch 1 authorized only `team_work_create`. OpenCode initialized MCP, called `tools/list` once, saw the create tool, and the model successfully called it.
2. Epoch 2 authorized only `team_work_accept` and `team_work_request_changes`. A direct `tools/call` for revoked `team_work_create`, sent to the exact provider MCP session, returned MCP error `-32602` with `Tool team_work_create disabled`. The model then reported that `team_work_accept` was unavailable and that only `team_work_create` was exposed.
3. Epoch 3 authorized only `team_finish`. The model reported that `team_finish` was unavailable and that only `team_work_create` was exposed.

Observed `tools/list` epochs: `[1]`. No `tools/list` request arrived during epochs 2 or 3. Successful model tool calls were only `["1:team_work_create"]`; neither the review-class nor finish-class command was callable by the continued Agent.

The provider timeline contained three user turns on the same Agent. Turn 1 contained a successful `tool_call`; turns 2 and 3 contained reasoning and assistant messages but no tool call.

The Manager correctly identified that this run did not emit `notifications/tools/list_changed`. A compliant client was not required to poll spontaneously, so this initial negative result alone did not decide whether OpenCode supports dynamic catalog refresh.

## Corrected notification run — decisive

- Local date: 2026-08-06 (Asia/Shanghai)
- UTC interval: 2026-08-05T16:26:12.962Z to 2026-08-05T16:26:29.194Z
- Branch/starting HEAD: `agent/team-ergonomics` / `b827ce70fe5a7420d4c8023fafba20c0141eb4f9`
- Model: `opencode-go/deepseek-v4-flash`
- Paseo: `0.1.110`
- OpenCode: `1.18.4`
- MCP SDK: `1.30.0`
- Provider Agent ID: `41ca9dec-d997-4964-9a63-b7973ef82665`
- Paseo Workspace ID: `wks_b44084140eb35083`
- MCP session ID: `654dd3f8-6adc-4224-905b-1895b0a6600e`
- Stable bearer: yes; the value was not logged
- Provider Agent distinct count: 1
- Process exit code: `2`, the intended probe-gate failure code
- Raw local artifact: `.local/probe/persistent-lead-tool-refresh-notified-2026-08-05T16-26-12-962Z-15092/evidence.json`
- Raw artifact SHA-256: `31926c62f033c811625b4b092fb43fa4de2216857fec6cdbf3793ec4c60e63e7`

The corrected run changed the protocol experiment in exactly one respect: immediately after each atomic grant/registration switch, it called `McpServer.sendToolListChanged()` on the existing server/session before the next `sendAgentMessage`. Cleanup used the installed `DaemonClient.close()` method.

Machine-written evidence markers:

- `"passed": false`
- `"providerAgentDistinctCount": 1`
- `"bearerStable": true`
- two `notificationLog` records whose `method` is `notifications/tools/list_changed`, at epochs 2 and 3 on the same MCP session
- `"listEpochs": [1]`
- `"successfulModelCalls": ["1:team_work_create"]`
- revoked epoch-2 create call: `"rejected": true` and `"sameProviderMcpSession": true`

Despite both notifications, no `tools/list` request arrived after epoch 1. The model successfully called `team_work_create` in epoch 1, then explicitly reported that only `team_work_create` remained visible in epochs 2 and 3. It did not call `team_work_accept` or `team_finish`.

## Standalone provider limitation

Paseo `0.1.110` with OpenCode `1.18.4` does not re-list MCP tools on a continued provider Agent, even when its live MCP session receives a spec-compliant `notifications/tools/list_changed` notification from `@modelcontextprotocol/sdk` `1.30.0`. Designs using continuation must treat the creation-time MCP catalog as immutable.

This is a catalog limitation, not an authorization limitation: MCP tool handlers on the same provider session still enforce the current server-side grant for every call.

## Variant 3 — static full Lead catalog, dynamic grant

- Local date: 2026-08-06 (Asia/Shanghai)
- UTC interval: 2026-08-05T16:31:23.812Z to 2026-08-05T16:31:46.755Z
- Branch/starting HEAD: `agent/team-ergonomics` / `0225671224a25abd2a7c2aa75c084441e19e2047`
- Model: `opencode-go/deepseek-v4-flash`
- Paseo: `0.1.110`
- OpenCode: `1.18.4`
- MCP SDK: `1.30.0`
- Provider Agent ID: `feac706f-5ba2-45ef-ad13-bbe1b5507370`
- Paseo Workspace ID: `wks_25145e9972a12e33`
- MCP session ID: `ee9974f9-9ed3-4bc2-bea7-47b45244135a`
- Stable bearer: yes; the value was not logged
- Provider Agent distinct count: 1
- Process exit code: `0`
- Raw local artifact: `.local/probe/persistent-lead-static-catalog-2026-08-05T16-31-23-812Z-18086/evidence.json`
- Raw artifact SHA-256: `98da1d629e74548d92e607d2ec803a18daba432d2cac120486519663bcf3feed`

The creation-time catalog contained the full seven-tool Lead envelope: `team_state`, `team_work_list`, `team_message_send`, `team_work_create`, `team_work_request_changes`, `team_work_accept`, and `team_finish`. Registrations stayed enabled and the provider listed them only at epoch 1. Only the server-side grant changed:

1. Epoch 1 allowed create. The model successfully called `team_work_create`, then deliberately called unauthorized `team_finish` and received `{"error":"not_allowed","command":"team_finish","epoch":1}` with `isError: true`.
2. Epoch 2 allowed accept/request-changes. The model successfully called `team_work_accept`, then deliberately called unauthorized `team_work_create` and received `{"error":"not_allowed","command":"team_work_create","epoch":2}` with `isError: true`.
3. Epoch 3 allowed finish. The model successfully called `team_finish`.

Machine-written evidence markers:

- `"passed": true`
- `"providerAgentDistinctCount": 1`
- `"bearerStable": true`
- `"listEpochs": [1]`
- `"successfulModelCalls": ["1:team_work_create", "2:team_work_accept", "3:team_finish"]`
- `"rejectedModelCalls": ["1:team_finish", "2:team_work_create"]`
- `"wastedTurnsRetryingRejectedTools": false`
- `"rejectedRetryCounts": {"1:team_finish": 1, "2:team_work_create": 1}`

The model reacted sensibly to both authorization errors: it reported each rejection accurately, did not retry, did not loop, and completed the required authorized action in every turn.

## Gate conclusion

The corrected notification probe establishes that Paseo/OpenCode retains the initial MCP catalog across `sendAgentMessage` continuation. Therefore the draft's dynamic-catalog form is not viable.

Variant 3 establishes that a static full Lead catalog plus a per-turn server-side grant preserves dynamic authority on one continued Agent. This passes the requested feasibility probe but does not authorize ownership implementation. The launch snapshot, zero-tool inter-turn grant invariant, and remaining implementation gates require Manager re-scope first.

## Harness note

The initial evidence file was written before a probe-only cleanup call used a nonexistent `DaemonClient.disconnect()` method and caused process exit 1 instead of the intended gate-specific exit 2. This occurred after all three turns, timeline fetch, assertions, and evidence persistence. The exact Paseo process started by the initial probe was then terminated and verified absent.

The corrected rerun used `DaemonClient.close()`, returned the intended exit code `2`, and left no managed probe process running.

Variant 3 also used `DaemonClient.close()`, returned exit code `0`, and left no managed probe process running.
