import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

import { SYNTHETIC_MARKET_FIXTURE_REF } from '../../adapters/demo-market/synthetic-market-adapter.js';
import { AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF } from '../../application/agents/built-in-skills.js';
import { createSyntheticToolReceipt } from '../../application/runtime/synthetic-tool-receipt.js';
import type { RunEventRepository } from '../../application/ports/run-events.js';
import { createSyntheticRuntimeToolsContributor } from './runtime-tool-contributors.js';

function grant() {
  return {
    catalogTools: [AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF],
    activeTurn: { taskId: 'task-1', runId: 'run-1', contextEpoch: 'epoch' },
    teamMemberRunId: 'member-1',
    turn: { id: 'turn-1' },
  } as any;
}

async function setupStockSnapshot(
  append: (...args: any[]) => Promise<unknown> = async () => ({}),
) {
  const receipt = createSyntheticToolReceipt();
  const events = {
    append: vi.fn(append),
  } as unknown as Pick<RunEventRepository, 'append'>;
  const server = new McpServer({ name: 'test', version: '1' });
  const currentGrant = grant();
  createSyntheticRuntimeToolsContributor({
    syntheticToolReceipt: receipt,
    events,
  })({
    server,
    grant: currentGrant,
    authorize: async () => currentGrant,
  });
  const registered = (server as any)._registeredTools.synthetic_stock_snapshot;
  return { receipt, events, registered, grant: currentGrant };
}

async function callStockSnapshot(args: Record<string, string>) {
  const setup = await setupStockSnapshot();
  const result = await setup.registered.handler(args);
  return { ...setup, result };
}

describe('synthetic runtime tool contributor', () => {
  it('records only the fixed ACME stock snapshot and its source-bound activity', async () => {
    const {
      receipt,
      events,
      grant: currentGrant,
      result,
    } = await callStockSnapshot({
      fixture_ref: SYNTHETIC_MARKET_FIXTURE_REF,
      symbol: 'ACME',
    });

    expect(result.structuredContent.error).toBeUndefined();
    expect(
      receipt.hasExactlyOne({
        grant: currentGrant,
        toolRef: AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
      }),
    ).toBe(true);
    expect(events.append).toHaveBeenCalledWith(
      'run-1',
      'output',
      expect.objectContaining({
        kind: 'tool_status',
        tool_name: 'synthetic_stock_snapshot',
        status: 'completed',
        provenance: 'server_authorized_team_mcp_catalog',
        tool_identity_capture_status: 'present',
      }),
    );
  });

  it.each([
    { fixture_ref: 'fixture://wrong', symbol: 'ACME' },
    { fixture_ref: SYNTHETIC_MARKET_FIXTURE_REF, symbol: 'OTHER' },
  ])('does not record an invalid stock snapshot: %j', async (args) => {
    const {
      receipt,
      events,
      grant: currentGrant,
      result,
    } = await callStockSnapshot(args);

    expect(result.structuredContent).toEqual({ error: 'invalid_request' });
    expect(
      receipt.hasExactlyOne({
        grant: currentGrant,
        toolRef: AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
      }),
    ).toBe(false);
    expect(events.append).not.toHaveBeenCalled();
  });

  it('keeps the receipt unavailable when source-bound append rejects', async () => {
    const setup = await setupStockSnapshot(async () => {
      throw new Error('append failed');
    });
    const invocation = setup.registered.handler({
      fixture_ref: SYNTHETIC_MARKET_FIXTURE_REF,
      symbol: 'ACME',
    });

    await expect(invocation).rejects.toThrow('append failed');
    expect(
      setup.receipt.hasExactlyOne({
        grant: setup.grant,
        toolRef: AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
      }),
    ).toBe(false);
  });

  it('keeps the receipt unavailable while source-bound append is pending', async () => {
    let resolveAppend!: (value: unknown) => void;
    const setup = await setupStockSnapshot(
      () => new Promise((resolve) => (resolveAppend = resolve)),
    );
    const invocation = setup.registered.handler({
      fixture_ref: SYNTHETIC_MARKET_FIXTURE_REF,
      symbol: 'ACME',
    });
    await Promise.resolve();
    expect(
      setup.receipt.hasExactlyOne({
        grant: setup.grant,
        toolRef: AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
      }),
    ).toBe(false);

    resolveAppend({});
    await invocation;
    expect(
      setup.receipt.hasExactlyOne({
        grant: setup.grant,
        toolRef: AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
      }),
    ).toBe(true);
  });
});
