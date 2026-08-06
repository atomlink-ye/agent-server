#!/usr/bin/env node

/*
 * A deliberately small MCP-over-stdio server used by the provider probes.
 * There is no SDK dependency here: the probe is also useful when checking
 * whether a provider can speak the wire protocol without its normal runtime.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const logPath = process.env.MCP_PROBE_LOG;
const controlPath = process.env.MCP_PROBE_CONTROL?.trim() || null;

if (!logPath) {
  process.stderr.write('MCP_PROBE_LOG is required\n');
  process.exit(2);
}

let armed = false;
let nonce = null;
let inputBuffer = '';
let shuttingDown = false;
let controlTimer = null;
const calls = new Map();

function record(entry) {
  try {
    appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  } catch (error) {
    process.stderr.write(`mcp probe log error: ${error?.message ?? String(error)}\n`);
  }
}

function frameRecord(dir, frame) {
  record({
    dir,
    method: typeof frame?.method === 'string' ? frame.method : null,
    id: Object.hasOwn(frame ?? {}, 'id') ? frame.id : null,
    params: Object.hasOwn(frame ?? {}, 'params') ? frame.params : null,
  });
}

function send(frame) {
  if (shuttingDown) return;
  frameRecord('out', frame);
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function notification(method, params = {}) {
  send({ jsonrpc: '2.0', method, params });
  record({ event: 'notification_sent', method, params });
}

function arm(source, notify = true) {
  if (!armed) {
    armed = true;
    nonce = randomBytes(12).toString('hex');
    record({ event: 'arm', source, nonce });
  } else {
    record({ event: 'arm', source, nonce, alreadyArmed: true });
  }
  if (notify) notification('notifications/tools/list_changed');
  return nonce;
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function tools() {
  const base = [
    {
      name: 'probe_ping',
      description: 'Return a stable probe marker.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'probe_sleep',
      description: 'Sleep for a bounded number of seconds.',
      inputSchema: {
        type: 'object',
        properties: { seconds: { type: 'number', minimum: 0, maximum: 3600 } },
        required: ['seconds'],
        additionalProperties: false,
      },
    },
    {
      name: 'probe_arm',
      description: 'Arm the probe and refresh the tool list.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
  if (armed) {
    base.push({
      name: 'probe_secret',
      description: 'Return the per-process armed secret marker.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    });
  }
  return base;
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function numberSeconds(value) {
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) return null;
  return seconds;
}

function sleep(seconds, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.round(seconds * 1000));
  });
}

async function callTool(request) {
  const id = request.id;
  const params = request.params && typeof request.params === 'object' ? request.params : {};
  const name = params.name;
  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  const controller = new AbortController();
  calls.set(String(id), controller);
  record({ event: 'call_start', id, tool: name, params: args });
  try {
    let result;
    if (name === 'probe_ping') {
      result = textResult('PROBE_PING_OK');
    } else if (name === 'probe_arm') {
      result = textResult(`ARMED_${arm('tool', true)}`);
    } else if (name === 'probe_secret') {
      result = armed
        ? textResult(`SECRET_OK_${nonce}`)
        : errorResponse(id, -32004, 'probe_secret is not armed');
    } else if (name === 'probe_sleep') {
      const seconds = numberSeconds(args.seconds);
      if (seconds === null) {
        result = errorResponse(id, -32602, 'seconds must be a number from 0 to 3600');
      } else {
        await sleep(seconds, controller.signal);
        result = textResult(`SLEPT_${seconds}`);
      }
    } else {
      result = errorResponse(id, -32601, `Unknown tool: ${String(name)}`);
    }
    if (!controller.signal.aborted) {
      send(result.error ? { ...result, id } : response(id, result));
    }
    record({ event: 'call_finish', id, tool: name, cancelled: controller.signal.aborted });
  } catch (error) {
    if (error?.code === 'cancelled' || controller.signal.aborted) {
      record({ event: 'call_finish', id, tool: name, cancelled: true });
      return;
    }
    record({ event: 'error', phase: 'call', id, tool: name, message: error?.message ?? String(error) });
    send(errorResponse(id, -32603, 'Internal probe error'));
    record({ event: 'call_finish', id, tool: name, cancelled: false, error: true });
  } finally {
    calls.delete(String(id));
  }
}

async function handle(frame) {
  if (!frame || typeof frame !== 'object' || frame.jsonrpc !== '2.0') return;
  frameRecord('in', frame);
  const method = frame.method;
  const id = frame.id;
  if (method === 'notifications/cancelled') {
    const requestId = frame.params?.requestId;
    const controller = calls.get(String(requestId));
    if (controller) controller.abort();
    record({ event: 'cancellation', requestId, found: Boolean(controller) });
    return;
  }
  if (id === undefined && typeof method === 'string') {
    if (method === 'notifications/initialized') record({ event: 'initialized_notification' });
    return;
  }
  if (method === 'initialize') {
    send(response(id, {
      protocolVersion:
        typeof frame.params?.protocolVersion === 'string'
          ? frame.params.protocolVersion
          : '2024-11-05',
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'mcp-probe-server', version: '0.1.0' },
      instructions: 'Use probe_ping, probe_arm, probe_sleep, and probe_secret when advertised.',
    }));
    return;
  }
  if (method === 'ping') {
    send(response(id, {}));
    return;
  }
  if (method === 'tools/list') {
    send(response(id, { tools: tools() }));
    return;
  }
  if (method === 'tools/call') {
    await callTool(frame);
    return;
  }
  send(errorResponse(id, -32601, `Method not found: ${String(method)}`));
}

function pollControl() {
  if (!controlPath || shuttingDown || !existsSync(controlPath)) return;
  try {
    const raw = readFileSync(controlPath, 'utf8').trim();
    if (!raw) return;
    const command = JSON.parse(raw);
    if (command?.action === 'arm') {
      arm('control', command.notify !== false);
      // Consume the command so a polling loop cannot emit duplicate events.
      record({ event: 'control_arm_consumed', notify: command.notify !== false, tokenPresent: Boolean(command.token) });
      try { writeFileSync(controlPath, ''); } catch { /* best effort; command remains idempotent */ }
    }
  } catch (error) {
    record({ event: 'error', phase: 'control', message: error?.message ?? String(error) });
  }
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (controlTimer) clearInterval(controlTimer);
  for (const controller of calls.values()) controller.abort();
  record({ event: reason === 'stdin_eof' ? 'stdin_eof' : 'signal', signal: reason });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    shutdown(signal);
    process.exitCode = 0;
    process.stdin.pause();
    // Abort pending sleeps and leave the stdio child promptly. The event is
    // recorded synchronously above before terminating the process.
    process.exit(0);
  });
}
process.once('uncaughtException', (error) => {
  record({ event: 'error', phase: 'uncaughtException', message: error?.message ?? String(error) });
  process.exitCode = 1;
  shutdown('error');
});
process.once('unhandledRejection', (error) => {
  record({ event: 'error', phase: 'unhandledRejection', message: error?.message ?? String(error) });
  process.exitCode = 1;
  shutdown('error');
});

if (controlPath) controlTimer = setInterval(pollControl, 100);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  let newline;
  while ((newline = inputBuffer.indexOf('\n')) >= 0) {
    const line = inputBuffer.slice(0, newline).replace(/\r$/, '');
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line.trim()) continue;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch (error) {
      record({ event: 'error', phase: 'parse', message: error?.message ?? String(error) });
      continue;
    }
    void handle(frame);
  }
});
process.stdin.on('end', () => {
  if (inputBuffer.trim()) {
    try { void handle(JSON.parse(inputBuffer)); } catch (error) {
      record({ event: 'error', phase: 'parse', message: error?.message ?? String(error) });
    }
  }
  shutdown('stdin_eof');
});
