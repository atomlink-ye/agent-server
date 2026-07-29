import { createServer, type Server } from 'node:http';
import { createDirectMemoryMcpHandler } from '../../entrypoints/mcp/direct-memory-mcp.js';
import { RuntimeToolGrantService } from '../../application/extensions/runtime-tool-grant-service.js';
import type { MemoryApiRepository } from '../../application/ports/memory-api-repository.js';
import type { TeamToolHandler } from '../../application/teams/team-tools.js';
import { registerTeamMcpTools } from '../../adapters/team-mcp/team-mcp-tools.js';

export class RuntimeMcpServer {
  readonly grants: RuntimeToolGrantService;
  readonly #repository: MemoryApiRepository;
  #server: Server | null = null;
  #url: string | null = null;
  #starting: Promise<string> | null = null;

  public constructor(
    repository: MemoryApiRepository,
    grants = new RuntimeToolGrantService(),
    private readonly teamTools?: {
      handler: TeamToolHandler;
    },
  ) {
    this.#repository = repository;
    this.grants = grants;
  }

  public async start(): Promise<string> {
    if (this.#url) return this.#url;
    if (this.#starting) return this.#starting;
    this.#starting = new Promise<string>((resolve, reject) => {
      const server = createServer(
        createDirectMemoryMcpHandler({
          repository: this.#repository,
          grants: this.grants,
          ...(this.teamTools ? { teamTools: this.teamTools } : {}),
        }),
      );
      this.#server = server;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Runtime MCP listener failed.'));
          return;
        }
        this.#url = `http://127.0.0.1:${address.port}/mcp/agent-runtime`;
        resolve(this.#url);
      });
    }).catch(async (error) => {
      await this.stop();
      throw error;
    });
    try {
      return await this.#starting;
    } finally {
      this.#starting = null;
    }
  }

  public async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#url = null;
    if (!server) return;
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
}
