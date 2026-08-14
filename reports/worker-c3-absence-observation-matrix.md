# C3/C4 bounded observation matrix

The two tables have identical row order. Table B is the zero-execution audit
for the corresponding Table A claim. Business empty-state cardinality is
separate from acceptance execution count: empty `works` is valid product data,
while zero tests, controls, checks, assertions, arms, or probes is never proof.
Every verdict is exactly one of `COMPLETE_AND_PROVEN_ABSENT`,
`MISSING_EVIDENCE`, or `UNSOUND_ABSENCE`.

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
| E8-red-late-runs | late production `/runs` is caught after seal | production WorkShell mutation + ledger | every late request | real mutation and target assertion | late request | postSealActivity | UNSOUND | delayed per-ID `/runs` | COMPLETE_AND_PROVEN_ABSENT |
| E8-red-never-settle | never-settling production fetch cannot seal | production WorkShell mutation + ledger | pending fetch/inFlight | real mutation and bounded timeout | pending/timeout | timeout + inFlight | MISSING | never-settling `/api/works` | COMPLETE_AND_PROVEN_ABSENT |
| E8-red-status-read | production semantic read trips poison | production WorkShell mutation + poison | projected Work property reads | real mutation and target assertion | Proxy exception | thrown read | UNSOUND | production `work.status` | COMPLETE_AND_PROVEN_ABSENT |
| E8-red-zero-target | omitted target is never a pass | zero guard | mutation arm target count | target must execute | count 0 | exact zero marker/process 2 | MISSING | omitted target assertion | MISSING_EVIDENCE |
| C4-same-origin | same-origin `/api/**` complement is empty | shared page observer | request/response/finished/failed | sealed exact tuple universe | listener/body/pending/late | observer ledger | forbidden UNSOUND; incomplete MISSING | delayed forbidden request | MISSING_EVIDENCE |
| C4-response-count | each expected response tuple has exact count | observer response ledger | every finished response body | sealed parse + count map | duplicate/malformed/pending | bodyOutcome/counts | duplicate/malformed UNSOUND | duplicate `/api/works` | MISSING_EVIDENCE |
| C4-dom-mismatch | stable DOM matches accepted facts | observer seal + DOM assertion | expected selectors/counts/text | real bounded repeated DOM snapshots | unstable/missing selector | mismatch list | mismatch UNSOUND | targeted DOM mutation | MISSING_EVIDENCE |
| C4-no-marker | no forbidden body/DOM marker | observer parser + DOM | all relevant bodies and DOM | schema/body/DOM complete | parse/listener failure | bodyOutcome/listenerErrors | observed UNSOUND; unavailable MISSING | malformed body | MISSING_EVIDENCE |
| C4-activity | no forbidden post-seal activity | observer postSeal ledger | all requests after seal | fixed guard elapsed | delayed request | postSealActivity | observed UNSOUND | 100ms delayed forbidden | MISSING_EVIDENCE |
| C4-scenario-set | actual scenarios equal closed expected set | E11 runner | `parallel-success`,`rework-once` | all expected scenarios accounted | partial skip/set mismatch | scenario set ledger | mismatch MISSING | partial skip | MISSING_EVIDENCE |
| C4-cleanup | E10/E11 final exit includes cleanup | production cleanup wiring | app/replay process groups | collector + descendants awaited | unavailable/unknown/timeout/residual | cleanup result reaches final exit | unavailable MISSING; residual UNSOUND | TERM-ignoring descendant | MISSING_EVIDENCE |
| C4-schema | every consumed response passes full schema | E10/E11 parser | works/work/runs/run/trace bodies | body acquired and parsed | pending/parse/schema failure | parser outcome | schema failure UNSOUND; unavailable MISSING | malformed route body | MISSING_EVIDENCE |

## Table B — zero-execution audit (6 columns; rows correspond to Table A)

| expected_min_count | observed_count_source | zero_trigger | zero_exit | canonical_zero_arm | verdict |
| --- | --- | --- | --- | --- | --- |
| 2 tests (source-owned browser minimum) | wrapper-parsed fixed Vitest summary | 0 files/tests, skip/todo, unknown/truncated | 2 | e8-browser | COMPLETE_AND_PROVEN_ABSENT |
| 1 `/api/works` request control | sealed ledger record count | 0 requests/collector unavailable | 2 | e8-request-ledger | COMPLETE_AND_PROVEN_ABSENT |
| 1 request-tuple control | sealed method/path/query records | 0 observed requests | 2 | e8-request-ledger | COMPLETE_AND_PROVEN_ABSENT |
| 1 poison read control | production mutation arm count | 0 controls/Proxy unavailable | 2 | e8-behavior-status | COMPLETE_AND_PROVEN_ABSENT |
| 1 DOM assertion | fixed browser DOM assertion count | 0 assertions | 2 | e8-browser | COMPLETE_AND_PROVEN_ABSENT |
| 12 declared classifier cases | Node TAP declared case count | 0/all skip | 2 | c3-classifier | COMPLETE_AND_PROVEN_ABSENT |
| 1 command + 2 structural + 1 marker (count is arm=1) | absence runner ledger | 0 command/check/marker or dependency unavailable | 2 | absence-runner | MISSING_EVIDENCE |
| 1 cleanup probe | production cleanup result | 0/unavailable collector | 2 | c4-cleanup | MISSING_EVIDENCE |
| 1 file and 2 tests, 0 skip/todo | wrapper-parsed summary | 0 file/tests/all skip/unknown | 2 | e8-browser | COMPLETE_AND_PROVEN_ABSENT |
| 1 production mutation arm | fixed browser mutation run | 0 target assertions | 2 | e8-behavior-late | COMPLETE_AND_PROVEN_ABSENT |
| 1 production mutation arm | fixed browser mutation run | 0 target assertions/timeout | 2 | e8-behavior-pending | COMPLETE_AND_PROVEN_ABSENT |
| 1 production mutation arm | fixed browser mutation run | 0 target assertions | 2 | e8-behavior-status | COMPLETE_AND_PROVEN_ABSENT |
| 1 target assertion | zero guard observed count | observed count=0 | 2 | e8-behavior-zero-target | MISSING_EVIDENCE |
| 2 scenarios | E10 scenario accounting | 0/all skip/dependency unavailable | 2 | c4-e10 | MISSING_EVIDENCE |
| 1 response-count check | sealed response count map | 0 checks/fixture unavailable | 2 | c4-response | MISSING_EVIDENCE |
| 1 DOM assertion | E11 DOM assertion ledger | 0 assertions | 2 | c4-dom | MISSING_EVIDENCE |
| 1 marker assertion | parser + DOM ledger | 0 assertions/schema unavailable | 2 | c4-response | MISSING_EVIDENCE |
| 1 late-activity arm | observer postSeal records | 0 arm/collector unavailable | 2 | c4-e10 | MISSING_EVIDENCE |
| 2 scenarios | E11 expected-set accounting | 0/all skip/partial mismatch | 2 | c4-e11 | MISSING_EVIDENCE |
| 1 cleanup probe | production cleanup result | 0/unavailable/unknown | 2 | c4-cleanup | MISSING_EVIDENCE |
| 1 schema check | E10/E11 parser ledger | 0 checks/fixture unavailable | 2 | c4-response | MISSING_EVIDENCE |
