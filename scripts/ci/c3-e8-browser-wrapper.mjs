import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export const BROWSER_ZERO_MARKER = 'c3_e8_browser_zero_execution';

function stripAnsi(value) {
  return value.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}
export function parseVitestSummary(raw) {
  const text = stripAnsi(String(raw));
  const files = text.match(/Test Files\s+(\d+)\s+passed(?:\s*\([^)]*\))?\s*\((\d+)\s*\)/u);
  const tests = text.match(/Tests\s+(\d+)\s+passed(?:\s+(\d+)\s+skipped)?(?:\s+(\d+)\s+todo)?\s*\((\d+)\s*\)/u);
  if (!files || !tests) return null;
  return {
    files: Number(files[1]),
    fileTotal: Number(files[2]),
    tests: Number(tests[1]),
    skipped: Number(tests[2] ?? 0),
    todo: Number(tests[3] ?? 0),
    testTotal: Number(tests[4]),
  };
}

export function browserSummaryOutcome(summary) {
  if (!summary)
    return { process: 2, marker: `${BROWSER_ZERO_MARKER}:reason=summary-unparseable` };
  const valid =
    summary.files >= 1 &&
    summary.fileTotal >= 1 &&
    summary.tests >= 2 &&
    summary.testTotal >= 2 &&
    summary.tests === summary.testTotal &&
    summary.skipped === 0 &&
    summary.todo === 0;
  if (!valid)
    return {
      process: 2,
      marker: `${BROWSER_ZERO_MARKER}:files=${summary.fileTotal}:tests=${summary.testTotal}:skipped=${summary.skipped}:todo=${summary.todo}`,
    };
  return { process: 0, marker: null };
}

function runFixedVitest(cwd) {
  return new Promise((resolveResult) => {
    const child = spawn(
      'pnpm',
      ['exec', 'vitest', '--config', 'vitest.web.config.ts', '--run', 'apps/web/components/work/work-list.browser.test.tsx'],
      { cwd, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/opt/playwright-browsers' }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => resolveResult({ code: null, signal: null, spawnError: error, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    child.on('close', (code, signal) => resolveResult({ code, signal, spawnError: null, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

export async function runBrowserWrapper({ cwd = process.cwd(), evidenceDirectory } = {}) {
  const result = await runFixedVitest(cwd);
  const summary = parseVitestSummary(result.stdout.toString('utf8'));
  const summaryOutcome = browserSummaryOutcome(summary);
  const outcome = result.spawnError || result.signal || result.code === null
    ? { process: 2, marker: `${BROWSER_ZERO_MARKER}:reason=runner-unavailable` }
    : result.code === 0
      ? summaryOutcome
      : { process: result.code, marker: null };
  if (evidenceDirectory) {
    const directory = resolve(evidenceDirectory);
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(resolve(directory, 'raw.stdout'), result.stdout),
      writeFile(resolve(directory, 'raw.stderr'), result.stderr),
      writeFile(resolve(directory, 'raw.exit'), `${result.code ?? 2}\n`),
      writeFile(resolve(directory, 'summary.json'), `${JSON.stringify(summary)}\n`),
      writeFile(resolve(directory, 'wrapper.exit'), `${outcome.process}\n`),
    ]);
  }
  if (outcome.marker) process.stdout.write(`${outcome.marker}\n`);
  return { ...outcome, result, summary };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const directory = process.argv[2] === '--evidence' ? process.argv[3] : undefined;
  runBrowserWrapper({ evidenceDirectory: directory }).then(({ process: code }) => {
    process.exitCode = code;
  }).catch(() => {
    process.stdout.write(`${BROWSER_ZERO_MARKER}:reason=wrapper-error\n`);
    process.exitCode = 2;
  });
}
