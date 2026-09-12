# Bilingual product vocabulary — round 2

Branch: `wui3/lane-b-r2`, based on frozen round-1 `f6740293`. Round-1 branch was not updated. No PR, merge, rebase, backend change, or CSS change. This report is explicitly requested campaign evidence; generated full inventories and logs remain in ignored `.local/r2/`.

**Acceptance status: stopped by the deputy’s quota convergence ruling.** Catalog and component-copy tests passed (40/40), and the expanded copy-layout fixture passed in both locales (34 captured measurements). Full-suite completion, final types, final lint, and the additional browser fixtures are **unverified at convergence**. No complete acceptance is claimed.

## Domain vocabulary

| Term | English / Chinese usage | Scope |
| --- | --- | --- |
| Work | Work / Work | Durable record; no status machine, no Worker/Coworker binding. |
| WorkRun | WorkRun / WorkRun | Product execution instance; Definition chooses Worker/Team. |
| Run | Run / Run | One Task attempt; never an alias for WorkRun. |
| Definition | Definition / Definition | Versioned execution specification and access catalog. |
| Worker / Coworker / Task | Same domain names in both locales | Runtime configuration / product collaborator / execution-node invocation. |

Conversation remains Run-scoped. The null `work_run_id` bucket is preparation. The WorkRun question panel describes its selected context without claiming Conversation ownership. No Run.lead field or new lead relationship was introduced.

## Complete enumeration and limits

The pipeline was checked against the known-true `export function WorkDetailHeader` symbol and `work.latestState` key before use. A second sentinel is the still-present technical gateway literal `The service is unavailable.`. A TypeScript AST walk records every catalog property and every nonblank literal/JSX text/template fragment in the eligible production tree. Complete inventories were written to files, not head/tail-truncated searches. The original 1,084 bilingual pairs were reviewed in four complete pages (260 + 280 + 280 + 264); 1,236 catalog-filtered review candidates in four complete pages (280 + 320 + 330 + 306). Later source/sink review found and corrected the TitleBar omission described below.

| Machine count | Before round 2 | Final source |
| --- | ---: | ---: |
| Eligible TS/TSX files | 119 | 119 |
| Catalog keys per locale | 1,084 | 1,104 |
| Duplicate keys, each locale | 0 | 0 |
| English-only / Chinese-only keys | 0 / 0 | 0 / 0 |
| Source literal/fragments | 5,759 | 5,775 |
| JSX-context strings | 3,050 | 3,044 |
| English lexical review candidates | 1,279 | 1,253 |
| Literal translation calls | 1,219 | 1,261 |

Final categories: comparisons 695; JSX attributes 1,382; JSX text 67; modules 558; property keys 33; review 1,405; translation keys 1,261; types 374. The durable source guard traverses all **59 production TSX files**. Literal call-key coverage is 991 distinct keys, zero missing keys. Dynamic key families are additionally checked by catalog parity/placeholder tests; 991 is not a claim that other keys are unused.

Full machine artifacts: `.local/r2/final/catalogs.json`, `catalogs.txt`, `source-strings.json`, `review.txt`, `jsx-attributes.txt`, `counts.json`, `translation-key-coverage.json`, `source-copy-files.json`, and `catalog-diff.json`. Original snapshots remain under `.local/r2/` unchanged. These files contain all entries; the counts above are not a sampled search.

The static guard is a source invariant, not proof that arbitrary server/user text is translated. It checks visible JSX text/attributes, template fragments, and editable defaults; its positive fixtures include `Hello`, `format('Hello world')`, a templated comment count, and `TitleBar section="Tasks"`. IDs, routes, class names, enum tokens, units, raw YAML and authored/runtime content remain data. Structured server Definition diagnostics may still be English; changing that contract/backend is outside this lane.

The first scanner incorrectly excluded `section` as a technical prop. The independent caller trace showed TitleBar renders it both visibly and in its accessible label. The corrected guard failed with exactly BoardsPage:326 `"Boards"` and TasksPage:290 `"Tasks"`; both now use existing catalog keys. This earlier false negative is not presented as a successful proof.

## Exact existing catalog changes

