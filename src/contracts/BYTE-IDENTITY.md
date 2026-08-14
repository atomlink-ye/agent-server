# Byte-identity protected contract artifacts

Only these files in this directory are protected as byte-identity objects:

- `product-accepted-subset.v1.json`
- `product-contract-policy.ts`

Their exact SHA-256 values are active inputs to the accepted Product API v1
governance checks. Formatting, key reordering, whitespace normalization, or
re-serialization invalidates that binding. Any byte change requires the
applicable governance decision and complete evidence regeneration; ordinary
source files elsewhere in this directory are not made immutable by this note.
