# Human Gates and handoff

## Mandatory Human Gates

Stop and request an explicit decision before:

- changing product scope, Feature classification, acceptance criteria, or release gate;
- adding/replacing a core framework, database, queue, infrastructure service, runtime, or major dependency;
- changing a public API/event/schema or compatibility commitment;
- changing tenant, identity, credential, approval, audit, or execution-isolation boundary;
- changing a migration, durable-state contract, or performing uncertain data repair;
- performing a destructive action, including deleting or overwriting user data, important repository history, or an active plan owned by someone else;
- silently selecting a paid model, expanding tool/capability scope, or weakening a safety test;
- resolving a material conflict with another Active Plan;
- proceeding when the documented solution cannot be implemented safely in scope.

A Human Gate explains the observed facts, decision required, viable options, consequences, recommendation, and safe paused state. Do not broaden authority from a terminal instruction such as “finish” or “keep going.”

## Handoff format

An interrupted or cross-session plan must state:

- current outcome and last completed checkbox;
- next exact command/action;
- modified and pending files;
- most recent focused/full/external verification and result;
- blockers and unanswered Human Gates;
- important decisions/discoveries and rejected approaches;
- running processes, temporary paths, credentials, migrations, or cleanup required;
- safe rollback/recovery point.

Never hand off only “tests pass” or “almost done.” A new agent should be able to resume without repeating risky discovery or guessing whether a process, migration, or external action is live.
