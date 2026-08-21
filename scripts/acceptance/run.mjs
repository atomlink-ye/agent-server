import { execFile as rawExecFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { parse as parseYaml } from 'yaml';

import { readServiceToken } from './credentials.mjs';
import { assertStep8Observation } from './golden-eight.mjs';
import { apiProbeUrl, startAcceptanceEnvironment } from './lifecycle.mjs';
import { checkPreconditions, assertPreconditions } from './preconditions.mjs';
import { assertFinalSql, assertPreflight } from './preflight.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DRIVER = path.join(REPO_ROOT, 'scripts/acceptance/phase0-driver.mjs');
const BROWSER_SCRIPT = path.join(REPO_ROOT, 'scripts/acceptance/phase0-browser.mjs');

async function runDriver(env) {
  const exec = promisify(rawExecFile);
  try {
    const { stdout, stderr } = await exec('node', [DRIVER], {
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { rc: 0, stdout, stderr };
  } catch (error) {
    return {
      rc: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error),
    };
  }
}

export function deriveTerminalFacts(observations, observedWorkRef) {
  if (typeof observedWorkRef !== 'string' || observedWorkRef.trim() === '') {
    throw new Error(
      'final SQL observations: the step-8 observed workRef was not supplied — cannot certify which Work ran',
    );
  }
  const messages = observations?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('final SQL observations: messages not observed');
  }
  const carrier = messages.find((message) => message.work_ref === observedWorkRef);
  if (!carrier) {
    throw new Error(
      `final SQL observations: no message carries the observed workRef ${observedWorkRef} — the Work Card on screen is not backed by an observed message`,
    );
  }
  const works = observations?.works;
  if (!Array.isArray(works) || works.length === 0) {
    throw new Error('final SQL observations: works not observed');
  }
  const runs = observations?.runs;
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error('final SQL observations: work_runs not observed');
  }
  const work = works.find((candidate) => candidate.id === observedWorkRef);
  if (!work) {
    throw new Error(
      `final SQL observations: observed workRef ${observedWorkRef} has no matching work row — association not observed`,
    );
  }
  const run = runs.find((candidate) => candidate.work_id === work.id);
  if (!run) {
    throw new Error(
      `final SQL observations: work ${work.id} has no matching work_run — association not observed`,
    );
  }
  const tasks = observations?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error(
      'final SQL observations: task rows not observed — cannot determine terminal state',
    );
  }
  const task = tasks.find((candidate) => candidate.work_id === work.id);
  if (!task) {
    throw new Error(
      `final SQL observations: work ${work.id} has no bound root task — terminal state not observed`,
    );
  }
  return {
    provider: carrier.provider,
    workRef: observedWorkRef,
    workRun: run.id,
    workStatus: task.status,
  };
}

async function renderedComposeConfig(handle) {
  const exec = promisify(rawExecFile);
  const { composeInvocationForLocalEnvironment } = await import(
    '../../tooling/environment/lifecycle.ts'
  );
  const { command, args, environment } =
    await composeInvocationForLocalEnvironment(handle.state);
  const result = await exec(command, [...args, 'config'], {
    env: environment,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: result.stdout, environment };
}

export function expectedPortsFromEnvironment(environment) {
  const required = {
    postgres: ['AGENT_SERVER_TEST_POSTGRES_PORT', 5432],
    'agent-server': ['AGENT_SERVER_TEST_API_PORT', 3000],
    web: ['AGENT_SERVER_TEST_WEB_PORT', 3001],
  };
  const expected = {};
  const missing = [];
  for (const [service, [variable, target]] of Object.entries(required)) {
    const published = environment[variable];
    if (!published) {
      missing.push(variable);
      continue;
    }
    expected[service] = {
      hostIp: '127.0.0.1',
      published: Number(published),
      target,
    };
  }
  if (missing.length > 0) {
    throw new Error(
      `lifecycle environment did not export: ${missing.join(', ')} — not observed`,
    );
  }
  return expected;
}

export async function waitForHttpReady(
  url,
  budgetMs,
  { intervalMs = 2000, now = () => Date.now(), fetchImpl = fetch } = {},
) {
  const started = now();
  let attempts = 0;
  let lastError = 'no attempt was made';
  while (now() - started < budgetMs) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, { redirect: 'manual' });
      if (response.status > 0) {
        return {
          url,
          ready: true,
          attempts,
          waitedMs: now() - started,
          status: response.status,
        };
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `${url} did not answer within ${budgetMs}ms (${attempts} attempt(s)); last error: ${lastError} — the UI was never ready, so no browser step may run`,
  );
}

