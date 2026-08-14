# C3/E8 classifier review-fix evidence

Review-fix source commit: `51c102f6806f06fb2458f7ae51ef25b4fa6446f8`, parent
`b4c8ec1838251bb9eb74a072f3fe2cc7cfdb87cd`. The C-box committed-only sync
remained blocked by pre-existing remote dependency deletions and
`.c3-e8-02328517/`; exact review-fix blobs were copied to isolated
`/root/workspace/.c3-e8-classifier-51c102f` and hash-matched.

## Review-fix duals

`01-duals/` is an actual C-box run of the updated dual suite: 10/10 passed,
exit 0. It covers the original six mappings plus expected+malformed,
expected+wrong, expected+pre-existing classifier reserved lines, strict CLI
separator/empty/trailing arguments, raw 0/ENOENT/EACCES/null/signal runner
non-marker outcomes, and split multibyte/invalid-byte Buffer forwarding.

The classifier now preserves child chunks as Buffers for forwarding and only
decodes copies for reserved-line classification. Any reserved
`c3_e8_input_missing:` or `c3_e8_classifier_` line makes evidence contradictory
unless it is the sole exact expected input marker. CLI parsing requires exactly
`<kind> -- <nonempty command> [args...]`.

## Real absence arms

Both arms used the updated harness and fixed command. Each moved exactly one
expected input, structurally confirmed it absent, ran the command, recorded raw
status/stdout/stderr, emitted the exact marker only after raw code 1,
`signal=null`, `spawnError=null`, and a second absence check, then restored the
input:

- `02-absence-test-file/`: raw code 1 (“No test files found”), classifier exit 2.
- `03-absence-imported-fixture/`: raw code 1, Vite import failure with zero
  tests, classifier exit 2.

Both restore proofs show candidate HEAD unchanged at
`02328517a0fe887464d0661d772a49ad9d88451b`.

## Diff-check note

`git diff 01dce6d89baa89d21180159c5be8b0a5f1446f74..b4c8ec1838251bb9eb74a072f3fe2cc7cfdb87cd --check`
returns exit 2 because preserved raw ANSI terminal evidence contains trailing
whitespace/newline artifacts. This is intentionally not rewritten. The
review-fix source, tests, and report paths were checked separately with
`git diff --check`; no full-range PASS is claimed.
