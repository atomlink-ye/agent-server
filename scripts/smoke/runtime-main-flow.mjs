#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { loadRealProviderDefaults } from '../dev/real-provider-defaults.mjs';

const realProviderDefaults = loadRealProviderDefaults();

const baseUrl = process.env.AGENT_SERVER_BASE_URL?.trim();
const token = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
const marker = `AGENT_SERVER_PROVIDER_SMOKE_${randomUUID()}`;
const markerSha256 = sha256(marker);
const startedAt = Date.now();
const stageTimeouts = {
  // Make completes dependency bootstrap before starting the stack, so this
  // window only needs to remain outside the daemon's declared startup gate.
  // It does not override any runtime timeout.
  readiness: 480_000,
  run: 480_000,
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(stage, message) {
  process.stdout.write(
    `${JSON.stringify({ outcome: 'FAIL', stage, message })}\n`,
  );
  process.exitCode = 1;
}

function endpoint(path) {
  try {
    return new URL(path, baseUrl);
  } catch {
    throw new Error('invalid_base_url');
  }
}

async function request(path, options = {}) {
  try {
    return await fetch(endpoint(path), {
      ...options,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error('http_unavailable');
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error('invalid_json_response');
  }
}

async function pollReady() {
  const deadline = Date.now() + stageTimeouts.readiness;
  while (Date.now() < deadline) {
    try {
      const response = await request('/health/ready');
      if (response.ok) return;
    } catch {
      // Retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('readiness_timeout');
}

async function pollRun(runId) {
  const deadline = Date.now() + stageTimeouts.run;
  let lastTransientFailure = 'none';
  while (Date.now() < deadline) {
    try {
      const response = await request(
        `/api/v1/runs/${encodeURIComponent(runId)}`,
      );
      if (response.status === 401 || response.status === 403) {
        throw new Error(`run_poll_authorization_error_${response.status}`);
      }
      if (response.status === 404) {
        throw new Error('run_poll_not_found');
      }
      if (!response.ok) {
        lastTransientFailure = `http_${response.status}`;
      } else {
        const body = await readJson(response);
        if (
          ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(
            body.status,
          )
        ) {
          return body;
        }
        lastTransientFailure = 'none';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      if (
        message.startsWith('run_poll_authorization_error_') ||
        message === 'run_poll_not_found' ||
        message === 'invalid_json_response'
      ) {
        throw error;
      }
      lastTransientFailure = message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`run_poll_timeout:last_transient=${lastTransientFailure}`);
}

async function main() {
  if (!baseUrl || !token) {
    fail(
      'setup',
      'AGENT_SERVER_BASE_URL and AGENT_SERVER_SERVICE_TOKEN are required',
    );
    return;
  }

  let stage = 'readiness';
  try {
    await pollReady();

    stage = 'create_run';
    const createdResponse = await request('/api/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: `Reply with exactly this marker and no other text: ${marker}`,
      }),
    });
    if (createdResponse.status !== 202)
      throw new Error('run_create_http_error');
    const created = await readJson(createdResponse);
    if (typeof created.run_id !== 'string' || !created.run_id) {
      throw new Error('run_create_invalid_response');
    }

    stage = 'poll_run';
    const completed = await pollRun(created.run_id);
    const runtime = completed.runtime ?? null;
    const usage = completed.usage ?? null;
    const resultText = completed.result?.text;
    const markerMatched = resultText === marker;
    const accepted =
      completed.status === 'succeeded' &&
      runtime?.provider === realProviderDefaults.PASEO_PROVIDER &&
      runtime?.model === realProviderDefaults.PASEO_MODEL &&
      markerMatched &&
      Number.isFinite(usage?.input_tokens) &&
      usage.input_tokens > 0 &&
      Number.isFinite(usage?.output_tokens) &&
      usage.output_tokens > 0 &&
      Number.isFinite(usage?.total_cost_usd) &&
      usage.total_cost_usd > 0;
    stage = 'assertions';
    if (!accepted) throw new Error('run_assertions_failed');

    process.stdout.write(
      `${JSON.stringify({
        outcome: 'PASS',
        run_id: created.run_id,
        runtime,
        usage,
        marker: { sha256: markerSha256, length: marker.length },
        result: {
          sha256: typeof resultText === 'string' ? sha256(resultText) : null,
          marker_matched: markerMatched,
        },
        duration_ms: Date.now() - startedAt,
      })}\n`,
    );
  } catch (error) {
    fail(stage, error instanceof Error ? error.message : 'unknown_error');
  }
}

await main();
