# Human Gates and handoff

## Mandatory Human Gates

Stop and request an explicit decision before:

- changing product scope, Feature classification, acceptance criteria, or release gate;
- adding/replacing a core framework, database, queue, infrastructure service, execution plane, or major dependency;
- changing a public API/event/schema or compatibility commitment;
- changing tenant, identity, credential, approval, audit, or execution-isolation boundary;
- changing a migration/durable-state contract or performing uncertain data repair;
- performing an uncertain destructive action on user data or important repository history;
- silently selecting a paid model, expanding tool/capability scope, or weakening a safety contract;
- proceeding when documented/current authorities materially conflict and the choice affects product/security/data scope.

A Human Gate explains observed facts, the decision required, viable options, consequences, recommendation, and safe paused state.

## Handoff format

An interrupted or cross-session handoff should state:

- current outcome and what is already complete;
- next exact command/action;
- modified and pending files;
- most recent actual verification and result;
- blockers and unanswered Human Gates;
- important decisions/rejected approaches;
- running processes, temporary paths, credentials, migrations, and cleanup required;
- safe rollback/recovery point.

Do not create a repository file merely to preserve an ordinary task handoff. Use the current task/PR/Issue/project roadmap context. Promote only durable conclusions into repository documentation.
