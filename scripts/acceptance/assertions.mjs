import { parse as parseYaml } from 'yaml';

export function assertRenderedPorts(rendered, expected) {
  const document = typeof rendered === 'string' ? parseYaml(rendered) : rendered;
  const services = document?.services;
  if (!services || typeof services !== 'object') {
    throw new Error('rendered Compose config has no services mapping');
  }
  for (const [service, tuple] of Object.entries(expected)) {
    const actual = services[service]?.ports;
    const wanted = [{
      host_ip: tuple.hostIp,
      published: String(tuple.published),
      target: tuple.target,
    }];
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      throw new Error(`${service} ports mismatch: expected exactly ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
    }
  }
}

export function latestRuntimeInitialized(log) {
  let hit;
  for (const line of log.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record.event === 'runtime.initialized') hit = record;
    } catch {
      // Docker output may include non-JSON lines; they are not runtime facts.
    }
  }
  if (!hit) throw new Error('did not observe runtime.initialized');
  return hit;
}

export function assertProviderEffect({ agentServer, paseoRuntime, runtimeInitialized, expectedProvider }) {
  const expectedModel = agentServer.runtime_model?.split('/').at(-1);
  const checks = {
    agent_adapter: agentServer.runtime_adapter === 'paseo',
    agent_provider: agentServer.runtime_provider === expectedProvider,
    agent_model: Boolean(agentServer.runtime_model),
    runtime_provider: paseoRuntime.runtime_provider === expectedProvider,
    runtime_model: Boolean(paseoRuntime.runtime_model),
    effect_provider: runtimeInitialized.provider === expectedProvider,
    effect_model: runtimeInitialized.model === expectedModel,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) throw new Error(`provider effect mismatch: ${failed.join(', ')}`);
}

export function serviceHealth(service) {
  const health = service?.State?.Health;
  return health?.Status ?? 'no-healthcheck';
}

export function assertLifecycleServices(services) {
  const failed = Object.entries(services).filter(([, service]) =>
    service?.State?.Status !== 'running' ||
    (service?.State?.Health && service.State.Health.Status !== 'healthy'),
  );
  if (failed.length) throw new Error(`lifecycle services not ready: ${failed.map(([name]) => name).join(', ')}`);
}