async function main() {
  const provider = process.argv[2];
  const model = process.argv[3];
  const evidenceDir = process.argv[4];
  if (!provider || !model || !evidenceDir) {
    throw new Error(
      'usage: acceptance:run <provider> <model> <evidence-dir>',
    );
  }
  const agentEnvPath = process.env.ACCEPTANCE_AGENT_ENV_PATH ?? '/root/.agent-env';
  await mkdir(evidenceDir, { recursive: true });

  const report = await checkPreconditions(REPO_ROOT);
  await writeFile(
    path.join(evidenceDir, 'preconditions.json'),
    JSON.stringify(report, null, 2),
  );
  assertPreconditions(report);
  const { token } = await readServiceToken(agentEnvPath);

  const handle = await startAcceptanceEnvironment({
    provider,
    model,
    runDirectory: evidenceDir,
    projectName:
      process.env.ACCEPTANCE_PROJECT_NAME ?? 'agent-server-acceptance-phase0',
  });
  try {
    const apiUrl = new URL(apiProbeUrl(handle));
    const rendered = await renderedComposeConfig(handle);
    const renderedPorts = parseYaml(rendered.stdout);
    const expectedPorts = expectedPortsFromEnvironment(rendered.environment);
    assertPreflight({
      apiUrl: apiUrl.origin,
      renderedPorts,
      expectedPorts,
      effectiveProvider: rendered.environment.PASEO_PROVIDER,
      requestedProvider: provider,
    });

    // Acceptance now exercises the one canonical Vite application served by
    // the `web` service. There is no second web-vite service or port.
    const browserBaseUrl =
      handle.urls.web ??
      `http://127.0.0.1:${handle.state.ports.web ?? 3001}`;
    const uiReadiness = await waitForHttpReady(browserBaseUrl, 900000);
    await writeFile(
      path.join(evidenceDir, 'ui-readiness.json'),
      JSON.stringify(uiReadiness, null, 2),
    );

    const driverEnv = {
      ...process.env,
      PASEO_PROVIDER: provider,
      R2_EVIDENCE_DIR: evidenceDir,
      AGENT_SERVER_BASE_URL: apiUrl.origin,
      AGENT_SERVER_SERVICE_TOKEN: token,
      R2_BROWSER_BASE_URL: browserBaseUrl,
      R2_BROWSER_IMAGE:
        process.env.R2_BROWSER_IMAGE ?? 'agent-server-web-testing:r2',
      R2_BROWSER_SCRIPT_HOST: BROWSER_SCRIPT,
      R2_COMPOSE_PROJECT: handle.state.projectName,
    };
    const driver = await runDriver(driverEnv);
    await writeFile(
      path.join(evidenceDir, 'driver-stdout.log'),
      driver.stdout,
    );
    await writeFile(
      path.join(evidenceDir, 'driver-stderr.log'),
      driver.stderr,
    );
    if (driver.rc !== 0) {
      throw new Error(
        `golden-eight driver exited rc=${driver.rc}; see driver-stderr.log`,
      );
    }

    const step8 = JSON.parse(
      await readFile(
        path.join(evidenceDir, 'step8-observation.json'),
        'utf8',
      ),
    );
    assertStep8Observation(step8);
    const observations = JSON.parse(
      await readFile(
        path.join(evidenceDir, 'final-sql-observations.json'),
        'utf8',
      ),
    );
    assertFinalSql(deriveTerminalFacts(observations, step8.workRef));
    console.log(
      `PASS acceptance:run at HEAD=${report.head} provider=${provider}`,
    );
  } finally {
    if (process.env.ACCEPTANCE_KEEP_STACK === '1') {
      console.log(
        `ACCEPTANCE_KEEP_STACK=1 — leaving ${handle.state.projectName} up for inspection`,
      );
    } else {
      await handle.stop();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  await main();
}
