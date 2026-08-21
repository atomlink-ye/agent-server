import { mkdir, writeFile } from 'node:fs/promises';
import { execFile as rawExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(rawExecFile);
const evidence = required('R2_EVIDENCE_DIR');
const baseUrl = required('AGENT_SERVER_BASE_URL');
const token = required('AGENT_SERVER_SERVICE_TOKEN');
const browserBaseUrl = required('R2_BROWSER_BASE_URL');
const browserImage = required('R2_BROWSER_IMAGE');
const browserScript = required('R2_BROWSER_SCRIPT_HOST');
const composeProject = required('R2_COMPOSE_PROJECT');
const marker = 'R2_GOLDEN_CHAT_WORK_20260820';
const agentName = 'r2-golden-chat-work';
const tenantId = 'tenant_local';
const operations = [];

// 🔴 Auditor finding-1-24209abe(2)：本文件可被直接执行且含冻结的产品 POST 动作。
// 闸门只挡在 run.mjs 里是不够的 —— 直接调用本文件即可绕过。所以这里也必须过闸门。
// ⛔ 不许为了"方便调试"加环境变量跳过它。
{
  const { checkPreconditions, assertPreconditions } = await import('./preconditions.mjs');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const gateReport = await checkPreconditions(repoRoot);
  assertPreconditions(gateReport);
}

await mkdir(evidence, { recursive: true });

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function redact(value, key = '') {
  if (/authorization|token|api.?key|secret/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return typeof value === 'string' ? value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]') : value;
}

async function save(name, value) {
  await writeFile(`${evidence}/${name}`, `${JSON.stringify(redact(value), null, 2)}\n`, 'utf8');
}

async function record(name, command, route, action) {
  try {
    const result = await action();
    operations.push({ step: name, command, public_entry: route, status: 'ok', result: redact(result) });
    await save('commands-record.json', commandRecord());
    return result;
  } catch (error) {
    operations.push({ step: name, command, public_entry: route, status: 'failed', error: String(error) });
    await save('commands-record.json', commandRecord());
    throw error;
  }
}

function commandRecord() {
  return {
    title: 'R2/R3 clean-db golden path: one complete frozen eight-product-operation sequence',
    environment_preflight: [
      'Integrated branch typecheck and build passed before this run.',
      'Postgres accepting and not in recovery; relevant tables empty; /health/ready three checks ready.',
      'The running agent-server effective profile was sampled from its container: paseo / claude / opencode-go/deepseek-v4-flash.',
      'A Dockerfile web-testing image launched Chromium and reached the browser base URL before this run.',
    ],
    prior_attempts: [
      { attempt: 1, result: 'driver module-resolution failure before any product API call; no product state created' },
      { attempt: 2, result: 'read-only direct pg observation connection failure before product behavior; no product state created' },
      { attempt: 3, result: 'Postgres recovery-mode environment failure before the frozen sequence; no product state created' },
      { attempt: 4, result: 'effective runtime profile preflight correctly rejected provider=opencode before the frozen sequence; no product state created' },
    ],
    operations,
    constraints: {
      browser_actions: 'Steps 6 and 8 are separate real Playwright browser invocations in the same sandbox and same sequence.',
      forbidden: ['manual runtime ensure', 'seed script', 'direct SQL state mutation', 'product-entry bypass'],
      provider_gate: 'chat_messages.provider must equal claude or codex; opencode is not an accepted terminal provider.',
    },
  };
}

async function api(method, path, body, idempotencyKey) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${text}`);
  return { status: response.status, payload };
}

async function query(sql, values = []) {
  const bound = sql.replace(/\$(\d+)/g, (_, number) => {
    const value = values[Number(number) - 1];
    if (value === undefined) throw new Error(`missing SQL parameter ${number}`);
    return `'${String(value).replaceAll("'", "''")}'`;
  });
  const wrapped = `SELECT COALESCE(json_agg(row_to_json(observation)), '[]'::json)::text FROM (${bound}) AS observation`;
  const { stdout } = await execFile('docker', [
    'compose', '-p', composeProject, 'exec', '-T', 'postgres', 'psql',
    '-v', 'ON_ERROR_STOP=1', '-U', 'agent', '-d', 'agent_server', '-At', '-c', wrapped,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout.trim() || '[]');
}

