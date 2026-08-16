# Developer API: Work Definition

`WorkDefinition` is the immutable authoring contract behind Product `Work`. It answers **what this Work is**; callers do not need to replay Agent Server's Agent/Environment/Team registry choreography.

Canonical contract details and schemas live in [Work Definition API](../contracts/work-definition-api.md). The first-run walkthrough is [Developer API Quickstart](quickstart.md).

## Resource lifecycle

```text
author source
-> validate (no side effect)
-> plan (no side effect)
-> apply
-> immutable WorkDefinitionVersion
-> Work
-> WorkRun
```

### Authoring forms

The MVE accepts two resource styles inside the same `work.yaml`:

- **inline Agent / Environment package**: preferred for first-run developer experience; `apply` materializes and publishes immutable internal versions;
- **exact immutable version ref**: preferred for advanced/shared registry authoring.

For bounded collaboration, the public Definition declares `lead` and `members`; the Product API materializes the internal Team binding. A Team ID is not a Product authoring requirement.

## Endpoints

```text
POST /api/v1/work-definitions:validate
POST /api/v1/work-definitions:plan
POST /api/v1/work-definitions:apply
GET  /api/v1/work-definitions/{definition_id}
GET  /api/v1/work-definitions/{definition_id}/versions
GET  /api/v1/work-definition-versions/{version_id}
```

## Identity and convergence

`metadata.name` plus owner scope establishes stable Definition identity. Canonical source establishes immutable version identity.

- same source + same idempotency key -> replay;
- same canonical source + different key -> converge;
- changed author intent -> new immutable version;
- changed source under a reused idempotency key -> conflict.

A successful Product Definition version is immediately `published`; the MVE does not expose a draft/publish ceremony.

## Safe source boundary

Definition source must not contain credentials or arbitrary runtime secrets. Provider credentials are provisioned through the runtime/environment configuration outside the Product author document.
