# C3/E8 classifier framing follow-up evidence

Source commit: `248d254db81d78bd813fdddff092572fcb8d38fa`, parent
`55f5ac360cf98ee4350d64950a24694ad79a1cb8`. The C-box committed-only sync
remained blocked by pre-existing remote dependency deletions and
`.c3-e8-02328517/`; exact source blobs were copied to isolated
`/root/workspace/.c3-e8-classifier-248d254` and hash-matched.

`01-duals/` is the actual C-box run of the updated suite: 11/11 passed, exit
0. It includes exact byte framing for an unterminated child input marker and a
non-newline raw Vitest output, while asserting the original child/raw bytes are
unchanged.

`02-absence-test-file/` and `03-absence-imported-fixture/` are canonical real
absence arms. Both structurally confirmed the target absent, ran the fixed
Vitest command, recorded raw code 1 and raw streams, emitted an independent
input marker plus classifier marker (final classifier exit 2), and restored the
input. `04-final-remote/` confirms candidate HEAD remained
`02328517a0fe887464d0661d772a49ad9d88451b` and both inputs exist again.

The full historical check
The full-range check through the source parent was
`git diff 01dce6d89baa89d21180159c5be8b0a5f1446f74..248d254db81d78bd813fdddff092572fcb8d38fa --check`;
it returns exit 2 due preserved raw ANSI terminal artifacts in
`e8-classifier-a02b54a/`, `e8-classifier-51c102f/`, and this follow-up's raw
captures. The current follow-up captures are retained separately and likewise
not rewritten. No full-range PASS is claimed. Source/tests/runner/report-only checks pass with
`git diff --check`.