function agentSource(instructions) {
  return [
    'apiVersion: agent-server/v1alpha1', 'kind: ManagedAgent', 'metadata:', `  name: ${agentName}`,
    'spec:', '  description: R2 golden direct-chat agent', '  instructions: |-',
    ...instructions.split('\n').map((line) => `    ${line}`), '  runtime:', '    provider: paseo',
    '    modelPolicyRef: free-only', '    mode: isolated', '  tools: []', '  skills: []', '  input:',
    '    schema:', '      type: object', '      properties: {}', '      additionalProperties: false',
    '    prompt: "Complete the assigned task."', '  session:', '    invocation: fresh_per_invocation',
    '    followUps: queued', '    binding: reusable', '  memory:', '    policy: workspace_snapshot',
    '    proposalLimit: 0', '  permissions:', '    network: none', '    filesystem: none',
    '  completion:', '    type: executable', '    command: "done"', '',
  ].join('\n');
}

function workSource(versionId) {
  return [
    'apiVersion: agentserver.dev/v1alpha1', 'kind: WorkDefinition', 'metadata:', '  name: r2-golden-work',
    '  description: R2 golden Product Work definition', 'spec:', '  kind: single_agent', `  agent_version_id: ${versionId}`,
    '  environment:', '    source: |', '      apiVersion: agent-server/v1alpha1', '      kind: ManagedEnvironment',
    '      metadata:', '        name: r2-golden-environment', '      spec:', '        adapter: paseo', '        provider: claude',
    '        modelPolicyRef: free-only', '        runtimeCellPolicy: per_runtime_session', '  memory_version_ids: []',
    '  input_schema:', '    type: object', '    properties:', '      question:', '        type: string', '        min_length: 1',
    '        max_length: 4000', '    required: [question]', '    additional_properties: false', '',
  ].join('\n');
}

async function browser(mode, values) {
  const output = `${evidence}/browser-${mode}`;
  await mkdir(output, { recursive: true });
  const env = [
    `R2_BROWSER_MODE=${mode}`, `CHAT_BASE_URL=${browserBaseUrl}`,
    `PUBLISHED_AGENT_DEFINITION_ID=${values.definitionId}`, 'EVIDENCE_OUTPUT_DIR=/evidence',
    ...(mode === 'send' ? [`R2_CONVERSATION_ID=${values.conversationId}`, `CHAT_PROMPT=${values.prompt}`, 'MAX_WAIT_MS=600000'] : []),
  ];
  const args = ['run', '--rm', '--network', 'host', '--user', '0',
    '-v', `${browserScript}:/workspace/r2-browser.mjs:ro`, '-v', `${output}:/evidence`,
    ...env.flatMap((item) => ['-e', item]), browserImage, 'node', '/workspace/r2-browser.mjs'];
  const { stdout, stderr } = await execFile('docker', args, { maxBuffer: 16 * 1024 * 1024 });
  await save(`browser-${mode}-stdout.json`, { stdout, stderr });
  if (mode === 'create') {
    const match = stdout.match(/^R2_CONVERSATION_ID=([0-9a-f-]+)$/m);
    if (!match) throw new Error('Browser create did not emit R2_CONVERSATION_ID.');
    return { conversationId: match[1], stdout: stdout.trim() };
  }
  return { stdout: stdout.trim() };
}

async function effectiveProfile() {
  const { stdout } = await execFile('docker', ['compose', '-p', composeProject, 'exec', '-T', 'agent-server', 'node', '-e',
    "console.log(JSON.stringify({runtime_adapter:process.env.RUNTIME_ADAPTER||'unavailable',runtime_provider:process.env.PASEO_PROVIDER||'unavailable',runtime_model:process.env.PASEO_MODEL||'unavailable',runtime_gateway:(process.env.PASEO_MODEL||'').split('/')[0]||'unavailable'}))"],
  );
  return JSON.parse(stdout.trim());
}