All existing key order is preserved. Twenty keys were appended, none removed. Existing values changed at 21 English keys and 24 Chinese keys. `product-vocabulary.test.ts` asserts the exact bilingual values for all 24 changed semantic keys.

| Key | English before → after | Chinese before → after |
| --- | --- | --- |
| workCard.statusUnavailable | Status unavailable → Latest WorkRun unavailable | 状态不可用 → 最新 WorkRun 不可用 |
| workItem.status.in_progress | In progress → In progress | 中 → 进行中 |
| workStage.running.description | This WorkRun is active. → This WorkRun is active. | 此 WorkRun 运行。 → 此 WorkRun 运行中。 |
| tasks.startWork | Start Work → Create Work | 启动 Work → 创建 Work |
| boards.doing | Doing → Doing | 中 → 进行中 |
| agents.startWork | Start Work → Create Work | 启动 Work → 创建 Work |
| agents.noCapabilities | No Work is available to this Coworker yet. Browse the shared Work catalog or create a Definition. → No Definitions are available to this Coworker yet. Browse Definitions or create one. | 此 Coworker 还没有可用的 Work。可以浏览共享 Work 目录，或创建一个 Definition。 → 此 Coworker 暂无可用 Definition，可浏览或新建。 |
| agents.browseWorkCatalog | Browse Work catalog → Browse Definitions | 浏览 Work 目录 → 浏览 Definition |
| authoring.inputsDescription | These fields become the questions shown when starting Work. → These fields supply input when starting a WorkRun. | 这些字段会成为启动 Work 时显示的问题。 → 这些字段用于填写 WorkRun 输入。 |
| authoring.saved | Capability saved to this Coworker’s Work Catalog. → Capability saved to this Coworker’s Definition catalog. | Capability 已保存到此 Coworker 的 Work Catalog 中。 → 已保存到此 Coworker 的 Definition 目录。 |
| authoring.saveStart | Save & start Work → Save & create Work | 保存并启动 Work → 保存并创建 Work |
| work.start.title | Start a piece of Work → Create a Work | 启动一项 Work → 创建 Work |
| work.catalog | Work catalog → Definition catalog | Work 目录 → Definition 目录 |
| work.definitionExecutor | The Definition selects the Worker or Team for this Work. → The Definition selects the Worker or Team for each WorkRun. | Work 由 Definition 指定的 Worker 或 Team 执行。 → Definition 为每次 WorkRun 指定 Worker 或 Team。 |
| work.start.heading | Start formal Work → Create Work and start a WorkRun | 开始正式 Work → 创建 Work 并启动 WorkRun |
| work.start.start | Start Work → Create Work & start WorkRun | 开始 Work → 创建 Work 并启动 WorkRun |
| work.chat.runPlaceholder | Message this WorkRun’s executor… → Ask about this WorkRun… | 向这次 WorkRun 的执行者发消息… → 询问此 WorkRun… |
| work.chat.runLead | WorkRun conversation · no execution changes → Questions about this WorkRun · no execution changes | WorkRun 对话 · 不更改执行 → WorkRun 问答 · 不更改执行 |
| work.run.checkingBody | Checking whether this Work can run here… → Checking whether a WorkRun can start here… | 检查这个 Work 能否在这里运行… → 检查能否启动 WorkRun… |
| work.run.checkError | We couldn’t check whether this Work can run here. → We couldn’t check whether a WorkRun can start here. | 无法确认这个 Work 能否在这里运行。 → 无法确认能否启动 WorkRun。 |
| work.run.unavailableTitle | This Work can’t run in this deployment. → WorkRuns can’t start in this deployment. | 这个 Work 无法在当前部署中运行。 → 当前部署无法启动 WorkRun。 |
| agents.activityWorkHint | Work here was started from this Coworker's Capabilities. → These Work records were created from Definitions available to this Coworker. | 这里的 Work 都是从这位 Coworker 的 Capabilities 启动的。 → 这些 Work 由此 Coworker 可用的 Definition 创建。 |
| definition.currentVersion | Current Work version → Current Definition version | Work 当前版本 → 当前 Definition 版本 |
| definition.historicalVersion | Historical WorkRun version → WorkRun’s Definition version | 历史 WorkRun 版本 → WorkRun 的 Definition 版本 |

