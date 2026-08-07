---
status: active
owner: orchestrator
created_at: 2026-08-07
updated_at: 2026-08-07
authority: execution-plan
---

# Mixed-provider Team and Python rework proof

# Outcome

Run one real Agent Teams v2 `TeamRun` in the prepared `agent-server-mixed`
sandbox so Lead, fixer, and reviewer execute under OpenCode, Claude Code, and
Codex respectively in one Paseo workspace. The Team must produce an
approximately 100-line Python file through a rejecting review and at least one
fixer rework attempt, with persisted and machine-written evidence plus a visual
Paseo Web confirmation.

## Context and authority

- Authoritative brief:
  `tasks/active/agent-server-implementation-20260722/BRIEF-mixed-team-and-python-rework.md`
  in the 0xdtech org workspace.
- Repository authorities: `AGENTS.md`, `docs/agents.md`, the Agent Teams v2
  contract, Orchestration Kernel component, Paseo Runtime Adapter component,
  and Runtime contract.
- Baseline: `origin/master@2e6931b` plus `08a6c24`, `330e1d2`, `bb30c8b`, and
  `215aad4` on branch `agent/mixed-team`.
- Predecessor: PR #32 implemented closed-set per-member provider resolution and
  added durable provider query output to the existing Team smoke. This slice
  must prove real execution, not merely policy resolution or scripted runtime.
- Stage: Prove. The brief is the approved design of record; no separate design
  artifact is retained.
- Appetite: one narrow real TeamRun and the exact required supporting commands.
- Real path: sandbox seed -> published Agent/Environment/Team versions -> Task
  admission -> TeamDriver -> three real Paseo provider agents -> shared Paseo
  workspace -> Python artifact -> persisted Run/Work/attempt rows -> Paseo Web.
- Highest unknown: whether all three real provider agents obey the bounded Team
  protocol and complete a forced reject/rework cycle while sharing the intended
  workspace and filesystem artifact.
- Hill status: validated prerequisites; real mixed-provider execution remains
  unproven.

## Scope

- Adapt the existing `.local/seed-team.mjs`; do not create a parallel seed.
- Publish Lead with `free-only`, fixer with `claude/deepseek-v4-flash`, and
  reviewer with `codex/deepseek-v4-flash`.
- Run exactly one primary Work item that asks the fixer to create an
  approximately 100-line Python file in the shared Team workspace.
- Require manager assignment, fixer submission, reviewer rejection, fixer
  correction, manager acceptance, and Team finish. Zero rework is failure.
- Keep `maxAttemptsPerItem=2`: fixer attempts 1 and 2 are sufficient, while the
  reviewer owns a separate one-attempt review Work item.
- Permit the Lead to create remaining useful Work during a review turn while
  `maxWorkItems` capacity remains. This makes the evaluator agree with the
  existing Lead review instruction; it does not relax fixed-roster, ownership,
  acceptance, rework, or work-count rules.
- Emit greppable machine-written artifacts containing the TeamRun/root Task
  identity, manifest composition, provider/model execution rows, Work attempt
  and rejecting-review history, and produced Python path/content or digest.
- Use the already prepared stack, model environment, preview proxy, and
  host-rewrite shim; do not re-provision.
- Visually inspect Paseo Web and record the preview URL plus the observed single
  workspace with three readable agent tabs/transcripts.

## Non-goals

- No migration, published schema, public API, credential, durable-state model,
  core dependency, tenant/security boundary, or provider-policy expansion.
- No `@getpaseo/cli` upgrade and no replacement for the existing Host rewrite
  shim.
- No new unit, integration, contract, deterministic E2E, eval, or fixture test
  file.
- No reimplementation of PRs #27 through #32 and no scripted-only claim for the
  mixed-provider acceptance result.
- No generalized team workflow, dynamic roster, retry framework, recovery
  hardening, or UI work.
- No raw `git` command on the sandbox and no sandbox re-provisioning.

## Work breakdown

- [ ] Preserve the sandbox-only seed locally for controlled editing, then give
      a fixer explicit ownership of `.local/seed-team.mjs` only. Require it to
      retain the existing publish/invoke flow while changing the three policy
      refs, Python task prompts, forced rejection/rework sequence, and
      machine-written evidence output.
- [ ] Review the seed diff for exact provider mapping, one Work item, mandatory
      rejecting review followed by a later attempt, safe bounded prompts, no
      embedded credential, and no alternate seed path.
