import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/application/teams/team-driver.completion-decision.approval.test.ts';
const before = await readFile(path, 'utf8');
const from = '  const findCompletionDecisionForRequest = vi.fn(async () => null);';
const to = `  const findCompletionDecisionForRequest = vi.fn<\n    () => Promise<ReturnType<typeof createTeamCompletionDecision> | null>\n  >(async () => null);`;
if (!before.includes(from)) throw new Error('completion decision mock changed');
await writeFile(path, before.replace(from, to));
console.log('completion decision test typing fixed');
