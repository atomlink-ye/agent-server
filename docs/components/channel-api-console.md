# Channel, API, and Console component

## Purpose

All human and machine channels translate into one authenticated, idempotent Task proposal and expose the same control-plane truth. A channel does not own a separate session, queue, runtime, or permission model.

## Baseline implementation

The Hono entrypoint exposes:

- `GET /health/live`;
- `GET /health/ready`;
- `POST /api/v1/runs`;
- `GET /api/v1/runs/{run_id}`.

Request IDs are returned and logged. Bodies are limited to 64 KiB. Zod rejects unknown fields and caller model selection. Runtime readiness is checked before accepting a Run. Responses never include the stored prompt or raw provider errors.

## V1 responsibilities

- Web/API/Lark identity adaptation and Task proposal normalization.
- Idempotency, authorization, policy snapshot, and materialize-first admission.
- Task tree, current Run, queue position, completion criteria, approval, Artifact, and error views.
- Cursor-based control-plane events; clients do not subscribe directly to Paseo.
- Durable idempotent delivery back to Lark/Web/API consumers.

The baseline Run API is intentionally temporary. The V1 public contract is Task invocation described in [Run API contract](../contracts/run-api.md).
