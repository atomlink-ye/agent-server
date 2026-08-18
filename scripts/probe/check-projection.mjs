// Runs the projection over the raw capture from a real run and prints what it
// produced, so the module is judged on recorded provider output rather than on
// a hand-written sample. Takes the two NDJSON files the probe left behind.
import { readFileSync } from 'node:fs';

import {
  orderEntries,
  projectStreamPayload,
  projectTimelineEntry,
} from '../../src/adapters/paseo/role-transcript.js';

const timelinePath = process.argv[2];
const streamPath = process.argv[3];
const ROLES = {
  'c79dc7c9-ef0e-4b0e-b1d6-a04192ec7c8a': 'lead',
  '4f102cb6-400b-42a2-954d-86d223b0259a': 'builder',
  'de0afb0e-3786-44b5-9ce9-a3c8630855c8': 'analyst',
};

function lines(path) {
  return readFileSync(path, 'utf8').split(/\n/u).filter((line) => line.trim());
}

let failures = 0;
const require = (condition, message) => {
  if (!condition) {
    failures += 1;
    process.stdout.write(`FAIL: ${message}\n`);
  }
};

process.stdout.write('=== stored timeline -> entries ===\n');
for (const line of lines(timelinePath)) {
  const page = JSON.parse(line);
  if (!page.ok) continue;
  const entries = orderEntries(
    page.page.entries.map(projectTimelineEntry).filter(Boolean),
  );
  const role = ROLES[page.agentId] ?? page.agentId;
  const kinds = {};
  for (const entry of entries) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
  process.stdout.write(
    `${role}: ${entries.length}/${page.page.entries.length} projected ${JSON.stringify(kinds)}\n`,
  );
  // Nothing may be silently dropped, every entry must carry a usable one-liner,
  // and ordering must actually be non-decreasing.
  require(
    entries.length === page.page.entries.length,
    `${role}: dropped ${page.page.entries.length - entries.length} entries`,
  );
  require(
    entries.every((entry) => entry.summary.trim().length > 0),
    `${role}: some entry produced an empty summary`,
  );
  require(
    entries.every((entry) => entry.summary.length <= 161),
    `${role}: some summary exceeded the cap`,
  );
  let previous = -Infinity;
  for (const entry of entries) {
    if (entry.seqStart !== null) {
      require(entry.seqStart >= previous, `${role}: entries are out of order`);
      previous = entry.seqStart;
    }
  }
  for (const entry of entries.filter((candidate) => candidate.kind === 'assistant').slice(0, 2))
    process.stdout.write(`    assistant | ${entry.summary}\n`);
  for (const entry of entries.filter((candidate) => candidate.kind === 'tool').slice(0, 2))
    process.stdout.write(`    tool      | ${entry.summary}\n`);
}

process.stdout.write('\n=== live stream -> entries ===\n');
const perRole = {};
for (const line of lines(streamPath)) {
  const record = JSON.parse(line);
  const payload = record.message?.payload;
  if (!payload) continue;
  const entry = projectStreamPayload(payload);
  if (!entry) continue;
  const role = ROLES[payload.agentId] ?? payload.agentId;
  perRole[role] ??= {};
  perRole[role][entry.kind] = (perRole[role][entry.kind] ?? 0) + 1;
  if (entry.kind === 'usage' && !perRole[role].__usageShown) {
    perRole[role].__usageShown = true;
    process.stdout.write(`    ${role} usage | ${entry.summary}\n`);
  }
}
for (const [role, kinds] of Object.entries(perRole)) {
  delete kinds.__usageShown;
  process.stdout.write(`${role}: ${JSON.stringify(kinds)}\n`);
  require(kinds.usage > 0, `${role}: no usage entry projected from the stream`);
}

process.stdout.write(`\n${failures === 0 ? 'PROJECTION_CHECK_PASS' : `PROJECTION_CHECK_FAIL (${failures})`}\n`);
process.exit(failures === 0 ? 0 : 1);
