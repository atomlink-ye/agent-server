# C3/E8 classifier execution evidence

Classifier source commit: `a02b54af0a18c3eb9639806214509df62b335099`.
The remote committed-only sync was refused because the C-box workspace already
had deleted dependency symlinks and `.c3-e8-02328517/`; no remote dirty content
was cleaned. Exact classifier/harness blobs were copied into the isolated
remote directory `/root/workspace/.c3-e8-classifier-a02b54a` and hash-matched.
The remote candidate stayed at `02328517a0fe887464d0661d772a49ad9d88451b`.

## Remote classifier duals

`01-duals/` contains the actual C-box `node --test` output, stderr, exit, and
candidate status. Seven tests passed (exit 0), covering the six required dual
classes: child 0 -> process 0; exact current-kind marker + nonzero -> process
2; unmarked child 2 -> process 1; arbitrary child 3 -> process 1; wrong marker
-> process 1; missing/unknown kind -> process 2. It also covers duplicate and
malformed markers, signal, null status, raw 125, ordinary spawn failure, and
ENOENT command-unavailable mapping.

## Real absence arms

Each arm moved only its expected input in the remote candidate, recorded the
structural absence, ran the exact fixed command through the C-owned runner,
restored the input, and recorded candidate/status/hash evidence:

- `02-absence-test-file/`: structural `targetAbsent=true`; raw fixed Vitest
  exit 1 (`No test files found`); classifier child exit 1 and final exit 2.
- `03-absence-imported-fixture/`: structural `targetAbsent=true`; raw fixed
  Vitest exit 1 with Vite import-resolution failure and zero tests; classifier
  child exit 1 and final exit 2.

Both arms emitted their exact kind marker only after the structural check. Raw
stdout/stderr, raw status, marker status, classifier status/exit, and restore
proof are retained in the pulled artifact output. `04-final-remote/` confirms
both inputs restored, candidate HEAD unchanged, and only the pre-existing
remote dirty paths remain.

The four invariant/product red arms are not rerun here: the real prior C3
evidence is retained under `artifacts/c3-work-shell/e8-02328517/08-arm-evidence/`
(a3, b4, c2, d2 all exit 1 at their intended assertions). They were not passed
through the absence classifier and are explicitly reported as behavior arms,
not MISSING arms.
