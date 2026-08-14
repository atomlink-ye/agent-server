# C4 feedback provenance report

**Status: closed — `BRANCH_2_OVERBROAD_REDACTION`**

The sole supported branch is that the Product projection turns durable
application feedback into presence-only data. This is not a recorder sanitizer
deleting feedback. The distinguishing fact is direct: the captured Postgres
row for attempt `524401a1-fd03-4dfa-93c7-621452a5e71d` contains the feedback
string, while the Product API projection for that same attempt has
`feedback_summary: null` and `feedback_capture_status: "redacted"`.

## Questions answered

1. **Why is `feedback_summary` null: did D10/D12 sanitization remove it, or
   did the scenario not produce feedback?**

   It was produced and persisted. The request-changes input, command-service
   value, Postgres insert, and recorder DB snapshot all carry the application
   feedback. The Product projection deliberately queries only
   `feedback_present`, then maps presence to `redacted` and maps the summary to
   `null`. The recorder's sanitizer is not the cause: its SQL snapshot contains
   the original `feedback` string, and `feedback` is not a `SECRET_KEY` pattern.

2. **Does this require exact provider prompt/token/tool-call transcript
   evidence, or can the branch close from the application fact?**

   The branch closes from the durable application fact. Exact provider
   token/tool-call transcript is not required to establish whether the
   `team_work_item_attempts.feedback` fact was produced. The evidence only
   supports the narrower claim that the application feedback exists and is
   projected presence-only. If a provider transcript is absent, that is noted
   narrowly as “provider transcript not captured”; it is not evidence that the
   application feedback was absent.

## Source-to-storage-to-projection chain

The original live scenario prompt is the `rework-once` script itself. The
feedback instruction is exact (`scripts/record/product-projection-real-run.mjs:141-156`):

```js
function scenarioInstructions(scenario, role, mode) {
  if (role !== 'lead') {
    if (scenario === 'rework-once' && role === 'projection-worker')
      return 'Use only canonical Team tools. On attempt 1, submit exactly marker WORKER_SUBMIT_V1 and omit ACCEPTANCE_SENTINEL. After request_changes feedback, submit exactly WORKER_SUBMIT_V2 ACCEPTANCE_SENTINEL. Never repeat a successful submit.';
    if (scenario === 'rework-once' && role === 'projection-reviewer')
      return 'Use only canonical Team tools. Submit marker REVIEW_REJECT with exact blocking reason "worker attempt 1 omits ACCEPTANCE_SENTINEL". Never accept Work and never repeat a successful submit.';
    if (scenario === 'parallel-success' || mode === 'state-canary')
      return `HARD GATE: Pure prose is invalid. You are ${role}; use only canonical Team tools. Do not end until the real canonical team_work_submit call returns a successful receipt; text does not substitute for that tool call. Complete the assigned Work, call team_work_submit exactly once successfully, and never repeat a successful submit. Scenario is ${scenario}.`;
    if (scenario === 'lead-never-accept')
      return `HARD GATE: Pure prose is invalid. You are ${role}; use only canonical Team tools. Complete the assigned Work, call team_work_submit exactly once, and do not end until that real call returns a successful receipt. Never repeat a successful submit.`;
    return `You are ${role}. Use only canonical Team tools. Complete the assigned Work and submit a concise bounded result. Scenario is ${scenario}.`;
  }
  if (scenario === 'parallel-success')
    return 'Act as lead using only canonical Team tools. HARD CARDINALITY GATE: the final board must contain exactly two Work items total, never three. Inspect the initially empty board, call team_work_create exactly twice total—once for projection-worker-a and once for projection-worker-b—and never call team_work_create again after those two receipts. Make the two Work items independent, with descriptions that each require the assignee to make the real canonical team_work_submit call and wait for its successful receipt; pure prose is invalid and text never substitutes for the call. Wake both, accept both completed submissions, verify the board still contains exactly two accepted Work items, then finish exactly once. Do not use provider subagents or shell.';
  if (scenario === 'rework-once')
    return 'Act as lead using only canonical Team tools. On the empty board create exactly two independent Work items: work-1 assigned to projection-worker requiring ACCEPTANCE_SENTINEL, and work-2 assigned to projection-reviewer requiring review of that exact sentinel rule. After both first submissions, accept reviewer work, then request changes exactly once on worker work with feedback "worker attempt 1 omits ACCEPTANCE_SENTINEL". Accept worker work only when attempt 2 contains WORKER_SUBMIT_V2 ACCEPTANCE_SENTINEL, then finish exactly once. Never repeat a successful mutation.';
```

