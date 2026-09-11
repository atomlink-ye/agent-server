# Semantic vocabulary and bilingual copy audit

Initial implementation: `92100dba`, pushed to `wui3/lane-b`. Verification and follow-up assertions are in progress; this report does not claim completion yet. Isolated Work detail: 13/13 passed. Catalog and trace-selector unit checks: 17/17 passed.

## Vocabulary

The same core nouns appear in English and Simplified Chinese. Chinese surrounding copy is written for the UI; short state labels replace filler such as 正在.

| Term in both locales | Meaning                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| Work                 | Durable identity pinned to a Definition version; only archived/unarchived record state |
| WorkRun              | One product execution of a Work; Work has 1:N WorkRuns                                 |
| Run                  | One attempt at a technical Task                                                        |
| Definition           | Versioned execution specification that chooses Worker or Team                          |
| Worker               | Formal executor selected by the Definition                                             |
| Coworker             | Conversational identity; Definition access does not bind Work directly to a Coworker   |
| Task                 | Technical execution node; existing Tasks navigation still projects WorkItems           |

Preparation uses “Preparation” / “启动准备”. Chat's compatibility `lead` role displays “Assistant” / “助手”; actual Team roles remain visible when the captured roster supplies them.

## Findings

Locations below refer to the baseline `fa344fcc` so removed copy remains findable.

| Baseline location                                               | Finding and correction                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/web/src/i18n/en.ts:663`                                   | Product execution counts called WorkRuns “runs”.                                                           |
| `apps/web/src/i18n/en.ts:836`                                   | Start/retry/history actions called a WorkRun a Run.                                                        |
| `apps/web/src/features/work/pages/WorkDetailPage.tsx:31`        | Selected WorkRun ID passed as selectedRunId; renamed through router, hooks and consumers.                  |
| `apps/web/src/features/work/clients/work-run-client.ts:70`      | Product WorkRun client parameter called runId; now workRunId.                                              |
| `apps/web/src/features/run-trace/normalized.ts:131`             | Trace wrapper called work_run.id runId; now workRunId, preserving technical event.runId.                   |
| `apps/web/src/features/work/components/WorkCard.tsx:92`         | Work card showed execution status without latest-WorkRun attribution.                                      |
| `apps/web/src/features/work/WorkPage.tsx:347`                   | Recent Work row showed latest execution state as Work state.                                               |
| `apps/web/src/features/work-organization/format.ts:36`          | Linked Work badges in Tasks/Boards omitted latest-WorkRun attribution.                                     |
| `apps/web/src/features/agents/coworker-activity.ts:143`         | Coworker Work activity badges omitted latest-WorkRun attribution.                                          |
| `apps/web/src/i18n/en.ts:785`                                   | Preparation labeled shared Work Chat; now explicitly preparation before WorkRun creation.                  |
| `apps/web/src/i18n/en.ts:800`                                   | Every execution conversation called the executor “Run’s Lead”; now neutral Assistant/WorkRun conversation. |
| `apps/web/src/features/run-trace/selectors.ts:282`              | Root Task attempt lane mislabeled as the WorkRun itself; now Root Task Run.                                |
| `apps/web/src/i18n/en.ts:892`                                   | Single-worker execution described as a single Agent; now single Worker with no Team graph.                 |
| `apps/web/src/i18n/en.ts:939`                                   | Observe advertised every agent turn, though it lists the latest traced WorkRun per Work.                   |
| `apps/web/src/features/work/components/definition-panel.tsx:77` | Definition editor strings and accessible labels bypassed the catalogs.                                     |

## Catalog audit

The baseline catalogs each had 904 keys: their different line counts were formatting, not key divergence. Added a test for exact key-set equality, plus interpolation-placeholder parity. Localized Definition authoring, trace controls and summaries, account/route labels, file-state sentences, and known captured state values. Raw authored content, identifiers, tool names, and source data remain data.

## Browser measurements

Pending isolated rerun at 1440 × 900. No density improvement or CSS change is claimed. The browser assertion compares the current execution header with the baseline heading copy replayed in the same real DOM and asserts no height increase or horizontal overflow in either locale. The initial baseline Work-detail browser file passed 13/13 tests, but its console measurements were not emitted in the captured log and are not reported as numeric evidence.

## Verification in progress

- Initial key-parity and placeholder tests passed; the existing untranslated-copy allowlist needed intentional shared nouns, model names and punctuation templates added.
- The first full suite stopped at a Chromium connection timeout. A rerun with a longer browser-connect timeout and two workers exposed shared-host screenshot/test timeouts plus stale copy expectations; isolated reruns are pending.
- The first type check caught the browser command declaration and one incorrectly renamed technical fixture ID; both are corrected in source, pending rerun.
- Lint also reports formatting in unchanged baseline files and supplied untracked brief files; no unrelated files have been reformatted or included.

## Deliberately unchanged

- No public API, route query name (`?run=`), backend identity, Team role contract, execution behavior, layout CSS, or scroll ownership changes.
- The three manager-recorded baseline failures are outside this lane: two conversations-route tests and the Files list scroll test.
- Product navigation “Tasks” remains the existing WorkItem projection. Changing that information architecture is outside a vocabulary audit.
- Generated logs and browser output are untracked; this requested RESULTS.md is the explicit campaign-report exception to normal repository evidence hygiene.
