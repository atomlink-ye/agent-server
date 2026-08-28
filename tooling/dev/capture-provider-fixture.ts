import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Manual fixture refresh. Run this only after a verified live provider run.
 *
 * Sanitisation is by whitelist: exactly one field, the completion text, is
 * carried across. Everything else in the capture is discarded rather than
 * filtered, so a field nobody anticipated cannot leak. The surviving text is
 * then scanned for residue, because the text itself can carry a token or a
 * path that the whitelist would happily pass through.
 */

const FIXTURE_ID = /^[a-z0-9-]+$/;

/** Residue that must never reach a committed fixture. */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'credential or token',
    /\b(authorization|bearer|api[_-]?key|secret|token|password|cookie)\b/i,
  ],
  ['UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['absolute path', /(^|\s)(\/(Users|home|tmp|var|etc)\/|[A-Za-z]:\\)/],
  ['database URL', /\b(postgres(ql)?|mysql|mongodb):\/\//i],
  ['timestamp', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/],
  ['long hex/base64 blob', /\b[A-Za-z0-9+/]{40,}={0,2}\b/],
];

const args = process.argv.slice(2);
const input = valueFor('--input');
const fixtureId = valueFor('--fixture-id');
const fromLiveRun = args.includes('--from-live-run');

if (!input || !fixtureId) {
  console.error(
    'Usage: pnpm capture:provider-fixture -- --input <sanitized-capture.json> --fixture-id <id> --from-live-run',
  );
  process.exitCode = 2;
} else if (!FIXTURE_ID.test(fixtureId)) {
  console.error(
    `Invalid fixture id '${fixtureId}': use lowercase letters, numbers and hyphens only.`,
  );
  process.exitCode = 2;
} else if (!fromLiveRun) {
  // The provenance value this tool writes asserts a live capture. Refusing
  // without the explicit flag keeps the tool from stamping that claim onto
  // material that never came from a provider run.
  console.error(
    'Refusing to write a fixture: --from-live-run is required, because this tool stamps ' +
      "provenance 'sanitized_live_capture'. If the content was not produced by a verified " +
      "live provider run, author the fixture by hand with provenance 'hand_authored_contract_fixture'.",
  );
  process.exitCode = 2;
} else {
  const source = JSON.parse(await readFile(resolve(input), 'utf8')) as Record<
    string,
    unknown
  >;
  const text = typeof source.text === 'string' ? source.text : null;
  if (!text)
    throw new Error('Capture input must contain a string "text" field.');

  const found = FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(
    ([label]) => label,
  );
  if (found.length > 0)
    throw new Error(
      `Refusing to write fixture '${fixtureId}': completion text contains ${found.join(', ')}. ` +
        'Sanitise the capture before refreshing the fixture.',
    );

  const fixture = {
    schema_version: 1,
    fixture_id: fixtureId,
    provenance: 'sanitized_live_capture',
    // Normalised, neutral values. The fixture must not carry provider or
    // account identity, and the words captured/real/live are barred from
    // fixture metadata.
    provider: {
      family: 'normalized-provider',
      model_class: 'normalized-model-class',
    },
    request: { turn: 'continue' },
    completion: { status: 'completed', text },
  };
  await writeFile(
    resolve('tests/fixtures/provider', `${fixtureId}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  console.log(`Wrote tests/fixtures/provider/${fixtureId}.json`);
}

function valueFor(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}