The value then crosses these bounded layers:

| Layer | Evidence | What it proves |
|---|---|---|
| MCP input | `src/adapters/team-mcp/team-mcp-tools.ts:156-174` | `requestChanges` accepts `feedback: z.string().min(1)` and passes the exact input to the command. |
| Command service | `src/application/teams/team-command-service.ts:179-207` | The lead-authorized command forwards `input.feedback` to `repo.requestRework`; the returned command response uses `safeText(result.feedback)`. |
| Durable write | `src/infrastructure/postgres/postgres-collaborative-team-repository.ts:1515-1525,1652-1664` | `requestRework` accepts the feedback and inserts `input.feedback` into `team_work_item_attempts.feedback`. |
| Recorder SQL | `scripts/record/lib/capture-product-run.mjs:18-24` | The recorder selects `a.feedback` in `team_work_item_attempts`. |
| Product facts query | `src/infrastructure/postgres/postgres-work-projection-facts-query.ts:50-63,136-150` | The Product read model intentionally selects `(a.feedback IS NOT NULL) AS feedback_present`, not the text. |
| Facts mapper | `src/infrastructure/postgres/postgres-work-projection-facts-query.ts:194-207` | The fact becomes `feedbackCapture: present/absent`. |
| Product projection | `src/application/product-projection/work-projection-facts-source.ts:93-113` | `feedback_summary` is unconditionally `null`; `feedback_capture_status` is derived from presence as `redacted` or `not_present`. |
| Route contract | `src/entrypoints/api/routes/product-work.ts:93-109` | The route parses the already-derived Product response; it does not recover the durable feedback text. |
| Lineage | `src/contracts/product-projection/lineage-manifest.ts:492-506,527-553` | `feedback_capture_status` is `presence_to_redaction_status` from `team_work_item_attempts.feedback`; `feedback_summary` is `capture_to_null` from the same source. |

## Recorder and sanitizer check

The recorder proves the provenance distinction rather than causing the loss:

- `capture-product-run.mjs:146-213` asserts the `rework-once` predicate from
  DB rows. It requires a later completed attempt with non-empty `row.feedback`,
  so the scenario cannot pass its recorder predicate without a feedback fact.
- `capture-product-run.mjs:224-240` runs `sanitizeRecording` while writing each
  API/DB document. This is downstream of the Product API response and DB query;
  it does not rewrite the source database.
- `capture-product-run.mjs:459-566` captures the API responses and the SQL
  snapshots, including `db/team_work_item_attempts.json`, into the recording.
- `sanitize-recording.mjs:3-6` classifies keys such as `authorization`,
  `token`, `model`, `prompt`, and provider payloads as sensitive. `feedback`
  is not in `SECRET_KEY`.
- `sanitize-recording.mjs:149-204` only redacts a sensitive key/value and
  otherwise recursively preserves the value (with control-character cleanup,
  whitespace normalization, and length limiting). The captured DB feedback is
  therefore evidence of the pre-sanitizer durable value, not evidence of a
  sanitizer deletion.

## Actual JSON field-access observations

Observed recording root:

`tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/artifacts/w-rec-rerecord-two-scenarios/rework-pull/recording-artifacts/wrec-rerecord-current/rework-once/20260814T010607741Z-4345ef71-2138-42e5-bc44-b03efdef65b1/`

- `db/team_work_item_attempts.json`, attempt
  `524401a1-fd03-4dfa-93c7-621452a5e71d`: `feedback` is exactly
  `"worker attempt 1 omits ACCEPTANCE_SENTINEL"`; `status` is `"completed"`.
