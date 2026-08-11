# Product lineage golden recordings

This directory is reserved for recordings made by a successful **real** provider
run. The smoke flow writes one only when
`PRODUCT_LINEAGE_GOLDEN_OUTPUT` is set; it never inserts rows or synthesizes a
sample. A recording is an atomic directory containing independent `api/*.json`
responses, owner-scoped sanitized `db/*.json` row arrays, `manifest.json`, and
`SHA256SUMS`.

Validate a recording with:

```sh
node scripts/ci/check-product-lineage-golden.mjs <recording-directory>
```

No recording is intentionally checked in until a real provider run has produced
one. The checker therefore fails closed with `missing_golden_sample=<path>` for
an absent directory.