## Appended copy and removed hardcoded text

| Key | English | Chinese |
| --- | --- | --- |
| authoring.reviewer | Reviewer | 审核者 |
| authoring.reviewerInstructions | Review the work independently, identify material gaps, and return clear corrections or approval evidence. | 独立审核结果，指出关键缺漏，给出修改意见或通过依据。 |
| workOrg.unknownMention | {id} is not in this workspace's member directory. | 此 Workspace 成员目录中没有 {id}。 |
| workOrg.oneComment |  comment |  条评论 |
| workOrg.manyComments |  comments |  条评论 |
| workOrg.unknownMember | this member | 该成员 |
| workOrg.claimComplete | This Task is already complete. | 此 Task 已完成。 |
| workOrg.claimUnavailable | This Task cannot be claimed right now. | 此 Task 暂不可领取。 |
| workOrg.claimHeld | This Task has already been claimed by {name}. | 此 Task 已由{name}领取。 |
| conversations.createError | Unable to create this conversation. Please try again. | 无法创建对话，请重试。 |
| authoring.createError | Unable to create this Coworker. Please try again. | 无法创建 Coworker，请重试。 |
| authoring.previewError | Unable to preview this Definition. Please try again. | 无法预览 Definition，请重试。 |
| authoring.saveError | Unable to save this Capability. Please try again. | 无法保存此能力，请重试。 |
| files.workScopesError | Unable to load Work file scopes. | 无法加载 Work 文件范围。 |
| files.loadError | Unable to load these files. Please try again. | 无法加载文件，请重试。 |
| files.actionError | This file operation could not be completed. Please try again. | 未能完成文件操作，请重试。 |
| whispers.loadError | Unable to load Whisper channels. | 无法加载 Whisper 频道。 |
| whispers.messagesError | Unable to load Whisper messages. | 无法加载 Whisper 消息。 |
| authoring.inputFallback | Input | 输入字段 |
| work.runFailure.capability | This WorkRun requires runtime capabilities that this deployment does not support. | 当前部署不支持此 WorkRun 所需的运行能力。 |

Source replacements include: Reviewer/default review instructions; unknown-member tooltip; singular/plural comment suffixes; Task claim-blocked reasons and unknown-member fallback; trace feedback counts, source Run/event/attempt labels, token usage; and technical lifecycle `WorkRuncompleted` → `Run completed` / `WorkRun 详情已完成` → `Run：已完成`. The lifecycle is asserted in `session-transcripts.browser.test.tsx` for both locales. Display helpers and unsupported capability errors have exact bilingual assertions in `display-helpers.test.tsx`.

The gateway-error source/sink audit follows. Technical errors remain available for typed control flow; UI catches choose localized operation messages. Busy, missing-feature, and 404 distinctions are retained.