- `api/work-run.json`, the same attempt ID: `feedback_summary` is `null` and
  `feedback_capture_status` is `"redacted"`.
- `api/work-run.json`, the first worker attempt and the reviewer attempt have
  `feedback_capture_status: "not_present"`; their corresponding DB rows have
  `feedback: null`. This is consistent with presence mapping and distinguishes
  absence from the second attempt's durable feedback.
- `api/trace.json` contains one `kind: "feedback"` edge for the same attempt,
  with the lead as reviewer, plus the corresponding ordered observed message.
  The edge corroborates the application relation but does not expose its text.
- `manifest.json` records `provider_run: "real"`, provider kind `"opencode"`,
  model `"opencode-go/deepseek-v4-flash"`, the real recording file hashes and
  timestamps/row counts. The real-provider declaration and trace edge/events
  corroborate that this is a live-run recorder output, not a hand-written
  feedback example.

`status: "redacted"` is derived from `feedback_present`; it is not evidence
that a recorder sanitizer deleted the summary, and it is not evidence that the
durable feedback was deleted.

## Branch decision

| Branch | Decision | Evidence | Counterevidence / reason |
|---|---|---|---|
| `BRANCH_1_PROVIDER_DERIVED_REQUIRED_REDACTION` | Rejected | D10/D12 exclude provider raw payload, prompt, and credentials; D18.2 allows MCP return values to remain capture-status-only. | This is durable application feedback supplied to `requestChanges`, not a provider raw payload or prompt. D12 does not require ordinary application feedback to become presence-only. The scenario's prompt-derived instruction is not itself the raw prompt/payload, and cannot be used to relabel the persisted feedback as provider transcript content. |
| `BRANCH_2_OVERBROAD_REDACTION` | **Selected; sole closed branch** | DB has the exact feedback; Product facts query reads only presence; mapper emits `null` plus `redacted`; lineage explicitly names `presence_to_redaction_status` and `capture_to_null`. | No contradictory evidence in the recorder. The DB snapshot and API snapshot differ exactly at this projection boundary. |
| `BRANCH_3_NOT_PRODUCED` | Rejected | `team_work_item_attempts.feedback` for `524401a1…` is a non-empty string; the recorder predicate also requires a non-empty later feedback row. | `not_present` on the other attempts is a separate null fact and does not apply to attempt 2. |
| `MISSING_EVIDENCE` | Rejected for the question “was the feedback fact produced?” | The durable DB row is direct evidence, and the trace's feedback edge corroborates the relation. | Exact provider token/tool-call transcript is not required for this question. If such transcript is absent, the narrow statement is only “provider transcript not captured,” not “feedback was not produced.” |

## Authority alignment

- **D10** (`authority/DECISIONS.md:111-129`) requires first proving each
  predicate on a live real provider Run and then recording that Run; it forbids
  hand-written fixtures. `manifest.json` declares `provider_run: "real"` and
  includes the real provider/model and recording metadata.
- **D12** (`authority/DECISIONS.md:132-141`) requires complete API responses
  plus related DB snapshots and real `work_run_id`/timestamps, while excluding
  provider raw payload, prompt, and credentials. It does not classify durable
  application feedback as provider raw material. The recording has both the
  API response and `team_work_item_attempts` snapshot needed to compare them.
- **D18** (`authority/DECISIONS.md:198-252`) makes MCP scheduling/confirmation
  the structured timeline source, keeps execution details in Chat Detail, and
  requires MCP return values to use capture status rather than inline full
  text. That authority does not authorize collapsing every durable
  application input into presence-only data. Here the feedback relation is
  observable as an MCP-derived edge, while the application feedback content
  is the over-broadly suppressed field.

## Narrow caveat

The existing recorder-contract review records a separate current-schema
validator caveat: older positive recorder trace documents can be rejected by
the current full `ProductRunTraceResponseSchema` parse. That is a fixture/
validator compatibility issue and must not be overstated as evidence about
feedback production or sanitizer behavior. It does not change this branch
decision, which is based on the independently inspected DB snapshot, API
snapshot, source code, and lineage rules above.

**Final verdict: `BRANCH_2_OVERBROAD_REDACTION`.**
