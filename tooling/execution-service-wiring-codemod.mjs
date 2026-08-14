import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`No changes for ${path}`);
  await writeFile(path, next);
}

function exact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`missing anchor: ${label}`);
  return source.replace(before, after);
}

await edit('src/bootstrap.ts', (source) => {
  source = exact(
    source,
`  const {
    runtime,
    executionRuns,`,
`  const {
    runtime,
    executionRuntime,
    executionRuns,`,
    'runtime destructure',
  );
  source = exact(
    source,
`    executeTeamTask,
    runtime,
    logger,`,
`    executeTeamTask,
    executionRuntime,
    logger,`,
    'execute-run runtime',
  );
  return source;
});

await edit('tests/fixtures/create-test-app.ts', (source) =>
  exact(
    source,
`      executeTeamTask,
      runtime,
      logger,`,
`      executeTeamTask,
      runtime as never,
      logger,`,
    'test app execute-run runtime',
  ),
);