- [ ] Commit each durable repository change locally before syncing it with
      `sandbox-ctl push --mode git`; transfer ignored local seed/evidence only
      through the existing sandbox binding without raw sandbox Git.
- [ ] Start or confirm the prepared Compose stack with
      `PASEO_DEV_WEB_UI=1` and `.local/compose.model.yaml`; preserve the
      `mixed-team-` container prefix, set dispatcher concurrency to one for
      deterministic demo ordering, and require all three readiness checks.
- [ ] Create a three-hour port `18080` preview and run the existing Host rewrite
      shim from `18080` to Paseo `16767` using the preview hostname.
- [ ] Execute the adapted seed once under real models and wait for terminal
      Team completion; do not substitute the scripted runtime if real execution
      fails.
- [ ] Query persisted rows for the exact TeamRun and write greppable evidence
      proving three distinct executed providers, non-scripted composition, one
      Paseo workspace, the rejecting review, and a later fixer attempt.
- [ ] Verify the produced Python file exists, is approximately 100 lines, and
      reflects the correction requested by reviewer; write its line count and
      SHA-256 digest into the evidence artifact.
- [ ] Open the preview URL and inspect that Lead, fixer, and reviewer appear as
      three tabs beneath one Paseo workspace with readable transcripts.
- [ ] Classify any non-blocking finding as deferred. After one failed diagnosis
      iteration, route further diagnosis to an oracle before changing design.

## Verification

- [ ] `make ci` in `agent-server-mixed` exits 0. If the 5000 ms contract timeout
      flakes, reproduce on the unmodified baseline, report it as environment
      evidence if it reproduces, and continue.
- [ ] `AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted make agent-teams-v2-smoke` exits 0
      with the existing scripted smoke unchanged.
- [ ] `AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted AGENT_TEAMS_V2_SMOKE_REWORK=1 make
    agent-teams-v2-smoke` exits 0 with `attempts=3` and a machine-written
      envelope record containing `kind:rework`.
- [ ] The real run manifest contains `composition.provider_used=true` and a
      `composition.model` other than `scripted`.
- [ ] Durable query output for one TeamRun shows Lead=`opencode`,
      fixer=`claude`, reviewer=`codex`, all three with the expected model, and
      one shared non-empty Paseo workspace ID.
- [ ] Durable Work/attempt/review output shows manager assignment, first fixer
      submit, rejecting review/request-changes, a later fixer attempt/submit,
      acceptance, and terminal Team completion.
- [ ] Machine-written file evidence reports the produced `.py` path, line count
      near 100, and digest; the file content is retained for inspection.
- [ ] Paseo Web visual inspection confirms three agent tabs under one workspace
      and readable role transcripts; record the preview URL and observation.
- [ ] `make paseo-smoke` runs and its exact result is recorded.

## Documentation impact

- [ ] Product/Feature: update only if the observed real mixed-provider Team
      changes the truthful capability ledger rather than serving as evidence
      for the already merged seam.
- [ ] Component/Contract: reconcile any stale provider/runtime description
      discovered by the real run; do not change a public contract without a new
      Human Gate.
- [ ] ADR/Runbook: no ADR or migration runbook is expected. Record the exact
      preview/evidence procedure in this plan unless a durable operations gap
      is discovered.
- [ ] Reconcile the predecessor per-member-provider Active Plan so merged work
      and still-outstanding real-execution evidence are represented truthfully.

## Decisions and discoveries

- The current worktree does not contain `.local/seed-team.mjs` because `.local`
  is ignored; the prepared sandbox contains the existing 139-line seed required
  by the brief. It will be adapted rather than replaced.
- `scripts/smoke/agent-teams-v2-main-flow.mjs` already writes a manifest with
  `composition.provider_used`, emits a durable provider-resolution artifact,
  and contains the scripted rework assertions. Those are supporting/reference
  paths; B and C still require the sandbox seed to execute real models.
- The previous mixed-provider artifact used scripted runtime and therefore did
  not prove provider execution. Policy resolution rows alone are insufficient.
- The required Python task and review semantics are operational evidence for
  this Prove slice, not a new public Team contract.
- The first real-model attempt, root Task
  `61c3b28c-7b13-4d3d-ae15-7e10b46187e6`, did not reach reviewer execution or
  rework. The OpenCode Lead created fixer Work, then the Claude fixer Run
  reported success without creating the Python artifact or issuing
  `team_work_submit`. The attempt became failed while its Work remained
  in-progress; no reviewer Task was created and the TeamRun stayed active in an
  absorbing state. This is a failed attempt, not B/C evidence.