| Raw source family | Exact old literals | Current localized sinks |
|---|---|---|
| `api/transport.ts:41,53,61` | `The service is unavailable.`; `The request could not be completed.`; `The service returned an invalid response.` | Covered by the operation-specific presentation catches below; HTTP status/code/payload behavior unchanged. |
| `features/account/account-gateway.ts:39,83` | `Invalid authentication response.`; `Invalid account response.` | `account/AuthPage.tsx:26` → `auth.error`. Other account/display-name errors already resolve to `account.saveError` or remain hidden. |
| `features/agents/agents-gateway.ts:12,65,95,212,248` | `Invalid Coworker response.`; `Invalid Coworker creation response.`; `The Capability could not be added to this Coworker.`; `Invalid Coworker profile.`; `Invalid Coworker runtime status.` | `agents/AuthoringPanels.tsx:62` → `authoring.createError`; remote preview catch → `authoring.previewError`; save catch `:301` → `authoring.saveError`. Roster consumers use `agents.loadError`. Profile-only schema failures already render a localized unavailable/error panel. |
| `features/conversations/conversations-gateway.ts:225` | `The service returned an invalid response.` | `conversations/ConversationsPane.tsx:82` → `agents.loadError` for roster; `:101` → `conversations.createError` for creation. `agents/AgentsPage.tsx:35` also uses `conversations.createError`, preserving `agents.busyConversation` for `chat_runtime_unavailable`. |
| `features/files/files-gateway.ts:47,50,66,130,146,151` | `Invalid Files response.`; `Invalid File response.`; `Invalid File entry.`; `Invalid Context response.` | `files/FilesPage.tsx:283,354,396,445` → `files.loadError`; file mutations `:518,535,552` → `files.actionError`. Scope/roster catches `:103,108,124` → `agents.loadError`, `conversations.list.loadError`, `files.workScopesError`. |
| `features/whispers/whispers-gateway.ts:36,50,57,75,92,100,105` | `Invalid Whispers response.`; `Invalid Whisper messages response.`; `Invalid Whisper channel.`; `Invalid Whisper message.`; `Invalid Whisper response.` | `whispers/WhispersPage.tsx:40` → `whispers.loadError`; `:59` → `whispers.messagesError`. |
| `features/work-organization/client.ts:74` | `The work-organization response did not match the browser contract.` | `conversations/components/ChatTranscript.tsx:105` → `tasks.actionError` for Task creation. Task/Board editors already map failures to their localized action/load keys. |
| `features/work/clients/errors.ts` and remote Definition calls | `The Product response was invalid.`; remote API messages | Advanced authoring in `work/components/new-work.tsx:761,789` → `work.start.validationFailed` / `work.start.applyFailed`; CapabilityBuilder remote catches use `authoring.previewError` / `authoring.saveError`. |
| `features/work/clients/errors.ts` unsupported-capability branch | Previously displayed the server-provided `error.message` verbatim; no single fixed frontend literal | `workRunFailureMessage():95` → `work.runFailure.capability`, preserving permanent failure classification and disabled retry behavior. |
| `features/agents/authoring.ts` defensive compiler branches | Baseline line 229: `${input.label || key} needs at least one choice.`; baseline lines 389/395 fallback `Input`; baseline line 84 fallback `the participant` | Choice → `authoring.error.choice`; empty input label fallback → `authoring.inputFallback`; participant name validated before use, so redundant English fallback removed. |

`files.actionError` now describes failure to complete a file operation, including a listing refresh after successful publication; it does not categorically claim that a successful publication failed to save. `feature_unavailable`, missing-resource 404, and busy-runtime code branches retain their existing distinctions.



## Real browser measurements at 1440

The copy-only before measurement replays the original text in the same mounted component and CSS, reads `getBoundingClientRect()` plus a text Range, then restores current copy and reads again. It is **not** a clean-fa344fcc route benchmark. Initial fixtures use a 1,084px content host inside the 1,440px browser; the Work landing/catalog fixture uses the real app-shell grid. Input/textarea measurements include scroll/client dimensions. Native select/placeholder tests use a same-font DOM text proxy against the actual control width, and do not claim native popup measurement. No CSS density improvement is claimed.

`measureCopy` asserts viewport width 1440, nonzero rendered width, scroll width/height no larger than client width/height, and visible text bounds within its element. Measurements are scoped to these fixtures; they are not universal validation of every diagnostic, tooltip, or arbitrary authored text.

