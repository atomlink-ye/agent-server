import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}

await edit('src/application/teams/team-driver.ts', (source) => {
  const from = 'The runtime completed successfully yet required board_submit did not occur.';
  const to = 'The runtime completed successfully yet required Work board_submit did not occur.';
  if (!source.includes(from)) throw new Error('submit failure message changed');
  return source.replace(from, to);
});

await edit('src/application/runs/execute-run.test.ts', (source) => {
  const manualSchedule = /\n\s*await \(\n\s*driver as unknown as \{\n\s*scheduleLead:[\s\S]*?\n\s*'late callback scheduling',\n\s*\);\n\s*expect\(failTeamRunAtomically\)\.not\.toHaveBeenCalled\(\);\n/u;
  if (!manualSchedule.test(source))
    throw new Error('stale callback scheduleLead block changed');
  source = source.replace(manualSchedule, '\n');

  const obsoleteSchedulerTest = /\n\s*it\('atomically admits a scheduled Lead turn through the transaction-scoped Team repository',[\s\S]*?\n\s*\}\);\n\s*it\('resolves a published managed Agent with durable Task ownership and sends only its instructions'/u;
  if (!obsoleteSchedulerTest.test(source))
    throw new Error('obsolete scheduleLead transaction test changed');
  return source.replace(
    obsoleteSchedulerTest,
    "\n  it('resolves a published managed Agent with durable Task ownership and sends only its instructions'",
  );
});

console.log('obsolete direct Lead scheduler tests removed');
