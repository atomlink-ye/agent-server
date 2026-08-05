# Persistent Lead RuntimeSession MCP tool-refresh probe

## Outcome

**FAIL — Human Gate triggered.** Paseo/OpenCode did not refresh the provider Agent's MCP tool catalog on continuation when the stable server-side grant changed. Server-side revocation remained effective.

This evidence blocks the persistent Lead RuntimeSession implementation described in `DESIGN-DRAFT-2026-08-05-persistent-lead-runtime-session.md` section 6.3. No ownership implementation was started after this result.

## Run

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

## Gate conclusion

The server correctly re-authorizes every request and rejects revoked tools, but Paseo/OpenCode retains the initial MCP catalog across `sendAgentMessage` continuation. Therefore the section 6.3 requirement that newly authorized review and finish tools become visible is not met.

Per the approved slice gate, this result does not authorize a refresh/reconnect mechanism, Paseo/OpenCode upgrade, new runtime port, or ownership implementation. Manager direction is required before proceeding.

## Harness note

The evidence file was written before a probe-only cleanup call used a nonexistent `DaemonClient.disconnect()` method and caused process exit 1 instead of the intended gate-specific exit 2. This occurred after all three turns, timeline fetch, assertions, and evidence persistence. The exact Paseo process started by the probe was then terminated and verified absent. The cleanup defect does not change the recorded protocol observations.