| Locale | Key | Element width px before → after | Element height px before → after | Text width px before → after |
| --- | --- | ---: | ---: | ---: |
| en | work.start.heading | 1084.00 → 1084.00 | 32.00 → 32.00 | 183.59 → 350.39 |
| en | work.start.start | 87.50 → 219.17 | 25.00 → 25.00 | 73.50 → 205.17 |
| en | work.definitionExecutor | 1020.00 → 1020.00 | 18.00 → 18.00 | 318.84 → 347.14 |
| en | definition.currentVersion | 109.08 → 128.81 | 24.00 → 24.00 | 91.08 → 110.81 |
| en | definition.historicalVersion | 135.03 → 143.03 | 24.00 → 24.00 | 117.03 → 125.03 |
| en | work.run.checkingBody | 226.73 → 241.59 | 17.00 → 17.00 | 226.73 → 241.59 |
| en | work.run.checkError | 265.81 → 280.67 | 17.00 → 17.00 | 265.81 → 280.67 |
| en | work.run.unavailableTitle | 339.97 → 354.73 | 27.00 → 27.00 | 339.97 → 354.73 |
| en | workCard.statusUnavailable | 104.95 → 149.56 | 23.00 → 23.00 | 88.95 → 133.56 |
| en | workItem.status.in_progress | 67.84 → 67.84 | 20.00 → 20.00 | 53.84 → 53.84 |
| en | workStage.running.description | 526.95 → 526.95 | 18.00 → 18.00 | 132.44 → 132.44 |
| en | work.start.title | 200.81 → 136.12 | 32.00 → 32.00 | 200.81 → 136.12 |
| en | work.catalog | 86.34 → 116.52 | 14.00 → 14.00 | 86.34 → 116.52 |
| en | authoring.saveStart | 152.56 → 164.06 | 39.00 → 39.00 | 126.56 → 138.06 |
| en | authoring.inputsDescription | 356.22 → 290.80 | 18.00 → 18.00 | 356.22 → 290.80 |
| en | authoring.reviewer | 492.00 → 492.00 | 38.00 → 38.00 | 490.00 → 490.00 |
| en | authoring.reviewerInstructions | 492.00 → 492.00 | 74.00 → 74.00 | 490.00 → 490.00 |
| zh-CN | work.start.heading | 1084.00 → 1084.00 | 32.00 → 32.00 | 155.47 → 286.86 |
| zh-CN | work.start.start | 85.64 → 205.23 | 25.00 → 25.00 | 71.64 → 191.23 |
| zh-CN | work.definitionExecutor | 1020.00 → 1020.00 | 18.00 → 18.00 | 284.22 → 289.39 |
| zh-CN | definition.currentVersion | 82.78 → 105.53 | 24.00 → 24.00 | 64.78 → 87.53 |
| zh-CN | definition.historicalVersion | 102.75 → 137.28 | 24.00 → 24.00 | 84.75 → 119.28 |
| zh-CN | work.run.checkingBody | 177.33 → 134.11 | 17.00 → 17.00 | 177.33 → 134.11 |
| zh-CN | work.run.checkError | 201.33 → 158.11 | 17.00 → 17.00 | 201.33 → 158.11 |
| zh-CN | work.run.unavailableTitle | 315.55 → 263.50 | 27.00 → 27.00 | 315.55 → 263.50 |
| zh-CN | workCard.statusUnavailable | 71.00 → 120.23 | 23.00 → 23.00 | 55.00 → 104.23 |
| zh-CN | workItem.status.in_progress | 25.00 → 47.00 | 20.00 → 20.00 | 11.00 → 33.00 |
| zh-CN | workStage.running.description | 530.27 → 530.27 | 18.00 → 18.00 | 110.17 → 123.17 |
| zh-CN | work.start.title | 146.83 → 100.75 | 32.00 → 32.00 | 146.83 → 100.75 |
| zh-CN | work.catalog | 59.28 → 89.45 | 14.00 → 14.00 | 59.28 → 89.45 |
| zh-CN | authoring.saveStart | 145.64 → 145.64 | 39.00 → 39.00 | 119.64 → 119.64 |
| zh-CN | authoring.inputsDescription | 244.11 → 201.17 | 18.00 → 18.00 | 244.11 → 201.17 |
| zh-CN | authoring.reviewer | 492.00 → 492.00 | 38.00 → 38.00 | 490.00 → 490.00 |
| zh-CN | authoring.reviewerInstructions | 492.00 → 492.00 | 74.00 → 74.00 | 490.00 → 490.00 |

Captured measurement records at report generation: **34**. Extra tests are not credited until their results and artifacts are captured.

## Red-first and verification evidence

