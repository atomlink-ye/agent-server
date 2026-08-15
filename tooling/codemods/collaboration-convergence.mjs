import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}

function replaceExact(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  return source.replace(from, to);
}

await edit('src/application/runs/agent-run-executor.ts', (source) => {
  source = replaceExact(
    source,
    "import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../agents/built-in-skills.js';",
    "import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../agents/built-in-skills.js';",
    'agent executor legacy tool import',
  );
  source = replaceExact(
    source,
    `import {\n  canonicalTeamToolRefsForDirectMessage,\n  canonicalTeamToolRefsForLeadPolicy,\n  canonicalTeamToolRefsForRole,\n} from '../teams/team-policy-evaluator.js';`,
    `import { collaborationToolRefsForLeadPolicy } from '../teams/team-policy-evaluator.js';\nimport {\n  collaborationToolRefsForMessageTurn,\n  collaborationToolRefsForRole,\n} from '../../domain/collaboration/canonical-collaboration-tools.js';`,
    'agent executor policy imports',
  );
  source = source
    .replaceAll('canonicalTeamRefs', 'collaborationRefs')
    .replaceAll('AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS', 'AGENT_SERVER_COLLABORATION_TOOL_REFS')
    .replaceAll('canonicalTeamToolRefsForRole', 'collaborationToolRefsForRole')
    .replaceAll('canonicalTeamToolRefsForDirectMessage', 'collaborationToolRefsForMessageTurn')
    .replaceAll('canonicalTeamToolRefsForLeadPolicy', 'collaborationToolRefsForLeadPolicy');
  return source;
});

await edit('src/application/extensions/runtime-tool-grant-service.ts', (source) => {
  source = replaceExact(
    source,
    `import {\n  AGENT_SERVER_MEMORY_READ_TOOL_REF,\n  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS,\n  SUPPORTED_MANAGED_AGENT_TOOL_REFS,\n} from '../agents/built-in-skills.js';\nexport {\n  AGENT_SERVER_MEMORY_READ_TOOL_REF,\n  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS,\n} from '../agents/built-in-skills.js';`,
    `import {\n  AGENT_SERVER_MEMORY_READ_TOOL_REF,\n  SUPPORTED_MANAGED_AGENT_TOOL_REFS,\n} from '../agents/built-in-skills.js';\nexport { AGENT_SERVER_MEMORY_READ_TOOL_REF } from '../agents/built-in-skills.js';`,
    'runtime grant legacy exports',
  );
  return source;
});

await edit('src/application/teams/team-driver.ts', (source) => {
  source = replaceExact(
    source,
    `import {\n  AGENTIC_TEAM_LIMITS,\n  deriveAgenticLeadCommandPolicy,\n  isTeamCompletionApprovalPending,\n} from './team-policy-evaluator.js';`,
    `import {\n  deriveAgenticLeadCommandPolicy,\n  isTeamCompletionApprovalPending,\n} from './team-policy-evaluator.js';\nimport { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';`,
    'team driver limits import',
  );
  source = source.replaceAll('AGENTIC_TEAM_LIMITS.', 'COLLABORATION_LIMITS.');
  source = source
    .replaceAll("'team_work_create'", "'board_create'")
    .replaceAll("'team_work_accept'", "'board_accept'")
    .replaceAll("'team_work_cancel'", "'board_cancel'")
    .replaceAll("'team_work_request_changes'", "'board_request_changes'")
    .replaceAll("'team_finish'", "'collaboration_finish'");
  return source;
});

await edit('src/infrastructure/postgres/postgres-collaborative-team-repository.ts', (source) => {
  source = replaceExact(
    source,
    "import { AGENTIC_TEAM_LIMITS } from '../../application/teams/team-policy-evaluator.js';",
    "import { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';",
    'team repository limits import',
  );
  return source.replaceAll('AGENTIC_TEAM_LIMITS.', 'COLLABORATION_LIMITS.');
});

await edit('src/infrastructure/postgres/postgres-collaboration-repository.ts', (source) => {
  source = replaceExact(
    source,
    "import { randomUUID } from 'node:crypto';",
    "import { randomUUID } from 'node:crypto';\nimport { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';",
    'collaboration repository limits import',
  );
  source = source.replace(
    'Number(count.rows?.[0]?.count ?? 0) >= 4',
    'Number(count.rows?.[0]?.count ?? 0) >= COLLABORATION_LIMITS.maxWorkItems',
  );
  source = source.replaceAll(
    'if (attemptNo > 2)',
    'if (attemptNo > COLLABORATION_LIMITS.maxAttemptsPerItem)',
  );
  return source;
});

console.log('collaboration convergence codemod applied');
