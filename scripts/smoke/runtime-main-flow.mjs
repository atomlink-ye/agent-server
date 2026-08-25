#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { loadRealProviderDefaults } from '../dev/real-provider-defaults.mjs';
import {
  runCompositionSingleWorkerSmoke,
  runCompositionSingleWorkerInlineSmoke,
} from './composition-single-agent.mjs';

const realProviderDefaults = loadRealProviderDefaults();

const baseUrl = process.env.AGENT_SERVER_BASE_URL?.trim();
const token = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
const workspaceId = process.env.AGENT_SERVER_WORKSPACE_ID?.trim();
const marker = `AGENT_SERVER_PROVIDER_SMOKE_${randomUUID()}`;
const markerSha256 = sha256(marker);
const startedAt = Date.now();
const stageTimeouts = {
  readiness: 480_000,
  run: 480_000,
};
const progressIntervalMs = 5_000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(stage, message) {
  process.stdout.write(
    `${JSON.stringify({ outcome: 'FAIL', stage, message })}\n`,
  );
  process.exitCode = 1;
}

function progress(stage, details = {}) {
  process.stdout.write(
    `${JSON.stringify({
      event: 'runtime_smoke_progress',
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      stage,
      ...details,
    })}\n`,
  );
}

function usageSummary(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const fields = ['input_tokens', 'output_tokens', 'total_cost_usd'];
  const summary = Object.fromEntries(
    fields
      .filter((field) => Number.isFinite(usage[field]))
      .map((field) => [field, usage[field]]),
  );
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function expectedRuntimeModel(provider, model) {
  const prefix = 'opencode-go/';
  const stripsProviderPrefix = provider === 'claude' || provider === 'codex';
  return stripsProviderPrefix && model.startsWith(prefix)
    ? model.slice(prefix.length)
    : model;
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
  let nextProgressAt = Date.now();
  while (Date.now() < deadline) {
    try {
      const response = await request('/health/ready');
      if (response.ok) return;
    } catch {
      // Retry until the bounded deadline.
    }
    if (Date.now() >= nextProgressAt) {
      progress('waiting_for_api_readiness');
      nextProgressAt = Date.now() + progressIntervalMs;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('readiness_timeout');
}

async function pollRun(runId) {
  const deadline = Date.now() + stageTimeouts.run;
  let lastTransientFailure = 'none';
  let lastStatus;
  let lastUsage;
  let nextProgressAt = Date.now();
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
        const usage = usageSummary(body.usage);
        const usageChanged =
          JSON.stringify(usage) !== JSON.stringify(lastUsage);
        if (
          body.status !== lastStatus ||
          usageChanged ||
          Date.now() >= nextProgressAt
        ) {
          progress('run_progress', {
            run_id: runId,
            status: body.status,
            ...(body.runtime ? { runtime: body.runtime } : {}),
            ...(usage ? { usage } : {}),
          });
          lastStatus = body.status;
          lastUsage = usage;
          nextProgressAt = Date.now() + progressIntervalMs;
        }
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
  if (!baseUrl || !token || !workspaceId) {
    fail(
      'setup',
      'AGENT_SERVER_BASE_URL, AGENT_SERVER_SERVICE_TOKEN and AGENT_SERVER_WORKSPACE_ID are required',
    );
    return;
  }

  let stage = 'readiness';
  try {
    progress('started', {
      provider: realProviderDefaults.PASEO_PROVIDER,
      model: realProviderDefaults.PASEO_MODEL,
      environment: 'runtime',
    });
    await pollReady();
    progress('api_ready');

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
    progress('run_created', { run_id: created.run_id });

    stage = 'poll_run';
    const completed = await pollRun(created.run_id);
    const runtime = completed.runtime ?? null;
    const usage = completed.usage ?? null;
    const resultText = completed.result?.text;
    const markerMatched = resultText === marker;
    const expectedModel = expectedRuntimeModel(
      realProviderDefaults.PASEO_PROVIDER,
      realProviderDefaults.PASEO_MODEL,
    );
    const accepted =
      completed.status === 'succeeded' &&
      runtime?.provider === realProviderDefaults.PASEO_PROVIDER &&
      runtime?.model === expectedModel &&
      markerMatched &&
      Number.isFinite(usage?.input_tokens) &&
      usage.input_tokens > 0 &&
      Number.isFinite(usage?.output_tokens) &&
      usage.output_tokens > 0 &&
      Number.isFinite(usage?.total_cost_usd) &&
      usage.total_cost_usd > 0;
    stage = 'assertions';
    if (!accepted) throw new Error('run_assertions_failed');

    progress('agent_output', { run_id: created.run_id, text: resultText });
    progress('direct_runtime_completed', {
      run_id: created.run_id,
      status: completed.status,
      runtime,
      usage: usageSummary(usage),
    });

    stage = 'composition_single_worker';
    const compositionSingleWorker = await runCompositionSingleWorkerSmoke({
      baseUrl,
      token,
      workspaceId,
      expectedProvider: realProviderDefaults.PASEO_PROVIDER,
      expectedModel,
      timeoutMs: stageTimeouts.run,
      progress,
    });

    stage = 'composition_single_worker_inline';
    const compositionSingleWorkerInline =
      await runCompositionSingleWorkerInlineSmoke({
        baseUrl,
        token,
        workspaceId,
        expectedProvider: realProviderDefaults.PASEO_PROVIDER,
        expectedModel,
        timeoutMs: stageTimeouts.run,
        progress,
      });

    progress('completed', {
      run_id: created.run_id,
      composition_single_worker_work_id: compositionSingleWorker.workId,
      composition_single_worker_work_run_id: compositionSingleWorker.workRunId,
      composition_single_worker_inline_work_id:
        compositionSingleWorkerInline.workId,
      composition_single_worker_inline_work_run_id:
        compositionSingleWorkerInline.workRunId,
    });
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
        composition_single_worker: compositionSingleWorker,
        composition_single_worker_inline: compositionSingleWorkerInline,
        duration_ms: Date.now() - startedAt,
      })}\n`,
    );
  } catch (error) {
    fail(stage, error instanceof Error ? error.message : 'unknown_error');
  }
}

await main();