Semantic regression test before fixes:
```text
Test Files  1 failed (1)
Tests  23 failed (23)
Duration  12.72s
```
After the first semantic/source fixes:
```text
Test Files  3 passed (3)
Tests  35 passed (35)
Duration  45.27s
```
The later TitleBar red was:
```text
AssertionError: expected [ …(2) ] to deeply equal []
+ "features/work-organization/BoardsPage.tsx:326: \"Boards\""
+ "features/work-organization/TasksPage.tsx:290: \"Tasks\""
Test Files  1 failed (1)
Tests  1 failed | 3 passed (4)
Duration  53.51s
```
Final node subset after that fix:
```text
pnpm test:web apps/web/src/i18n/i18n.test.ts apps/web/src/i18n/product-vocabulary.test.ts apps/web/src/i18n/source-copy.test.ts apps/web/src/i18n/display-helpers.test.tsx
Test Files  4 passed (4)
Tests  40 passed (40)
Duration  35.61s
```

| Check | Result actually observed |
| --- | --- |
| Initial copy-layout browser fixture | 2/2 passed; 146.71s; 28 records |
| Expanded copy-layout browser fixture | 2/2 passed; 130.19s; 34 records |
| Transcript isolated after fixing test capitalization | 4/4 passed; 63.04s |
| Initial regression subset | 5 files passed, 1 failed; 42 passed, 1 failed (test expected Completed instead of completed) |
| First types | Failed: WorkChatCard mock missing workRef/problemKind/attentionReason; corrected |
| Second types | Exit 0; before final extra browser tests |
| Final checks | Unverified at convergence; quota ruling stopped further work |

| Suspect browser file | Clean base | Concurrent | Isolated |
| --- | --- | --- | --- |
| AgentsPage.browser.test.tsx | No fresh base measurement; not in supplied three-red baseline | 68.52s; connection timeout, zero imports/tests | 68.66s; same connection timeout, zero imports/tests |
| session-transcripts.browser.test.tsx | No fresh base measurement | 16.411s file time; new test capitalization assertion failed | 3.53s tests / 63.04s total; 4 passed after correcting expectation |

At the profile failures the explorer observed 3 CPUs, load 40.33/38.03/31.20, and active browser tests in three other worktrees. No stale lane-b browser processes were present. This supports load pressure but does not prove the cause. No timeout was treated as an implementation regression or “fixed” by increasing a timeout. The manager-provided clean fa344fcc baseline has only the two named /conversations router failures and FilesPage final-file scroll failure; no fresh clean-base durations are invented.

## Remaining scope and integration notes

No structural changes were made to ia-a-owned definition/overview/runs panes, work-tabs, or WorkDetailPage. Shared copy consumers changed only labels/error text; frontend documentation only appends this lane’s section. CSS and backend files are untouched.

Known limits: structured server diagnostics and runtime/user-authored content are not translated here; native popup/tooltip rendering and arbitrary text sizes are not fully measurable through DOM ranges. Tests only earn acceptance when actually executed. The deputy explicitly required stopping further work at convergence. These remaining checks and measurements are handed off as unverified; they are not claimed complete.


## Convergence handoff — 2026-09-12

The deputy stopped further investigation, new fixes and new tests to preserve fleet quota. No work was reopened after this ruling.

- `pnpm test:web` — **unverified at convergence**. The full run was in flight and exceeded the allowed two-minute convergence window; no final result was available. This includes newly added profile/save/Task/Board/WorkRun-placeholder/auth-error browser cases.
- `pnpm web:check:types` — **unverified at convergence** for the final diff. The previous second run exited 0, but additional browser tests were added afterward. The final run had not completed within the convergence window.
- `pnpm lint` — **unverified at convergence**. The in-flight run had reported pre-existing formatting warnings plus two files subsequently formatted; no final rerun completed. No green lint claim is made.
- No fresh clean-base duration was measured. The two profile connection failures (68.52s and 68.66s, zero tests) remain unresolved environment observations, not asserted implementation regressions.
- All 24 semantic catalog keys have exact bilingual assertions, but real-browser coverage for every corrected string is **unfinished**. Only the 34 captured records in the table are credited. No native popup, tooltip, arbitrary server diagnostic, or universal ancestor-clipping proof is claimed.
- Complete source/catalog enumeration and source/sink review are retained under ignored `.local/r2/`; the report includes exact changed strings and counts. The static guard and key-set/placeholder/duplicate invariants passed in the 40-test node subset.

No PR opened. Push target remains `wui3/lane-b-r2` only.
