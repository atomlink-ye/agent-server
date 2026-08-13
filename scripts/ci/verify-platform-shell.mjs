#!/usr/bin/env node

import { composePlatformApp } from '../../src/entrypoints/api/app.ts';

const EXPECTED_CONCERN_KEYS = Object.freeze([
  'logger',
  'authenticate',
  'accessContext',
  'safeError',
  'notFound',
]);

const TOKEN = 'platform-shell-token';
const ACCESS = Object.freeze({
  tenantId: 'platform-shell-tenant',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  principalType: 'service_account',
  principalId: 'platform-shell-account',
  serviceAccountId: 'platform-shell-account',
  policySnapshotVersion: 'platform-shell-policy',
});

function fail(marker, detail, exitCode = 1) {
  process.stderr.write(`${marker}:${detail}\n`);
  return exitCode;
}

function mutationFromArgv() {
  const argument = process.argv
    .slice(2)
    .find((entry) => entry.startsWith('--mutation='));
  return argument?.slice('--mutation='.length);
}

function createMinimalDependencies() {
  return {
    config: {
      serviceName: 'platform-shell-verifier',
      serviceAccounts: [
        {
          serviceAccountId: ACCESS.serviceAccountId,
          token: TOKEN,
          tenantId: ACCESS.tenantId,
          workspaceId: ACCESS.workspaceId,
          policyVersion: ACCESS.policySnapshotVersion,
          disabled: false,
        },
      ],
    },
    logger: { log() {} },
    readiness: {
      async check() {
        return [];
      },
    },
    runtime: {},
    submitRun: {},
    getRun: {},
    invokeTask: {},
    getTask: {},
    getTaskTree: {},
    createMemoryProposal: {},
    listMemoryProposals: {},
    reviewMemoryProposal: {},
    listMemoryEntries: {},
    agentRegistry: {},
  };
}

async function main() {
  const mutation = mutationFromArgv();
  if (
    mutation !== undefined &&
    !['omit-noop', 'inject-work-repository', 'disturb-stop-order'].includes(
      mutation,
    )
  )
    return fail('platform_shell_unknown_mutation', mutation);

  const events = [];
  const tools = new Map();
  const observedConcernKeys = [];
  const dependencySpy = {
    installHttp(app, concerns) {
      if (mutation === 'inject-work-repository') concerns.workRepository = {};
      observedConcernKeys.push(...Object.keys(concerns));
    },
  };
  const noopContribution = {
    installHttp(app, concerns) {
      app.get('/__platform/noop', concerns.authenticate, (context) => {
        const accessContext = concerns.accessContext(context);
        concerns.logger.log('info', 'platform.noop');
        return context.json({
          ok: true,
          tenant_id: accessContext.tenantId,
        });
      });
    },
    contributeRuntime(registry) {
      registry.register('platform.noop', async () => ({ ok: true }));
    },
  };
  const starts = [
    async () => {
      events.push('start:first');
      return () => events.push('stop:first');
    },
    async () => {
      events.push('start:second');
      return () => events.push('stop:second');
    },
  ];
  const contributions =
    mutation === 'omit-noop'
      ? [dependencySpy]
      : [dependencySpy, noopContribution];
  const composed = composePlatformApp(
    createMinimalDependencies(),
    contributions,
    {
      register(name, invoke) {
        tools.set(name, invoke);
      },
    },
    starts,
  );
  await composed.start();
  const response = await composed.app.request('/__platform/noop', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const body = await response.json().catch(() => null);
  const tool = await tools.get('platform.noop')?.();
  const originalPop = Array.prototype.pop;
  try {
    if (mutation === 'disturb-stop-order')
      Array.prototype.pop = function takeFirstTeardown() {
        return this.shift();
      };
    await composed.stop();
  } finally {
    Array.prototype.pop = originalPop;
  }

  const expectedKeys = [...EXPECTED_CONCERN_KEYS].sort();
  const actualKeys = [...new Set(observedConcernKeys)].sort();
  const expectedEvents = 'start:first,start:second,stop:second,stop:first';
  if (mutation === 'omit-noop') {
    const controlsOk =
      actualKeys.join(',') === expectedKeys.join(',') &&
      events.join(',') === expectedEvents;
    if (
      response.status === 404 &&
      body?.error?.code === 'route_not_found' &&
      !tools.has('platform.noop') &&
      controlsOk
    )
      return fail(
        'MISSING:platform_shell_noop',
        'route=route_not_found;runtime=absent;lifecycle=ok;spy=ok',
        2,
      );
    return fail(
      'platform_shell_omit_mutation_not_precise',
      `route=${response.status}:${body?.error?.code};runtime=${tools.has('platform.noop')};events=${events.join(',')};keys=${actualKeys.join(',')}`,
    );
  }
  const behaviorOk =
    response.status === 200 &&
    body?.ok === true &&
    body?.tenant_id === ACCESS.tenantId &&
    tool?.ok === true;
  if (mutation === 'inject-work-repository') {
    if (
      actualKeys.includes('workRepository') &&
      behaviorOk &&
      events.join(',') === expectedEvents
    )
      return fail(
        'FAIL:platform_shell_dependency_spy',
        'forbidden=workRepository;route=ok;runtime=ok;lifecycle=ok',
      );
    return fail(
      'platform_shell_business_mutation_not_precise',
      `behavior=${behaviorOk};events=${events.join(',')};keys=${actualKeys.join(',')}`,
    );
  }
  if (actualKeys.join(',') !== expectedKeys.join(','))
    return fail(
      'FAIL:platform_shell_dependency_spy',
      `expected=${expectedKeys.join(',')};actual=${actualKeys.join(',')}`,
    );
  if (!behaviorOk)
    return fail('FAIL:platform_shell_behavior', `${response.status}`);
  if (mutation === 'disturb-stop-order') {
    if (
      events.join(',') === 'start:first,start:second,stop:first,stop:second' &&
      actualKeys.join(',') === expectedKeys.join(',')
    )
      return fail(
        'FAIL:platform_shell_stop_order',
        'mechanism=pop_to_shift;route=ok;runtime=ok;spy=ok',
      );
    return fail(
      'platform_shell_stop_mutation_not_precise',
      `events=${events.join(',')};keys=${actualKeys.join(',')}`,
    );
  }
  if (events.join(',') !== expectedEvents)
    return fail(
      'FAIL:platform_shell_stop_order',
      `expected=${expectedEvents};actual=${events.join(',')}`,
    );
  process.stdout.write(
    `${JSON.stringify({
      verifier: 'platform-shell',
      create_app_invoked: true,
      concern_keys: actualKeys,
      access_context_accessor: 'getAuthenticatedAccessContext',
      route: '/__platform/noop',
      runtime_contributor: 'platform.noop',
      events,
      ok: true,
    })}\n`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.exitCode = fail(
      'FAIL:platform_shell_harness',
      error instanceof Error ? error.message : 'unknown',
    );
  });
