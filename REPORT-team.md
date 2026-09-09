# Team Work live validation

Date: 2026-09-09

## Scope and evidence

This used real Claude execution through the local Paseo daemon, not fixtures or direct Team-table writes. Before the run, the demo database was backed up to `/tmp/agent_server_demo_before_team_20260909_100638.sql`.

The primary Work was `Live two-member Team UI validation`:

- Work: `f6b4ad45-aff2-4b1e-a5e0-8ad0d9b76fff`
- WorkRun: `11c1f1f4-4c1b-4502-861e-da822b300f91`
- root Task: `41bdf859-0353-415d-8861-6426bded15b2`
- TeamRun: `42e4272c-b57a-4499-a194-73c532bef676`
- Runtime model displayed by Observe: `claude-sonnet-5`

The Work was admitted through the public Worker, Environment, Team, WorkDefinition, Work, and WorkRun APIs. The terminal database facts are:

```text
team_runs               1
team_member_runs        3  (lead, fixer, reviewer)
team_work_items         2
team_work_item_attempts 2  (both completed)
team_messages           3  (lead→fixer, lead→reviewer, fixer→reviewer)
```

The two Work Item attempts overlapped: fixer ran from `10:11:34` to `10:11:52`, reviewer from `10:11:39` to `10:11:55` (+08:00). Both were real Claude runs and both completed.

For a dependency-specific Map check, a second real WorkRun completed with `W-2` declared to depend on `W-1`:

- Work: `dd95cb8c-cf56-4cc1-ade1-87696142ca41`
- WorkRun: `7864cceb-0b96-4c87-8c6d-876f3ded7283`
- TeamRun: `3f630816-758c-47b5-ad92-21d76ff63770`

The 1440px screenshots are intentionally retained as one-run evidence under ignored `.local/team-ui-screens/`, rather than committed as repository product truth:

- `observe-timeline-after-fix.png` — chronological events and execution lanes
- `work-transcript-fixer.png` / `work-transcript-second-agent.png` — member selector and two selected logs
- `dependency-map.png` — two attempt nodes and real dependency

## Four questions

### a. Timeline — **勉强能用**

The upper Activity list is one chronologically interleaved stream. The lower Execution lanes section is one lane per captured actor (`fixer`, `reviewer`, `lead`), and shows the overlapping fixer/reviewer spans. The combination is enough to determine who acted when, but the event list itself is dense and does not filter to a member.

The real run exposed three lifecycle rows whose local sequence was all `Event 1`. This was an attribution presentation bug, not duplicate data: each provider-local Run starts its own sequence. It is fixed in this change: lifecycle labels now retain the captured actor (for example, `fixer · Run started`). Severity: **medium** before fix; **resolved**.

### b. Different Agent logs — **能用**

Transcript has a clear `fixer / reviewer / lead` selector with role, terminal session status, and entry count. Selecting a member changes the captured conversation, work-reference filter, tool count, latest activity summary, and agent-to-agent messages. The Execution Inspector also names the selected attempt's Agent and offers Overview, Conversation, and Activity.

Limit: the shared Timeline Activity list has no per-member filter. This makes focused analysis less efficient, but the Transcript selector is a usable dedicated route.

### c. Transcript selection — **能用**

The selection entry point is explicit and stable: three agent buttons at the top of `What the Workers did`, addressed by durable team-member identity rather than list position. The real screenshots show fixer and reviewer switching correctly.

Agent-to-agent routing is visible, but direct-message body capture is intentionally redacted in the UI (`Message content was not captured`). This is honest capture behavior, not a UI fabrication. Severity: **low limitation**.

### d. Collaboration relationships / Map — **勉强能用**

With real attempts, the Map renders two attempt nodes with their real assignees and statuses. The dependency validation run additionally renders `DEPENDENCY Dependency source → Dependency target`, alongside assignment and message relations. The persisted dependency and the displayed edge agree.

The view is a node board plus a textual captured-relations list; it does not draw connector arrows between nodes. It is accurate and inspectable, but the word “Map” overpromises a little for quick graph-reading. Severity: **low usability gap**.

## Additional findings

### Coordination activity was mislabeled — **medium, fixed**

The lead owns no Work Item by design; its `board_create`, `board_accept`, and `collaboration_finish` actions are Team-level coordination. MCP Activity previously called every activity without a Work Item `Work Item not captured`, which implied missing data. It now says `Team-level action`; no nonexistent Work Item is invented.

### Observe Agent filter excludes Team actors — **medium, not changed**

This is a confirmed capability gap, not a data failure. `useObserveRoster` loads Coworker profiles and filters Work by each Coworker's published WorkDefinition capability. It intentionally keeps that roster distinct from actual trace/session actors, so the select lists Ada/Maya but not the real `lead`, `fixer`, and `reviewer` Team members. The Work cards still display the three participants, but an operator cannot select a Team member in Observe to narrow results. No change was made per request.

## Verification

- `pnpm exec vitest run --config vitest.web.config.ts apps/web/src/features/run-trace/transcript-presentation.test.ts apps/web/src/features/run-trace/events.browser.test.tsx` — passed (2 tests).
- `pnpm test:unit` — expected known local baseline: 1067 passed, 4 skipped; `tests/unit/host-native-require-native-postgres.test.ts` remained red because native PostgreSQL is installed and reachable, matching the stated exception.

