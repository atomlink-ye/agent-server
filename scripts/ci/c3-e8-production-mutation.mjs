import { readFileSync, writeFileSync } from 'node:fs';

export const PRODUCTION_MUTATION_ARMS = Object.freeze([
  'completed-status',
  'unavailable-disclosure',
  'runs-n-plus-one',
  'container-identity',
  'late-runs',
  'never-settle',
]);

export const PRODUCTION_MUTATION_EXPECTATIONS = Object.freeze({
  'completed-status': 'work-list-semantic-read:runs',
  'unavailable-disclosure': 'Product status is currently unavailable for this Work.',
  'runs-n-plus-one': 'to have a length of 1 but got 3',
  'container-identity': '[data-testid="work-list"]',
  'late-runs': 'request-ledger-incomplete:post-seal-activity',
  'never-settle': 'c3_e8_observation_missing:reason=request-ledger-incomplete',
});

const mutations = {
  'completed-status': [
    ['Product status is currently unavailable for this Work.',
      "{work.runs?.[0]?.status === 'succeeded' ? 'Completed' : 'Product status is currently unavailable for this Work.'}"],
  ],
  'unavailable-disclosure': [
    ['Product status is currently unavailable for this Work.',
      'Product status disclosure was removed.'],
  ],
  'runs-n-plus-one': [
    ['setWorks(response.works);',
      "setWorks(response.works); setTimeout(() => { for (const work of response.works) void fetch('/api/works/' + encodeURIComponent(work.id) + '/runs'); }, 0);"],
  ],
  'container-identity': [
    ['data-testid="work-list"', 'data-testid="work-list-mutated"'],
  ],
  'late-runs': [
    ['setWorks(response.works);',
      "setWorks(response.works); setTimeout(() => { void fetch('/api/works/' + encodeURIComponent(response.works[0]?.id ?? '') + '/runs'); }, 100);"],
  ],
  'never-settle': [
    ["readJson<WorkListResponse>('/api/works')",
      "readJson<WorkListResponse>('/api/works?c3_e8_observation_missing=ledger')"],
    ['const response = await fetch(path, {',
      "const response = path === '/api/works?c3_e8_observation_missing=ledger' ? await fetch(path, { headers: { 'x-c3-e8-observation': 'request-ledger' } }) : await fetch(path, {"],
  ],
};

export function applyProductionMutation(source, arm) {
  const replacements = mutations[arm];
  if (!replacements) throw new Error(`unknown_production_mutation:${arm}`);
  return replacements.reduce((current, [needle, replacement]) => {
    if (!current.includes(needle)) throw new Error(`mutation_target_missing:${arm}`);
    return current.replace(needle, replacement);
  }, source);
}

export function countTargetAssertions(arm, rawOutput) {
  const pattern = PRODUCTION_MUTATION_EXPECTATIONS[arm];
  if (!pattern) throw new Error(`unknown_production_mutation:${arm}`);
  return String(rawOutput).split(/\r?\n/u).filter((line) => {
    if (arm === 'runs-n-plus-one')
      return line.includes(pattern);
    return line.includes(pattern);
  }).length;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [sourcePath, arm] = process.argv.slice(2);
  if (!sourcePath || !arm) {
    process.stderr.write('usage: node c3-e8-production-mutation.mjs <source> <arm>\n');
    process.exitCode = 2;
  } else {
    const source = readFileSync(sourcePath, 'utf8');
    writeFileSync(sourcePath, applyProductionMutation(source, arm));
  }
}
