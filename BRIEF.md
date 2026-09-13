## Use subagents aggressively — this is a requirement, not a suggestion

Your roles are installed and verified working: explorer, librarian, executor, oracle, designer, observer.
A probe confirmed two spawn in parallel in a single turn and route to cheaper models (luna) than yours (sol).

Two reasons this matters, and the second is the bigger one:
1. Cost — you are an expensive model. Reading files, running suites, grepping logs, and summarising
   docs do not need your intelligence. Delegate them.
2. PARALLELISM — subagents run concurrently. Spawning four in one turn does four things at once;
   doing them yourself serialises everything. This is the main reason to use them.

Practical rules:
- Spawn MULTIPLE subagents in a SINGLE turn whenever tasks are independent. Do not spawn one,
  wait, then spawn the next — that throws away the parallelism.
- Before any multi-step work, ask: which parts are independent? Fan those out at once.
- explorer/librarian: locating code, reading files, summarising. executor: running commands and
  suites. oracle: hard judgement calls. designer: visual/layout reasoning.
- Do the synthesis and the judgement yourself; delegate the legwork.
- Never idle-wait on a subagent — spawn, collect, continue.

## Push as you go (mandatory)

The sandbox is destroyed on idle timeout and takes uncommitted work with it. A previous round lost
four lanes of work exactly this way.

- Commit + push to origin r4/lane-X after EVERY self-contained change. Never batch.
- First push within your first 15 minutes.
- Verify with: git log --oneline origin/master..HEAD

## Load discipline

The sandbox has 3 cores. Run FOCUSED suites for files you touched, never full test:web except for
your final report. Boot at most ONE real runtime. After browser runs, confirm your harness exited.
If a test fails only under concurrent load but passes alone, say so — do not chase it or repin it.

## Evidence rules

- Never repin a geometry assertion to whatever the current render produces. Decide what product
  contract the pin protected, then assert that intent platform-independently.
- Keep deliberate product pins: row height 49.5, tab height 26, card width 624.
- Measure at 1440 in BOTH en and zh-CN.
- Report verbatim final Test Files/Tests lines. An accurate partial beats a false done.

## Your lane: C — Chinese typography and density, beyond Work

r3 fixed zh-CN sizing inside Work only (scoped to [data-work-surface]). Every other surface still
uses the Latin-tuned scale. CJK glyphs have no ascenders/descenders and read larger at the same px,
so an English-tuned scale renders Chinese oversized with cramped leading.

Audit Files, Tasks, Boards, Conversations, Observe in zh-CN versus en at 1440. Extend the shared
token approach rather than patching components. Keep the 12px metadata floor and deliberate pins.