async function captureRuntimeEvidence(definitionId, conversationId) {
  const grants = await execFile('docker', ['compose', '-p', composeProject, 'exec', '-T', 'agent-server', 'node', '-e',
    "const fs=require('node:fs');const p='/workspace/.local/skill-receipts/grants';const out=[];for(const f of fs.readdirSync(p)){const x=JSON.parse(fs.readFileSync(p+'/'+f));if(x.chatContext?.conversationId===process.argv[1])out.push({file:f,grantId:x.grantId,allowedTools:x.allowedTools,chatContext:x.chatContext})};console.log(JSON.stringify(out))", conversationId],
  );
  let parsedGrants = JSON.parse(grants.stdout || '[]');
  await save('grant-receipts-redacted.json', parsedGrants);
  const expectedTools = ['agent-server/list-agent-workflows', 'agent-server/product-work-run-start'];
  if (!parsedGrants.length || !parsedGrants.every((grant) => JSON.stringify(grant.allowedTools) === JSON.stringify(expectedTools))) {
    throw new Error('Grant receipt did not expose exactly the fixed two Product Work tools.');
  }

  const listing = await execFile('docker', ['compose', '-p', composeProject, 'exec', '-T', 'paseo-runtime', 'paseo', '--json', 'ls']);
  let agents;
  try { agents = JSON.parse(listing.stdout); } catch { agents = { raw: listing.stdout }; }
  await save('paseo-ls-redacted.json', agents);
  const rows = Array.isArray(agents) ? agents : agents.agents ?? [];
  const candidates = rows.filter((agent) => agent?.title === `Chat ${definitionId}` || agent?.labels?.conversation_id === conversationId);
  const inspected = [];
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const result = await execFile('docker', ['compose', '-p', composeProject, 'exec', '-T', 'paseo-runtime', 'paseo', '--json', 'inspect', candidate.id]);
    try { inspected.push({ id: candidate.id, value: JSON.parse(result.stdout) }); } catch { inspected.push({ id: candidate.id, value: { raw: result.stdout } }); }
  }
  await save('paseo-inspect-redacted.json', inspected);
  const usage = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && typeof value.inputTokens === 'number' && typeof value.outputTokens === 'number') {
      usage.push({ input_tokens: value.inputTokens, output_tokens: value.outputTokens, total_tokens: value.inputTokens + value.outputTokens, total_tokens_source: 'derived input_tokens + output_tokens; provider supplied no total_tokens field' });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(inspected);
  await save('provider-usage.json', { candidates: usage });
  if (!usage.some((entry) => entry.input_tokens > 0 && entry.output_tokens > 0 && entry.total_tokens > 0)) {
    throw new Error('No positive provider input/output usage found.');
  }
}

async function finalObservations(definitionId, conversationId) {
  const observations = {
    runtime: await query('SELECT tenant_id, agent_definition_id, active_agent_version_id, epoch, status FROM agent_chat_runtimes WHERE tenant_id=$1 AND agent_definition_id=$2', [tenantId, definitionId]),
    messages: await query('SELECT sequence, author_type, provider, work_ref, delivery_id, body FROM chat_messages WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY sequence', [tenantId, conversationId]),
    links: await query('SELECT conversation_id, work_id, trigger_message_id FROM conversation_work_links WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY created_at', [tenantId, conversationId]),
    works: await query('SELECT id, status FROM works WHERE tenant_id=$1 ORDER BY created_at', [tenantId]),
    runs: await query('SELECT id, work_id, status FROM work_runs WHERE tenant_id=$1 ORDER BY created_at', [tenantId]),
  };
  await save('final-sql-observations.json', observations);
  const accepted = observations.messages.filter((message) => ['claude', 'codex'].includes(message.provider) && message.work_ref);
  if (!accepted.length) throw new Error('No durable reply row has terminal provider claude/codex and a non-null work_ref.');
  return observations;
}

