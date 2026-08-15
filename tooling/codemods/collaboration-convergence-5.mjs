import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/bootstrap.ts';
const before = await readFile(path, 'utf8');
const from = `    events,\n    logger,\n    deferActivationKick: options.deferTeamWakeReconcile,\n  });`;
const to = `    events,\n    logger,\n    ...(options.deferTeamWakeReconcile === undefined\n      ? {}\n      : { deferActivationKick: options.deferTeamWakeReconcile }),\n  });`;
if (!before.includes(from)) throw new Error('bootstrap team module options changed');
await writeFile(path, before.replace(from, to));
console.log('bootstrap exact optional fixed');
