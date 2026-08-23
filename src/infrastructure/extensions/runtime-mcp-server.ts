import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createDirectMemoryMcpHandler } from '../../entrypoints/mcp/direct-memory-mcp.js';
import { RuntimeToolGrantService } from '../../application/extensions/runtime-tool-grant-service.js';
import type { RuntimeToolCatalog } from '../../application/extensions/runtime-tool-catalog.js';

export interface RuntimeMcpEndpoint {
  readonly url: string;
  readonly epoch: string;
}

export class RuntimeMcpServer {
  readonly grants: RuntimeToolGrantService;
  #server: Server | null = null;
  #endpoint: RuntimeMcpEndpoint | null = null;
  #starting: Promise<RuntimeMcpEndpoint> | null = null;

  public constructor(
    private readonly toolCatalog: RuntimeToolCatalog,
    grants = new RuntimeToolGrantService(),
    private readonly listenHost = '127.0.0.1',
    private readonly advertisedHost = '127.0.0.1',
    private readonly listenPort = 0,
  ) {
    this.grants = grants;
  }

  public endpoint(): RuntimeMcpEndpoint | null {
    return this.#endpoint;
  }

  public async start(): Promise<string> {
    return (await this.startEndpoint()).url;
  }

  public async startEndpoint(): Promise<RuntimeMcpEndpoint> {
    if (this.#endpoint) return this.#endpoint;
    if (this.#starting) return this.#starting;
    this.#starting = (async () => {
      await this.grants.initialize();
      return new Promise<RuntimeMcpEndpoint>((resolve, reject) => {
        const server = createServer(
          createDirectMemoryMcpHandler({
            grants: this.grants,
            toolCatalog: this.toolCatalog,
          }),
        );
        this.#server = server;
        server.once('error', reject);
        server.listen(this.listenPort, this.listenHost, () => {
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Runtime MCP listener failed.'));
            return;
          }
          const url = `http://${this.advertisedHost}:${address.port}/mcp/agent-runtime`;
          const endpoint = Object.freeze({
            url,
            epoch: createHash('sha256').update(url).digest('hex'),
          });
          this.#endpoint = endpoint;
          resolve(endpoint);
        });
      });
    })().catch(async (error) => {
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
    this.#endpoint = null;
    if (!server) return;
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
}
