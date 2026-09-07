import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  createRuntimeMcpHttpHandler,
  MCP_PATH,
} from '../../src/adapters/mcp/runtime-mcp-http-handler.js';
import { AuthorizeRuntimeTool } from '../../src/application/runtime/authorize-runtime-tool.js';
import type { RuntimeGenerationStore } from '../../src/application/ports/runtime-generation-store.js';
import type { RuntimeSessionStore } from '../../src/application/ports/runtime-session-store.js';
import type { RuntimeTurnStore } from '../../src/application/ports/runtime-turn-store.js';
import { createRuntimeToolCatalog } from '../../src/application/extensions/runtime-tool-catalog.js';
import { PostgresRuntimeGrantReader } from '../../src/infrastructure/postgres/runtime/postgres-runtime-grant-reader.js';
import {
  classifyDatabaseVersion,
  ensureDevelopmentDatabase,
} from './host-native.js';

class TestResponse {
  headersSent = false;
  writableEnded = false;
  statusCode = 0;
  body = '';

  writeHead(statusCode: number): this {
    this.statusCode = statusCode;
    this.headersSent = true;
    return this;
  }

  end(body?: string): this {
    this.body = body ?? '';
    this.writableEnded = true;
    return this;
  }
}

function request(withBearer = true): {
  readonly request: IncomingMessage;
  readonly response: TestResponse;
} {
  const input = new EventEmitter() as IncomingMessage;
  Object.assign(input, {
    url: MCP_PATH,
    method: 'POST',
    headers: withBearer ? { authorization: 'Bearer test-token' } : {},
  });
  return { request: input, response: new TestResponse() };
}

async function invoke(
  handler: ReturnType<typeof createRuntimeMcpHttpHandler>,
  withBearer = true,
): Promise<TestResponse> {
  const current = request(withBearer);
  const pending = handler(
    current.request,
    current.response as unknown as ServerResponse,
  );
  current.request.emit(
    'data',
    Buffer.from(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      }),
    ),
  );
  current.request.emit('end');
  await pending;
  return current.response;
}

describe('runtime crash guards', () => {
  it('turns a real grant-reader query failure into a response and keeps serving', async () => {
    const entries: string[] = [];
    const grants = new PostgresRuntimeGrantReader({
      query: async () => {
        throw new Error('database password and local path must stay private');
      },
    });
    const unused = {};
    const authorize = new AuthorizeRuntimeTool(
      grants,
      unused as unknown as RuntimeSessionStore,
      unused as unknown as RuntimeGenerationStore,
      unused as unknown as RuntimeTurnStore,
      (token) => token,
    );
    const handler = createRuntimeMcpHttpHandler({
      authorize,
      toolCatalog: createRuntimeToolCatalog([]),
      logger: {
        log: (_level, event) => entries.push(event),
      },
    });

    const failed = await invoke(handler);
    expect(failed.statusCode).toBe(500);
    expect(JSON.parse(failed.body)).toEqual({ error: 'internal_error' });
    expect(entries).toContain('runtime.mcp.request.failed');

    const stillAlive = await invoke(handler, false);
    expect(stillAlive.statusCode).toBe(401);
    expect(JSON.parse(stillAlive.body)).toEqual({ error: 'unauthorized' });
  });

  it('does not allow a forced PGlite override when native PostgreSQL is required', async () => {
    await expect(
      ensureDevelopmentDatabase({
        HOST_NATIVE_FORCE_PGLITE: '1',
        CANARY_REQUIRE_NATIVE_POSTGRES: '1',
      }),
    ).rejects.toThrow(/CANARY_REQUIRE_NATIVE_POSTGRES/u);
  }, 5_000);

  it('classifies PGlite and wasm version markers as the non-native backend', () => {
    expect(classifyDatabaseVersion('PostgreSQL 16.4')).toBe('postgres');
    expect(classifyDatabaseVersion('PostgreSQL 16.4 (PGlite)')).toBe('pglite');
    expect(classifyDatabaseVersion('PostgreSQL 16.4 emscripten wasm')).toBe(
      'pglite',
    );
  });

  it('classifies the current in-process PGlite version probe without a listener', async () => {
    const database = new PGlite();
    try {
      const result = await database.query<{ version: string }>(
        'SELECT version()',
      );
      expect(classifyDatabaseVersion(result.rows[0]!.version)).toBe('pglite');
    } finally {
      await database.close();
    }
  });

  it('keeps a child process alive and logs both recoverable process faults', () => {
    const guardModule = fileURLToPath(
      new URL(
        '../../src/infrastructure/extensions/process-crash-guard.ts',
        import.meta.url,
      ),
    );
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `const { installProcessCrashGuards } = await import(${JSON.stringify(guardModule)});
installProcessCrashGuards({ log: (_level, event) => process.stdout.write(event + String.fromCharCode(10)) });
Promise.reject(new Error('private rejection details'));
setTimeout(() => { throw new Error('private exception details'); }, 0);
setTimeout(() => process.stdout.write('alive' + String.fromCharCode(10)), 30);`,
      ],
      { encoding: 'utf8', timeout: 2_000 },
    );

    expect(child.status).toBe(0);
    expect(child.stdout).toContain('process.unhandled_rejection');
    expect(child.stdout).toContain('process.uncaught_exception');
    expect(child.stdout).toContain('alive');
    expect(child.stdout).not.toContain('private rejection details');
    expect(child.stdout).not.toContain('private exception details');
  });
});