- The absorbing state is a product finding: terminal succeeded provider Runs
  without a canonical submit are converted to failed attempts, while Lead
  review of failed attempts is limited to child Runs carrying
  `runtime_timed_out` or `runtime_execution_failed`. A succeeded child has
  neither code, so reconciliation cannot return control to Lead.
- Authorization/catalog classification (ii): `team_work_submit` was authorized
  for the Claude fixer turn and present in the catalog offered to its MCP
  client. The immutable grant receipt for member Run
  `00ea7950-0c59-4cdd-91b6-d3c8ae75cbf2` lists
  `agent-server/team-work-submit` in `allowedTools`; the durable RuntimeSession
  launch catalog contains the identical four member refs. For a first
  non-Lead `work_attempt`, `execute-run.ts` passes that same `runtimeToolRefs`
  array as both binder `toolRefs` and `catalogTools`; the binder issues those as
  grant `allowedTools`/`catalogTools`, Direct MCP registers the catalog, and
  `team-mcp-tools.ts` registers `team_work_submit` when that ref is present.
  The Claude adapter forwards the MCP server unchanged. This proves server-side
  authorization and catalog construction; it does not by itself prove that
  Claude Code included the MCP definitions in the downstream model request.
- The Claude-side MCP wire log
  `mcp-logs-agent-server/2026-08-07T02-29-45-818Z.jsonl` line 12 records
  `Connection established with capabilities: {"hasTools":true,...}` for that
  member cell. It does not serialize individual `tools/list` response names;
  the exact-name proof therefore comes from the immutable grant receipt,
  durable launch catalog, and registration path rather than a nonexistent raw
  list-response line. There is no evidence of provider-specific catalog
  filtering in this turn. The missing submit is not structural Claude tool
  omission.
- The provider transcript then separated exposure from execution: its sole
  assistant block, line 8, is `Not logged in · Please run /login` with
  `stop_reason=stop_sequence`. Therefore no DeepSeek model turn occurred and
  this cannot be classified as model-quality noncompliance. The runtime adapter
  persisted the Claude CLI authentication response as a succeeded provider Run;
  TeamDriver then converted the missing canonical submit into a failed attempt
  without an outgoing transition. Claude authentication/configuration is a
  Human Gate; the runtime success classification is a second product finding.
- The Manager cleared that environment gate in commit `2b9c983`. Two runner
  image defects were confirmed and fixed there: provider CLIs were installed
  without Claude/Codex configuration, directly causing the Claude `Not logged
in` response; and the image lacked `ca-certificates`, leaving Codex unable to
  make any HTTPS request. Before the certificate fix, a mixed-provider Team
  could not work at all because a Codex member structurally could not perform a
  single network call. The image now fails its build if the system CA bundle is
  absent, and the local-only provider seeder writes Claude/Codex configuration
  from the container's existing key without printing it.
