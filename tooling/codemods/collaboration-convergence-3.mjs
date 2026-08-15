import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}
function exact(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  return source.replace(from, to);
}

await edit('src/application/product-projection/product-projection.ts', (source) => {
  source = exact(
    source,
    "import { canonicalTeamMcpName } from '../agents/built-in-skills.js';",
    "import { collaborationMcpName } from '../../domain/collaboration/canonical-collaboration-tools.js';",
    'product projection mcp classifier import',
  );
  return source.replaceAll('canonicalTeamMcpName', 'collaborationMcpName');
});

await edit('src/infrastructure/filesystem/local-agent-project-loader.ts', (source) => {
  source = exact(
    source,
    "import { canonicalTeamToolRefsForRole } from '../../domain/teams/canonical-team-role-tools.js';",
    "import { collaborationToolRefsForRole } from '../../domain/collaboration/canonical-collaboration-tools.js';",
    'project loader collaboration catalog import',
  );
  return source.replaceAll(
    'canonicalTeamToolRefsForRole',
    'collaborationToolRefsForRole',
  );
});

await edit('src/application/runs/execute-run.test.ts', (source) => {
  source = exact(
    source,
    "import { canonicalTeamToolRefsForRole } from '../teams/team-policy-evaluator.js';",
    "import { collaborationToolRefsForRole } from '../../domain/collaboration/canonical-collaboration-tools.js';",
    'execute run collaboration refs import',
  );
  return source.replaceAll(
    'canonicalTeamToolRefsForRole',
    'collaborationToolRefsForRole',
  );
});

console.log('legacy collaboration surface references migrated');
