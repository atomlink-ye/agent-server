import { readFileSync, writeFileSync } from 'node:fs';

export const PRODUCTION_MUTATION_ARMS = Object.freeze([
  'late-runs',
  'never-settle',
  'status-read',
  'container-identity',
]);

const mutations = {
  'late-runs': [
    'setWorks(response.works);',
    "setWorks(response.works); setTimeout(() => { void fetch('/api/works/' + encodeURIComponent(response.works[0]?.id ?? '') + '/runs'); }, 100);",
  ],
  'never-settle': [
    'const response = await fetch(path, {',
    "const response = path === '/api/works' ? await new Promise(() => {}) : await fetch(path, {",
  ],
  'status-read': [
    'setWorks(response.works);',
    'void response.works[0]?.status; setWorks(response.works);',
  ],
  'container-identity': [
    'data-testid="work-list"',
    'data-testid="work-list-mutated"',
  ],
};

export function applyProductionMutation(source, arm) {
  const mutation = mutations[arm];
  if (!mutation) throw new Error(`unknown_production_mutation:${arm}`);
  if (!source.includes(mutation[0])) throw new Error(`mutation_target_missing:${arm}`);
  return source.replace(mutation[0], mutation[1]);
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
