import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { classify } from './c3-e8-classifier.mjs';

const [kind, evidenceDirectory] = process.argv.slice(2);
const evidence = resolve(evidenceDirectory ?? '.c3-e8-absence-arm');
mkdirSync(evidence, { recursive: true });
const runner = resolve(new URL('./c3-e8-absence-runner.mjs', import.meta.url).pathname);
const outcome = await classify({
  kind,
  argv: [process.execPath, runner, kind, '--evidence', evidence],
});
writeFileSync(
  resolve(evidence, 'classifier-status.json'),
  `${JSON.stringify({
    classifierExit: outcome.process,
    childExitCode: outcome.childExitCode,
    childSignal: outcome.childSignal,
    reason: outcome.reason,
    marker: outcome.marker ?? null,
  }, null, 2)}\n`,
);
writeFileSync(resolve(evidence, 'classifier.exit'), `${outcome.process}\n`);
process.exitCode = outcome.process;
