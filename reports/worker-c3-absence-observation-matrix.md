# C3/C4 bounded observation matrix

The two tables have identical row order. Table B is the zero-execution audit
for the corresponding Table A claim. Business empty-state cardinality is
separate from acceptance execution count: empty `works` is valid product data,
while zero tests, controls, checks, assertions, arms, or probes is never proof.
Every verdict is exactly one of `COMPLETE_AND_PROVEN_ABSENT`,
`MISSING_EVIDENCE`, or `UNSOUND_ABSENCE`.

The generic positive-minimum guard from `e8-zero-3484079` is `SUPERSEDED` for
this matrix. It must not be used as evidence: `ZERO_EXECUTION` is neutral and
compares an independently declared expected count/rule with an independently
observed count. `instrument` and `target-unavailable` are distinct missing
evidence subclasses; an independently permitted expected count of zero may
legitimately compare equal to an observed zero.

## Table A — production claim and completeness proof (10 columns)

| claim_id | production_assertion | observation_source | enumerated_universe | completeness_precondition | incomplete_events | incomplete_event_observable | fail_closed_result | canonical_incomplete_arm | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E8-list | recorder-backed Work titles and exact hrefs render | sealed C3 ledger + DOM | every list-journey request | settled GET `/api/works`, two quiet turns, post-seal guard | pending/error/late activity | ledger lifecycle/inFlight/postSeal | no seal is no proof | never-settling `/api/works` | COMPLETE_AND_PROVEN_ABSENT |
| E8-no-n1 | no per-Work N+1 reads | sealed ledger | every request start/settle | exact request universe sealed | extra/late request | method/path/generation | extra request fails | delayed per-ID `/runs` | COMPLETE_AND_PROVEN_ABSENT |
| E8-no-extra-get | only GET `/api/works` occurs | sealed ledger | all same-origin API tuples | exact method/path/query policy | unknown tuple/collector unavailable | tuple record + guard | mismatch fails | delayed POST `/api/team-project` | COMPLETE_AND_PROVEN_ABSENT |
| E8-no-status | no status/runs/latest semantic source is read | poison Proxy over original projection item | every property/descriptor/enumeration read | only `id/title` closed set | forbidden property read | Proxy get/has/ownKeys/descriptor throws | semantic read fails | production `work.status` read | COMPLETE_AND_PROVEN_ABSENT |
| E8-no-marker | unavailable disclosure and no special status vocabulary | DOM + data-flow guard | all rendered elements and projected Work data | populated DOM stable | forbidden text/class/data/read | lexical guard plus Proxy | mismatch fails | injected status class/marker | COMPLETE_AND_PROVEN_ABSENT |
| E8-wrongmarker | wrong marker is not absence | classifier dual | all reserved stdout/stderr lines | exact scan complete | wrong/duplicate/malformed line | classifier process 1 | never MISSING | wrong marker child | COMPLETE_AND_PROVEN_ABSENT |
| E8-absence-runner | fixed command, two structural checks, marker evaluation execute | absence runner | command + target-before/after + marker | command=1, structural=2, marker=1 | spawn/dependency/target reappears | raw status + runner outcome | unavailable/zero=MISSING | bypassed fixed command | MISSING_EVIDENCE |
| E8-no-residual | owned process cleanup is observed | cleanup function | each owned process/descendant | collector and awaited exits | unavailable/timeout/residual | complete/residual/status | unavailable MISSING; residual UNSOUND | TERM-ignoring child | MISSING_EVIDENCE |
| E8-0-tests | fixed browser file has two real tests and no skip/todo | Vitest wrapper summary | file/tests/pass/skip/todo summary | summary fully parsed | zero/truncated/all-skip | raw summary parser | wrapper process 2 | absent test/fixture or truncated summary | COMPLETE_AND_PROVEN_ABSENT |
| E8-red-completed-status | production status-bearing read cannot render Completed | production WorkShell mutation + poison | projected Work property reads | completed-status arm and exact target assertion | Proxy exception/status marker | thrown read + raw target pattern | UNSOUND | `completed-status` | COMPLETE_AND_PROVEN_ABSENT |
| E8-red-unavailable-disclosure | unavailable disclosure cannot be removed | production WorkShell mutation + DOM assertion | every populated card disclosure | unavailable-disclosure arm and exact target assertion | missing disclosure | raw assertion target pattern | UNSOUND | `unavailable-disclosure` | COMPLETE_AND_PROVEN_ABSENT |
| E8-red-runs-n-plus-one | per-Work `/runs` N+1 cannot pass | production WorkShell mutation + sealed ledger | every request start/settle | runs-n-plus-one arm and exact target assertion | extra request | ledger record count + raw target pattern | UNSOUND | `runs-n-plus-one` | COMPLETE_AND_PROVEN_ABSENT |
| E8-red-container-identity | list container identity is required | production WorkShell mutation + DOM assertion | list container query | container-identity arm and exact target assertion | missing/renamed list | raw target pattern | UNSOUND | `container-identity` | COMPLETE_AND_PROVEN_ABSENT |
| E8-incomplete-late-runs | late production `/runs` is rejected | production WorkShell mutation + ledger | every late request | late-runs arm and exact failure summary | late request | raw target count | MISSING | `late-runs` | COMPLETE_AND_PROVEN_ABSENT |
| E8-incomplete-never-settle | never-settling production fetch cannot seal | production WorkShell mutation + ledger | pending fetch/inFlight | never-settle arm, marker, inFlight>=1 | pending/timeout | ledger marker + raw status | MISSING | `never-settle` | COMPLETE_AND_PROVEN_ABSENT |
| E8-red-zero-target | omitted target is never a pass | C3 production zero runner | selected arm target count | independent arm target pattern | target omitted/runner unavailable | target-count.json + runner exit | MISSING | C3 runner instrument arm | MISSING_EVIDENCE |
| C4-same-origin | same-origin `/api/**` complement is empty | shared page observer | request/response/finished/failed | sealed exact tuple universe | listener/body/pending/late | observer ledger | forbidden UNSOUND; incomplete MISSING | delayed forbidden request | MISSING_EVIDENCE |
| C4-response-count | each expected response tuple has exact count | observer response ledger | every finished response body | sealed parse + count map | duplicate/malformed/pending | bodyOutcome/counts | duplicate/malformed UNSOUND | duplicate `/api/works` | MISSING_EVIDENCE |
| C4-dom-mismatch | stable DOM matches accepted facts | observer seal + DOM assertion | expected selectors/counts/text | real bounded repeated DOM snapshots | unstable/missing selector | mismatch list | mismatch UNSOUND | targeted DOM mutation | MISSING_EVIDENCE |
| C4-no-marker | no forbidden body/DOM marker | observer parser + DOM | all relevant bodies and DOM | schema/body/DOM complete | parse/listener failure | bodyOutcome/listenerErrors | observed UNSOUND; unavailable MISSING | malformed body | MISSING_EVIDENCE |
| C4-activity | no forbidden post-seal activity | observer postSeal ledger | all requests after seal | fixed guard elapsed | delayed request | postSealActivity | observed UNSOUND | 100ms delayed forbidden | MISSING_EVIDENCE |
| C4-scenario-set | actual scenarios equal closed expected set | E11 runner | `parallel-success`,`rework-once` | all expected scenarios accounted | partial skip/set mismatch | scenario set ledger | mismatch MISSING | partial skip | MISSING_EVIDENCE |
| C4-cleanup | E10/E11 final exit includes cleanup | production cleanup wiring | app/replay process groups | collector + descendants awaited | unavailable/unknown/timeout/residual | cleanup result reaches final exit | unavailable MISSING; residual UNSOUND | TERM-ignoring descendant | MISSING_EVIDENCE |
| C4-schema | every consumed response passes full schema | E10/E11 parser | works/work/runs/run/trace bodies | body acquired and parsed | pending/parse/schema failure | parser outcome | schema failure UNSOUND; unavailable MISSING | malformed route body | MISSING_EVIDENCE |