let definitionId;
let workVersionId;
let conversationId;
try {
  const importV1 = await record(1, 'POST /api/v1/agents:import (v1)', 'src/entrypoints/api/routes/agents.ts:45-73', () => api('POST', '/api/v1/agents:import', { source: agentSource('You are the worker agent in the authored R2 Golden Product Work definition. Answer the input question concisely.') }, 'r2-golden-v1-import'));
  definitionId = importV1.payload.agent.id;
  const versionV1 = importV1.payload.version.id;
  await record(2, 'POST /api/v1/agent-versions/:versionId:publish (v1)', 'src/entrypoints/api/routes/agents.ts:175-207', () => api('POST', `/api/v1/agent-versions/${versionV1}:publish`, {}, 'r2-golden-v1-publish'));
  await save('runtime-after-v1-publish.json', await query('SELECT tenant_id, agent_definition_id, active_agent_version_id, epoch, status FROM agent_chat_runtimes WHERE tenant_id=$1 AND agent_definition_id=$2', [tenantId, definitionId]));
  const applied = await record(3, 'POST /api/v1/work-definitions:apply', 'src/entrypoints/api/routes/product-work-definitions.ts:54-142', () => api('POST', '/api/v1/work-definitions:apply', { source: workSource(versionV1) }, 'r2-golden-work-apply'));
  workVersionId = applied.payload.version.id;
  const instructions = `You are the direct R2 Golden Chat agent. You must call the product Work tool start_work exactly once.\nCall start_work with work_definition_version_id ${workVersionId} and input {"question":"${marker}"}.\nAfter the tool call succeeds, reply exactly: ${marker} ${workVersionId}\nDo not call any other Work creation tool and do not invent a version id.`;
  const importV2 = await record(4, 'POST /api/v1/agents:import (v2 with Work version in instructions)', 'src/entrypoints/api/routes/agents.ts:45-73', () => api('POST', '/api/v1/agents:import', { source: agentSource(instructions) }, 'r2-golden-v2-import'));
  if (importV2.payload.agent.id !== definitionId) throw new Error('Second import unexpectedly created another AgentDefinition.');
  const versionV2 = importV2.payload.version.id;
  await record(5, 'POST /api/v1/agent-versions/:versionId:publish (v2)', 'src/entrypoints/api/routes/agents.ts:175-207', () => api('POST', `/api/v1/agent-versions/${versionV2}:publish`, {}, 'r2-golden-v2-publish'));
  await save('runtime-after-v2-publish.json', await query('SELECT tenant_id, agent_definition_id, active_agent_version_id, epoch, status FROM agent_chat_runtimes WHERE tenant_id=$1 AND agent_definition_id=$2', [tenantId, definitionId]));
  const created = await record(6, 'Playwright browser invocation R2_BROWSER_MODE=create: POST /api/conversations', 'R2 browser instrument; apps/web/app/api/conversations/route.ts:35-41; src/entrypoints/api/routes/conversations.ts:73-101', () => browser('create', { definitionId }));
  conversationId = created.conversationId;
  await record(7, 'POST /api/v1/conversations/:conversationId/work-context', 'src/entrypoints/api/routes/conversations.ts:307-334', () => api('POST', `/api/v1/conversations/${conversationId}/work-context`, undefined, 'r2-golden-work-context'));
  await record(8, 'Playwright browser invocation R2_BROWSER_MODE=send: POST /api/conversations/:id/messages, passive DOM Work Card observation', 'R2 browser instrument; apps/web/app/api/conversations/[conversationId]/messages/route.ts; src/entrypoints/api/routes/conversations.ts:133-188', () => browser('send', { definitionId, conversationId, prompt: `Follow your trusted instructions exactly and complete ${marker}.` }));
  await captureRuntimeEvidence(definitionId, conversationId);
  const observations = await finalObservations(definitionId, conversationId);
  const profile = await effectiveProfile();
  await save('runtime-effective-profile.json', profile);
  if (!['claude', 'codex'].includes(profile.runtime_provider)) throw new Error(`Terminal provider is not accepted: ${profile.runtime_provider}`);
  await save('result.json', { rc: 0, definition_id: definitionId, work_definition_version_id: workVersionId, conversation_id: conversationId, observations_file: 'final-sql-observations.json' });
} catch (error) {
  await save('result.json', { rc: 1, definition_id: definitionId ?? null, work_definition_version_id: workVersionId ?? null, conversation_id: conversationId ?? null, error: String(error) });
  throw error;
}
