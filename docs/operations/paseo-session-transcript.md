# Paseo session-transcript diagnostics

Status: **internal diagnostics only**. This command is a read-only operator aid
for inspecting a bounded tail of a Paseo session associated with a TeamRun. It
is not a product feature, observability contract, or frontend data source.

Run it with the repository command surface:

```bash
pnpm paseo-session-transcript -- --team-run <uuid>
```

The optional `--member <name>` flag addresses one roster member by its member
name, and `--json` selects machine-readable output. The roster `role` is only
metadata used to label or address a member; it is not the unit of transcript
storage or retrieval. The diagnostic resolves the member's provider session
through the TeamRun RuntimeSession's current active generation, then fetches
that session's Paseo timeline tail.

## Boundary and evidence

The diagnostic reads two sources only:

- the local database path from `team_member_runs` through
  `runtime_sessions.current_generation_id` to an active
  `runtime_session_generations.provider_session_id`;
- Paseo's declared `fetchAgentTimeline` interface with a tail limit of 200.

Product contracts use durable `run_events` for product-facing execution history.
This diagnostic does not write, backfill, or join `run_events` into the Paseo
timeline, and its derived summaries are not product contract fields.

Paseo's stored timeline does not include the live permission and usage stream
events. Historical permission activity is therefore neither subscribed nor
replayable by this diagnostic: a post-run read must not claim that it recovered
permission history. The live stream is not persisted here.

The command reports only the fetched tail. When Paseo indicates older entries,
the output marks the tail as truncated and exposes the opaque cursor without
following it. Historical turn counts are intentionally unavailable because the
timeline does not expose turn boundaries.

## Required environment

`DATABASE_URL` is required and must point to the Agent Server database that
contains the TeamRun RuntimeSession and current active generation. `PASEO_WS_URL` may override the
Paseo WebSocket endpoint; when omitted, the command uses
`ws://127.0.0.1:16767/ws`.

The configured Paseo daemon and database must be reachable from the process.
The command performs no writes to either system.
