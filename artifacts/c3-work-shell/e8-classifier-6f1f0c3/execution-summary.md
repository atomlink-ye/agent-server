# C3/E8 production-path framing evidence

Test-wiring/source commit: `6f1f0c39e093d6040c2596ab7ef0da5c99247927`, parent
`4278eb63864c19661a5689b836855ec0f68fe922`. The C-box committed-only sync
remained blocked by pre-existing remote dependency deletions and
`.c3-e8-02328517/`; exact blobs were copied to isolated
`/root/workspace/.c3-e8-classifier-6f1f0c3` and hash-matched.

`01-duals/` is an actual C-box run of the updated 11-test suite: 11/11 passed,
exit 0. The classifier framing case spawns the production CLI and compares the
complete stdout Buffer. The runner framing case invokes the production
`runAbsence` orchestration with only spawn/absence/output seams injected,
captures its real output, preserves `raw.stdout`, and sends that output through
the outer classifier for process 2. No hand-built helper result substitutes for
either production path.

`02-absence-test-file/` and `03-absence-imported-fixture/` rerun the canonical
real arms against the DI-enabled runner. Both structurally confirmed absence,
ran fixed Vitest with raw exit 1, emitted independent input/classifier markers,
ended classifier exit 2, restored the target, and retained candidate HEAD
`02328517a0fe887464d0661d772a49ad9d88451b`.

The historical raw ANSI artifacts in `e8-classifier-a02b54a/`,
`e8-classifier-51c102f/`, and `e8-classifier-248d254/` remain unmodified. The
canonical symbolic `git diff --check 01dce6d89baa89d21180159c5be8b0a5f1446f74..HEAD`
is expected and recorded as exit 2 after the evidence commit; scoped source,
tests, runner, and report checks are recorded separately as exit 0. No full
range PASS is claimed.
