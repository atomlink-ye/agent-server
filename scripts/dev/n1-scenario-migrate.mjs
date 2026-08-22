import { readFile, writeFile } from 'node:fs/promises';

const path = 'tests/scenarios/north-star-host-harness.scenario.test.ts';
let text = await readFile(path, 'utf8');

function replaceOnce(search, replacement, label) {
  if (!text.includes(search)) throw new Error(`missing ${label}`);
  text = text.replace(search, replacement);
}

replaceOnce(
  "  return { h, world, product } as const;\n}\n\nasync function startWorkThroughScriptedRuntime(",
  `  return { h, world, product } as const;
}

function scenarioInvocationContext(
  world: Awaited<ReturnType<AgentServerHarness['seed']['goldenPath']>>,
  scopeId: string,
) {
  const productScope = {
    tenantId: world.owner.tenantId,
    workspaceId: world.owner.workspaceId,
  };
  const actor = {
    type: world.owner.principalType,
    id: world.owner.principalId,
  };
  return {
    scope: {
      kind: 'agent_chat' as const,
      agentChatRuntimeId: scopeId,
      runtimeEpoch: 1,
    },
    productScope,
    actor,
    agentOwner: { scope: productScope, principal: actor },
    agentDefinitionId: world.agent.definitionId,
    agentVersionId: world.agent.versionId,
    conversationId: world.conversation.id,
    triggerMessageId: world.triggerMessageId,
  } as const;
}

async function startWorkThroughScriptedRuntime(`,
  'scenario invocation helper',
);

replaceOnce(
  `  const created = await h.runtime.createSession({
    runtimeSessionId: scopeId,
    systemPrompt: \`Agent definition ID: \${world.agent.definitionId}\`,
    mcpServer: mcp,
    token: receipt.token,
  });`,
  `  const created = await h.runtime.createSession({
    runtimeSessionId: scopeId,
    systemPrompt: 'Structured Agent identity is supplied by RuntimeInvocationContext.',
    invocationContext: scenarioInvocationContext(world, scopeId),
    mcpServer: mcp,
    token: receipt.token,
  });`,
  'direct scripted session',
);

replaceOnce(
  `        const created = await h.runtime.plane.createSession({
          runtimeSessionId: \`chat-runtime-\${world.conversation.id}\`,
          workspace: { cwd: process.cwd() },
          systemPrompt: input.systemPrompt ?? '',
          extensions: input.extensions,
        });`,
  `        const created = await h.runtime.plane.createSession({
          runtimeSessionId: \`chat-runtime-\${world.conversation.id}\`,
          workspace: { cwd: process.cwd() },
          systemPrompt: input.systemPrompt ?? '',
          invocationContext: input.invocationContext,
          extensions: input.extensions,
        });`,
  'reconciler runtime session',
);

replaceOnce(
  `      {
        async resolve() {
          return {
            instructions: 'Harness deterministic chat brain',
            capabilitySummary: {},
            agentHome: {},
          } as any;
        },
      } as any,`,
  `      {
        async resolve(input: any) {
          const invocationContext = scenarioInvocationContext(world, input.runtime.id);
          return {
            instructions: 'Harness deterministic chat brain',
            capabilitySummary: {},
            agentHome: {},
            invocationContext,
            agentOwner: invocationContext.agentOwner,
            resolvedSkills: [],
            toolRefs: [],
          } as any;
        },
      } as any,`,
  'structured brain fake',
);

await writeFile(path, text);
console.log('N1 scenario migration complete');
