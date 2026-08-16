# Agent Server Developer API

The recommended MVE Product API is intentionally small:

```text
Work Definition -> Work -> WorkRun -> Run Trace / result
```

Start here:

- [Quickstart](quickstart.md) — one `work.yaml` + API token -> real WorkRun.
- [Work Definition](work-definition.md) — validate / plan / apply / immutable versions.
- [Work](work.md) — durable Product Work identity.
- [Run](run.md) — typed input, WorkRun state and Trace.
- [Errors](errors.md) — safe diagnostics and retry guidance.

Advanced Agent / Environment / Team registry APIs remain available, but they are not the first-run developer contract. Internal Task, technical Run, TeamRun, MemberRun and RuntimeSession APIs are implementation/debug surfaces rather than Product identity.