## Table B — independent expected-rule comparison (6 columns; rows correspond to Table A)

`ZERO_EXECUTION` is neutral. `instrument` means the collector/parser/harness
could not establish the observed count; `target-unavailable` means the target
file, fixture, dependency, or runner could not start. Expected rules are
independent of the observation. An expected rule of zero is valid when its
provenance explicitly permits an empty business or optional set.

| independent_expected_count_or_rule | expected_provenance | observed_count_source | comparison | canonical_zero_arm | verdict |
| --- | --- | --- | --- | --- | --- |
| 1 populated journey | fixed browser assertion registry | sealed ledger + DOM | observed=expected | e8-list | COMPLETE_AND_PROVEN_ABSENT |
| 1 request control | list journey rule | sealed ledger records | observed=expected | e8-no-n1 | COMPLETE_AND_PROVEN_ABSENT |
| 1 method/path/query control | list journey rule | sealed ledger tuples | observed=expected | e8-no-extra-get | COMPLETE_AND_PROVEN_ABSENT |
| 1 poison read control | explicit status guard arm registry | Proxy read/own-key assertions | observed=expected | e8-red-completed-status | COMPLETE_AND_PROVEN_ABSENT |
| 1 populated DOM assertion | fixed browser assertion registry | DOM assertion | observed=expected | e8-no-marker | COMPLETE_AND_PROVEN_ABSENT |
| 12 classifier cases | source-declared classifier case registry | Node TAP case count | observed=expected | c3-classifier | COMPLETE_AND_PROVEN_ABSENT |
| fixed command + 2 structural checks + 1 marker | absence-runner contract | absence-runner ledger | exact rule comparison | absence-runner | MISSING_EVIDENCE |
| 1 cleanup probe | cleanup contract | cleanup result | observed=expected | c4-cleanup | MISSING_EVIDENCE |
| 1 file + 2 tests + pass2 + skip0 + todo0 | fixed Vitest summary rule | wrapper summary | exact rule comparison | e8-browser | COMPLETE_AND_PROVEN_ABSENT |
| 1 selected mutation arm | explicit C3 arm registry | target-count.json | observed=expected | completed-status | COMPLETE_AND_PROVEN_ABSENT |
| 1 selected mutation arm | explicit C3 arm registry | target-count.json | observed=expected | unavailable-disclosure | COMPLETE_AND_PROVEN_ABSENT |
| 1 selected mutation arm | explicit C3 arm registry | target-count.json | observed=expected | runs-n-plus-one | COMPLETE_AND_PROVEN_ABSENT |
| 1 selected mutation arm | explicit C3 arm registry | target-count.json | observed=expected | container-identity | COMPLETE_AND_PROVEN_ABSENT |
| 1 selected incomplete arm | explicit C3 incomplete-arm registry | target-count + raw failure | observed=expected | late-runs | COMPLETE_AND_PROVEN_ABSENT |
| 1 selected incomplete arm + exact marker | explicit C3 incomplete-arm registry | marker + ledger inFlight | observed=expected | never-settle | COMPLETE_AND_PROVEN_ABSENT |
| 1 selected target pattern | explicit C3 arm registry | production zero runner target count | observed=0 is instrument process2 | C3 runner instrument arm | MISSING_EVIDENCE |
| declared E10 scenario rule | scenario manifest | E10 accounting | exact rule comparison | c4-e10 | MISSING_EVIDENCE |
| declared response tuple rule | response manifest | sealed response ledger | exact rule comparison | c4-response | MISSING_EVIDENCE |
| declared DOM assertion rule | DOM assertion registry | DOM ledger | exact rule comparison | c4-dom | MISSING_EVIDENCE |
| declared marker assertion rule | parser/DOM rule | parser + DOM ledger | exact rule comparison | c4-response | MISSING_EVIDENCE |
| declared late-activity rule | observer arm registry | post-seal ledger | exact rule comparison | c4-e10 | MISSING_EVIDENCE |
| declared E11 scenario rule | scenario manifest | E11 accounting | exact rule comparison | c4-e11 | MISSING_EVIDENCE |
| declared cleanup probe rule | cleanup contract | cleanup result | exact rule comparison | c4-cleanup | MISSING_EVIDENCE |
| declared schema rule | response schema manifest | parser ledger | exact rule comparison | c4-response | MISSING_EVIDENCE |

The C3 source registry owns the expected counts for the five C3 production
kinds; C4 kinds deliberately have no guessed count here and fail closed as
`instrument`. The only legal expected-zero proof is the source-owned optional
business rule exercised by the C3 comparison dual. Production zero arms derive
`target-unavailable` from real target lstat/spawn failure and `instrument` from
a started runner that cannot produce a count; callers cannot select either
subclass.

C-box C3 zero evidence: `node --test scripts/ci/c3-c4-zero-execution.test.mjs
scripts/ci/c3-zero-production-runner.test.mjs` exited 0 with 10 tests, 0
skips, and 0 todos. The production runner emitted real process-2
`target-unavailable` arms for missing target and ENOENT spawn, plus a real
process-2 `instrument` arm for a started command with no count; no caller
provided expected count or subclass.
