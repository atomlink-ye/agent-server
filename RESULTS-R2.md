# Non-Work consistency, round 2

Work is on `wui3/lane-c-r2`, branched from `c05a2a49`. The frozen `wui3/lane-c` branch is untouched. Git runs as OS user `agent`.

The initial diagnosis corrects one premise: Whispers' 10px radius and Stream's 12px disclosure padding were already root-token values (`--radius-md` and `--space-3`). Their problem was choosing different tokens for the same surface role. The 29px Whispers observer header was content-driven, not a literal CSS height.

`surface-contract.ts` defines one table of surfaces and one target per role: title height `--surface-title-height` (44px), title inset/content gutter `--space-6` (24px), card padding/collection gap `--space-4` (16px), radius `--radius-lg` (12px). Every matched card and collection is measured in real Chromium at 1440, in both locales. The existing real component fixtures invoke the same table; they do not choose per-surface expected values. Output includes computed values and real bounding rectangles under ignored `.local/surface-contract/`.

The new title-height token lives in lane-owned `features/surface-tokens.css`, derived from existing spacing tokens. No shared `index.css`, type token, backend code or other lane's file is edited.

## Red-first evidence

The initial matrix run, before changing layout styles:

```text
 Test Files  4 failed | 5 passed (9)
      Tests  4 failed | 42 passed (46)
   Start at  23:15:20
   Duration  183.19s (transform 0ms, setup 0ms, import 131.66s, tests 100.64s, environment 0ms)
```

After expanding the table to Task comments and Board columns/card collections, both corresponding files failed the new numeric contract:

```text
 Test Files  2 failed (2)
      Tests  2 failed | 23 passed (25)
   Start at  23:19:49
   Duration  126.49s (transform 0ms, setup 0ms, import 94.79s, tests 77.73s, environment 0ms)
```

Production fixes and green verification are pending. This intermediate report is not a completion claim.

## Semantic boundaries

Sessions and Stream are embedded sections, and Dispatch is an inline conversation card. They do not own page title bars. Dispatch also does not own its containing page gutter or collection layout. The table records these as explicitly inapplicable rather than inventing elements or reporting fictitious equality. Stream's joined disclosure is checked at all four outside corners (upper corners on its summary container, lower corners on its disclosure); the internal joined edge stays square.

The table covers structural cards, gutters and collections in the real fixture states. Icon/text gaps, controls, status-pill radii and content-driven section-heading heights have different roles. They are not flattened into the card contract. A literal requirement that every CSS gap or radius, including those roles, have one value remains outside this pass.
