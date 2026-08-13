# Byte-identity protected L0 artifacts

Only these files in this directory are protected as closed L0 byte-identity
objects:

- `ownership-ledger-harness.mjs`
- `ownership-ledger.json`
- `transaction-ast-helper.mjs`
- `verify-ownership-ledger.mjs`

Their exact SHA-256 values are bound by the closed L0 verification record.
Formatting, key reordering, whitespace normalization, or re-serialization
invalidates that binding. Any byte change requires governance approval and
complete L0 evidence regeneration; other scripts in this directory remain
ordinary evolving source.