- The causal environment chain is broader than the provider diagnosis. The
  runner image side required `procps` (daemon child cleanup), CA certificates
  (Codex HTTPS), and Python (the requested artifact's executable verification);
  the dev-launcher side silently drops non-allowlisted configuration and
  rewrites `HOME` to `.local/dev-runtime/home` (provider config discovery and
  dispatcher concurrency). Every instance cost a debugging cycle. These are
  image defects plus launcher HOME/environment-allowlist behavior, not Paseo or
  model defects.
- The working environment does not erase the two runtime product defects found
  by the failed Run: provider CLI authentication failure was persisted as a
  succeeded Run, and succeeded-without-submit left the TeamRun in an absorbing
  state with no outgoing transition. Neither is fixed in this task.
- Deferred product-defect ledger (none is fixed by this documentation slice):
  (1) a provider CLI authentication failure can be recorded as `SUCCEEDED`;
  (2) a succeeded provider Run without `team_work_submit` can leave the
  TeamRun absorbing with no outgoing TeamDriver transition; and (3) a Lead
  scheduled while the workflow has no semantically valid decision can fail the
  entire TeamRun via `lead_no_progress`. A no-progress bypass was considered
  and rejected because it weakens incremental-Lead semantics. The correct
  larger direction is a scheduled, durable review-or-defer relation; that
  design is deferred if it does not fit this slice.
- Durable no-transition evidence at 2026-08-07T02:51:59Z shows TeamRun
  `6ec80054-2c91-40d3-9aa6-caf6e6a48ca7` still
  `active/lead_kickoff/member_work_running`, root Run `waiting_children`, the
  sole wake consumed, and zero nonterminal child Runs, unpublished dispatches,
  queued Team messages, actionable attempts, claimed child leases, or fixer
  command receipts. The correct platform transition is to classify
  provider-success-without-submit as a safe execution/no-progress failure and
  return control to Lead, or atomically fail the TeamRun with a dedicated
  reason. This task will record but not drive-by fix that product defect.
- After the provider image/configuration gate was cleared, real retry root Task
  `3853990a-32b3-483a-bca2-321d13a5cccd` reached a genuine
  `claude/deepseek-v4-flash` turn. Its transcript contained one text-only
  assistant record, `stop_sequence`, zero tool-use blocks, no Python artifacts,
  and no fixer command receipt. It reproduced the absorbing state without an
  authentication failure.
- A prompt-only hard gate in `f101469` required the first fixer assistant block
  to be a terminal call, prohibited prose before tool use, and prohibited turn
  completion until both files and a successful canonical submit existed. Final
  retry root Task `9c96182a-207c-415a-86a9-1da66a4d2582` still produced exactly
  one text-only assistant record, `stop_sequence`, zero tool-use names, and
  neither Python artifact. Its Claude Run
  `510fdbb9-ce29-4e3a-a1a7-11d50448c64f` was persisted succeeded, its attempt
  failed, its Work remains in-progress, and the TeamRun is again absorbing.
  Further prompt iteration is not justified, but these observations alone do
  not establish a model/provider limitation.
- The hypothesis that only the OpenCode Lead connected to Runtime MCP is
  falsified. Authenticated Claude fixer Run
  `89ec2d83-48ca-48cb-8d59-ed7b15ff0e2d` was created with
  `has_mcp_servers=true` in managed cell
  `18de1b71-3e8a-458c-b4cb-aabf38eda036`; that cell's sole grant receipt is
  `2d856e90-0815-430f-bd1f-a0a6d782a61f`, scoped to fixer member Run
  `a713041f-2f24-405a-8185-df70db08881f`, and its cell-local Claude MCP log
  records a successful `hasTools=true` connection at 03:08:24.190Z. Hard-gated
  fixer Run `510fdbb9-ce29-4e3a-a1a7-11d50448c64f` independently has
  `has_mcp_servers=true`, cell `84953ba4-407d-4d6d-ae81-38329a0d6c1d`, sole
  fixer grant `af96c025-bb96-4630-bb77-33359907d5e7`, and its own successful
  `hasTools=true` Claude connection at 03:19:19.071Z.
- Therefore Paseo delivered an MCP server configuration to both authenticated
  Claude processes and each opened a connection through its cell-scoped fixer
  grant path. Existing logs stop at server capabilities: they do not serialize
  `tools/list` response names or the downstream model request's tool array.
  Whether Claude Code translated the connected MCP catalog into the model
  request remains unproven. Do not relabel that remaining boundary as model
  noncompliance or as absence of the MCP server connection.
- A live, container-only argv capture against Claude Code 2.1.223 closes the
  launch-translation question. Paseo launched the fixer with the inline
  cell-scoped server under `--mcp-config`, with
  `--permission-mode bypassPermissions` and
  `--allow-dangerously-skip-permissions`. It did not add `--allowedTools`.
  The retained argv redacts the bearer capability and contains no environment
  or unrelated process data.
- The installed 2.1.223 help defines `--mcp-config` as loading MCP servers from
  JSON files or strings and `--allowedTools` as a tool permission allowlist.
  Anthropic's official
  [CLI reference](https://code.claude.com/docs/en/cli-usage),
  [MCP reference](https://code.claude.com/docs/en/mcp), and
  [Agent SDK MCP reference](https://code.claude.com/docs/en/agent-sdk/mcp)
  likewise say that
  `--mcp-config` loads an ephemeral server, `allowedTools` grants MCP tool
  permission, and `bypassPermissions` auto-approves MCP tools. The documented
  `enableAllProjectMcpServers` and `enabledMcpjsonServers` settings approve
  project `.mcp.json` entries; they do not approve an inline `--mcp-config`
  server. Noninteractive mode skips workspace trust verification. The seeded
  Claude settings contain only provider environment keys and no permission,
  project-MCP approval, or denial rule.
- Consequently, neither a missing permission mode nor a missing project-MCP
  approval explains those earlier text-only turns. Adding `--allowedTools`
  would improve least-privilege expression, but current official semantics do
  not establish its absence as the cause while `bypassPermissions` is active.
  The earlier hypothesis that Paseo's Claude provider/SDK failed to translate
  the catalog into the model request is superseded by the later authenticated
  tool-use evidence below; do not attribute the no-submit outcome to Paseo or
  model noncompliance. Paseo's create protocol still exposes `mcpServers` and
  `modeId` but no explicit tool allowlist; any dependency/protocol change would
  be a core-dependency Human Gate and is not made in this slice.
  Code ownership is explicit: `src/adapters/paseo/paseo-client-port.ts` lines
  151-162 and 279-312 expose/forward `mcpServers` and the provider mode but no
  Claude SDK tool options. Paseo 0.1.110's `AgentSessionConfigSchema` accepts an
  internal `extra.claude` record, and its Claude provider spreads that record
  into SDK options before attaching normalized MCP servers. A least-privilege
  allow rule could therefore be carried only by widening agent-server's Paseo
  adapter input into that dependency extension point; that is not established
  as the corrective fix and is not done here. Retain this only as historical
  boundary analysis; the authenticated tool-use evidence supersedes it as the
  explanation for the no-submit outcome.
- A later authenticated fixer diagnostic (root Task
  `55b5b813-3988-4303-a446-af3d5c438df7`, Run
  `45941e57-5e56-4521-a8f7-9318dbd13f51`) used Bash, MCP, and Write tools and
  produced a 95-line Python artifact, but omitted the canonical submit while
  discovering that Python was absent from the runner. Its artifact evidence is
  retained with SHA-256
  `5c0ca45ce0c57074c150b06e6b80b5e4e18f514260618b608c0a6faa850a409`. This
  authenticated tool-use path corrects stale claims that Paseo, Claude, or the
  model could not deliver tools; it is diagnostic evidence, not a fresh
  successful TeamRun claim.
- Ordering classification trail: the earlier classification (a) assumed that
  `AGENT_SERVER_DISPATCHER_CONCURRENCY=1` plus FIFO was effective. Machine
  evidence then showed that the API child stripped
  `AGENT_SERVER_DISPATCHER_CONCURRENCY` and started with concurrency 4, so at
  the dev-stack boundary the actual classification
  was (b): the intended deterministic flow was unreachable through the Compose
  override. The minimal allowlist fix restores effective concurrency 1 and
  makes this run deterministic. Normal concurrency may interleave reviewer and
  subsequent Lead work; this run is not evidence of a platform sequencing
  guarantee.
- Before this slice, `deriveAgenticLeadCommandPolicy` omitted
  `team_work_create` whenever any completed attempt exposed accept/rework,
  despite remaining capacity and the existing Lead instruction to create any
  remaining useful Work during review. After the minimum widening, create is
  available alongside review commands only while `remainingWorkItems > 0`.
  Existing work ownership, attempt, acceptance, roster, and cardinality bounds
  remain unchanged. This independently accepted Lead-policy justification
  remains valid: reviewing a completed attempt and decomposing newly discovered
  follow-up work are separate pre-existing Lead responsibilities, and completion
  is precisely when results can reveal that bounded follow-up work. The Lead
  already had
  `team_work_create` authority before the first completion; this change keeps
  that same authority available during an actionable review state, only while
  the pre-existing `maxWorkItems` budget has capacity. It does not grant a new
  role, owner transition, retry, acceptance, or unbounded creation power.

## Risks and recovery

- Real model behavior is nondeterministic. Keep prompts explicit and bounded;
  fix only blockers that invalidate the required path. Never reinterpret a
  missing predicted transition as success.
- Single-dispatcher FIFO is a demonstration control, not a platform scheduling
  contract. Evidence must state `platform_sequence_guarantee=false`; do not
  generalize the observed ordering to the default multi-worker dispatcher.
- A request to alter a migration, published schema, public API, credential,
  durable-state model, core dependency, or security boundary is a Human Gate:
  stop with facts and options before changing it.
- The provider key is real and billed. Never print, copy into evidence, commit,
  or expose `.local/model.env`.
- Use only `sandbox-ctl push/pull` for synchronization. Exit 75/76 is repaired
  from the local worktree; raw sandbox Git is forbidden.
- Never use `pkill -f` for the Host rewrite proxy. Identify the listener by port
  if replacement is necessary.
- Recovery is ordinary local commits plus the already bound sandbox. Do not
  destructively reset either side.

## Validation evidence

- No acceptance evidence yet. The brief, implementation, sandbox readiness,
  and failed first real attempt are not proof of B or C. The first attempt did
  not produce a Python artifact, reviewer Task, rejection, rework, terminal
  Team success, or a qualifying manifest.
- The later authenticated diagnostic is also not acceptance evidence: it
  proves tool use and records the 95-line artifact digest above, but it omitted
  the canonical submit. Do not claim a current fresh TeamRun success from that
  artifact.
- Machine-written diagnostic artifacts are retained under ignored local path
  `.local/mixed-team-diagnosis/`: `fixer-tool-exposure/stdout.txt` contains the
  grant receipt, durable catalog, and exact registration path;
  `fixer-mcp-wire/stdout.txt` contains a sanitized twelve-line MCP connection
  log with Authorization and URL values redacted; `first-run-durable/stdout.txt`
  contains Team/Run/Work/attempt/receipt/dispatch/event rows; and
  `absorbing-state/stdout.txt` contains the metadata-only no-transition proof.
  `fixer-provider-transcript/stdout.txt` contains the single safe assistant
  block proving the Claude CLI returned `Not logged in · Please run /login`.
  `second-fixer-transcript/stdout.txt` contains metadata for the first
  authenticated Claude retry, and `hard-gated-fixer/stdout.txt` contains the
  final hard-gated retry metadata (`block_types=["text"]`, empty
  `tool_use_names`, and both artifact-existence fields false).
  `authenticated-claude-mcp-delivery/stdout.txt` correlates both authenticated
  fixer roots, cells, grant IDs/allowed tools, connection timestamps, and
  `hasTools=true` capability lines without retaining a grant token.
  `authenticated-python-missing/stdout.txt` records the authenticated
  Bash/MCP/Write path, missing Python observation, 95-line artifact, and its
  SHA-256 digest.
  `claude-live-argv/stdout.txt` records Claude Code 2.1.223 and the exact
  container argv with its bearer value replaced by `[redacted]`; its adjacent
  machine manifest records the sandbox command and exit code.

## Completion checklist

- [ ] The real mixed-provider TeamRun and mandatory Python rework flow satisfy
      every acceptance item with machine-written evidence.
- [ ] Required scripted smokes, `make ci`, and `make paseo-smoke` have exact
      recorded results.
- [ ] No Human Gate was crossed without explicit authorization.
- [ ] No credential, raw provider payload, debug code, generated runtime home,
      or unintended file is present in the PR diff.
- [ ] Final oracle review has no unresolved `BLOCKER-NOW` finding.
- [ ] All documentation impact and deferred findings are resolved or
      transferred.
- [ ] Move this plan to `docs/exec-plans/completed/`, set `status: completed`,
      and leave no unchecked boxes.
- [ ] Open exactly one PR covering the complete branch.

## Current blocker

There is still no qualifying fresh mixed-provider TeamRun with reviewer
rejection, fixer rework, terminal completion, and visual three-role workspace
proof. The authenticated diagnostic proves that Claude could use Bash, MCP, and
Write and create the 95-line artifact, but it omitted the canonical submit
while Python was unavailable; it therefore does not establish B or C. The
environment chain and launcher allowlist/HOME behavior are now recorded, and
the three runtime product defects remain explicitly deferred. Do not blame
Paseo or the model for this no-submit observation, and do not claim fresh run
success yet.

The prior token incident is closed: the Manager established that the exposed
value was an ephemeral
15-minute, in-memory-only RuntimeToolGrant capability scoped to one member Run
and the sandbox loopback server. It expired, was never persisted, and requires
no rotation. Its value is confined to the internal diagnostic transcript and
does not appear in repository files or retained evidence.

## Next exact command

Report the corrected environment chain and the authenticated artifact digest.
Do not weaken the required provider mapping, claim B/C from partial execution,
blame Paseo or the model for the stale text-only diagnosis, add an unproven
allow/config workaround, drive-by fix the deferred runtime defects, or claim a
fresh run success.

## Cleanup state

The local worktree was clean before this plan. The prepared sandbox remains
bound at remote path `workspace/mixed-team`. Its Manager-owned dirty workspace
was cleared and replaced with committed local HEAD through `sandbox-ctl`; the
two exact `mixed-team-` containers were stopped first. That reset also removed
the ignored remote-only `.local/model.env`; the Manager subsequently restored
it with mode 600 and also restored the ignored Host rewrite shim.
The first seed polling process was terminated locally after the absorbing state
was established; the stack and preview shim remain running for diagnosis.
