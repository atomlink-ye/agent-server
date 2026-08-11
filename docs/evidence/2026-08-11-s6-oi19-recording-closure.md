# S6 OI-19 and product-recording closure evidence

Recorded on 2026-08-11 against the Lane B sandbox PostgreSQL database. This
packet intentionally excludes transcripts, provider credentials, environment
values, and raw `run_events.payload` content.

## Outcome

- OI-19 is implemented and verified on real PostgreSQL. A successful provider
  Run without canonical submit now has an explicit, externally visible
  `stop_reason` instead of leaving the Team indefinitely `active`.
- The normal-submit provider path also reached a genuine terminal Team:
  `status=succeeded`, `phase=done`, `control_state=terminal`,
  `stop_reason=NULL`, and `lead_turn_count=4`.
- No product-projection recording bundle was produced. The final clean recorder
  attempt was correctly rejected as `scenario_predicate_timeout`; an official
  after-the-fact capture of the prior successful Run was then rejected by the
  fail-closed sanitizer. No fixture was constructed or manually edited.

## Genuine successful Run

```text
team_run_id=9ccbce64-ed68-4e2f-9127-9734fe2b3f3a
root_task_id=90afbd54-d1cc-4a34-843f-fae40c7b8c99
status=succeeded
phase=done
control_state=terminal
stop_reason=NULL
lead_turn_count=4
created_at=2026-08-11T01:03:15.568Z
updated_at=2026-08-11T01:07:07.023Z
```

The projected API returned two accepted Work items and provider/model
`opencode/opencode-go/deepseek-v4-flash`. PostgreSQL contained these completed
attempts:

```text
25fad50d-2449-4922-b05f-3208dbcceafd  work=359afd43-a9ed-4387-927e-32904af5edd6  attempt=1  completed  01:04:12.842Z..01:05:49.053826Z
e1785c7e-67ed-4f5d-98b6-9b6c868383e9  work=0feba513-8199-4a95-a7a9-29d304793533  attempt=1  completed  01:04:13.770Z..01:06:03.949459Z
a1c82ad2-ca5c-4cac-9f34-fb1c4c6fadc2  work=359afd43-a9ed-4387-927e-32904af5edd6  attempt=2  completed  01:06:24.750Z..01:06:41.813076Z
```

The first attempts overlap in time, providing real parallel-execution evidence.
The Team's `stop_reason=NULL` distinguishes normal submit convergence from the
OI-19 non-absorbing `work_abandoned` escape path.

## Final bounded recorder attempt

```text
team_run_id=20171966-2507-4fdf-a554-18f929a15d4c
root_task_id=30c602f3-53a4-47a0-9908-7521d82e87c0
status=succeeded
phase=done
control_state=terminal
stop_reason=work_abandoned
lead_turn_count=3
RECORDER_EXIT=1
SANDBOX_CTL_RC=1
failure=scenario_predicate_timeout
```

Both member attempts failed after approximately 62 seconds. The API process was
independently checked to have both `PASEO_SESSION_RPC_TIMEOUT_MS=300000` and the
patched `@getpaseo/client` file loaded. Raising the recorder predicate wait or
Team terminal window cannot turn this already-terminal Run into accepted Work.
Per Owner direction, no further timeout patch or image rebuild was attempted.

## After-the-fact capture result

The repository's official `capturePreIdentity` function was invoked against the
genuine successful Run above. Its DB predicate passed, but capture stopped before
publishing a directory with:

```text
RecordingSecretError
code=recording_secret_detected
reason=sensitive_value
path=run_events.<redacted-event-id>.payload.detail.content
CAPTURE_EXIT=1
SANDBOX_CTL_RC=1
```

The flagged content was neither printed nor copied into this packet. The
sanitizer was not loosened, and no assembled bundle was presented as a clean
recorder artifact.

### Why degradation level ② was skipped

Level ② (assemble a provenance-labelled bundle from real DB rows) was **not
executed**. The conclusion that it would hit the same gate is a code inference,
not an empirical validation of a level-② artifact. Both the official capture
path and the independent validator pass `db/run_events.json` payloads through
`sanitizeRunEventPayload`, which delegates every string to the same
`SECRET_VALUE` check. The offending persisted event would therefore be rejected
again unless the assembled data were redacted, removed, or the sanitizer were
changed. Those actions would either stop being an unmodified DB-row assembly or
violate the instruction not to loosen/edit around the safety gate. For that
reason the work moved directly from the failed official capture (①) to the
evidence-only closure (③), without claiming that ② had been run.

### Sensitive-value hit classification

The persisted value itself was never printed, logged, written to this file, or
sent through the companion channel. Read-only SQL and an in-container equality
probe returned only these shape facts:

- Rule: `SECRET_VALUE`, specifically the alternative matching a credential-like
  label followed by `:` or `=` and a non-whitespace value. The Bearer-token and
  local-filesystem-path alternatives did not match.
- The complete `detail.content` string is 7,843 characters, printable text, and
  is not a single base64-like or all-uppercase-underscore token.
- It contains two matches. Their labels are `authorization` and `token`; each
  matched right-hand candidate is 10 characters. Neither candidate is
  base64-like, while both have a local/test-style marker.
- A comparison performed without emitting either side found that neither
  candidate contains any configured provider credential or the configured
  local service-account token.
- Event shape: `run_events.type=output`, payload `kind=tool_status`,
  `detail_kind=read`, `category=read`. Its Run belongs to a `work_attempt`.
  This is provider-generated read-tool output persisted as an output event, not
  a lead prompt and not runtime metadata.

**Classification: pattern false positive, not credential persistence.** The
generic assignment-text rule encountered credential-shaped example/local text
inside a long read-tool result. This does not justify weakening the safety rule;
it identifies a fixture/sanitizer representation issue for a later recording
round. No fix is included here.

## Relevant commits

- `dba5245` — OI-19 state transition and real-PostgreSQL race coverage.
- `c46d0ea` — `EXECUTION_BUDGET_EFFECTIVE` use-point observability.
- `c71ab7c` — configurable Paseo client session RPC timeout, default unchanged.
