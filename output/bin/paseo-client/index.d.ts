import { EventEmitter } from 'events';
export interface AgentCreateOptions {
    /** Provider backend: 'claude' | 'codex' | 'opencode'. Defaults to 'claude'. */
    provider?: string;
    /** Model identifier, e.g. 'claude-sonnet-4-20250514'. */
    model?: string;
    /** Initial prompt / task description. */
    prompt: string;
    /** Working directory for the agent. Defaults to process.cwd(). */
    cwd?: string;
    /** Agent mode: 'default' | 'plan' | 'bypassPermissions'. Maps to modeId. */
    mode?: string;
    /** Optional system prompt override. */
    systemPrompt?: string;
}
export interface AgentInfo {
    id: string;
    provider: string;
    status: string;
    title?: string;
    createdAt: string;
    updatedAt: string;
}
export interface AgentStreamEvent {
    agentId: string;
    type: string;
    content: unknown;
    timestamp: string;
}
export declare class PaseoClient extends EventEmitter {
    private ws;
    private readonly url;
    private readonly clientId;
    private connected;
    private pendingRequests;
    private reconnectTimer;
    private reconnectAttempts;
    private intentionalClose;
    /** Local cache of agent info from agent_update events. */
    private agentCache;
    /** Maximum time (ms) to wait for a response before rejecting. */
    private readonly REQUEST_TIMEOUT;
    /** Maximum reconnection backoff delay (ms). */
    private static readonly MAX_RECONNECT_DELAY;
    /** Base delay for exponential backoff (ms). */
    private static readonly BASE_RECONNECT_DELAY;
    constructor(url?: string, options?: {
        requestTimeout?: number;
    });
    /**
     * Establishes the WebSocket connection and performs the hello handshake.
     * Resolves once the server acknowledges with a session-wrapped status/server_info message.
     */
    connect(): Promise<void>;
    /**
     * Gracefully close the connection. No automatic reconnection will occur.
     */
    disconnect(): void;
    /**
     * Returns whether the WebSocket is currently open and the handshake is complete.
     */
    isConnected(): boolean;
    /**
     * Create a new agent with the given configuration.
     * Sends create_agent_request, resolves when status with agent_created is received.
     */
    createAgent(options: AgentCreateOptions): Promise<AgentInfo>;
    /**
     * Send a prompt to an existing agent.
     * Sends send_agent_message_request, resolves when send_agent_message_response is received.
     */
    sendPrompt(agentId: string, prompt: string): Promise<void>;
    /**
     * Get detailed info about a specific agent.
     * First checks the local cache (updated by agent_update events),
     * then falls back to fetch_agents_request and filters by ID.
     */
    getAgent(agentId: string): Promise<AgentInfo>;
    /**
     * List all active agents.
     * Sends fetch_agents_request, resolves when fetch_agents_response is received.
     */
    listAgents(): Promise<AgentInfo[]>;
    /**
     * Stop/cancel a running agent.
     * Sends cancel_agent_request. This is fire-and-forget (no response expected).
     */
    stopAgent(agentId: string): Promise<void>;
    /**
     * Archive a stopped/idle agent.
     * Sends archive_agent_request. Fire-and-forget — Paseo confirms via agent_update but we don't block on it.
     */
    archiveAgent(agentId: string): Promise<void>;
    /**
     * Subscribe to streaming events for a specific agent.
     * Returns an unsubscribe function.
     */
    subscribe(agentId: string, callback: (event: AgentStreamEvent) => void): () => void;
    /**
     * Wraps a message in the session envelope and sends it (fire-and-forget).
     */
    private sendSessionMessage;
    /**
     * Sends a session-wrapped request and waits for the correlated response.
     * Correlation is done via requestId matching in incoming messages.
     */
    private sendSessionRequest;
    private ensureConnected;
    private handleMessage;
    /**
     * Handles status messages. These can be:
     * - server_info (handled during handshake, but also post-connect)
     * - agent_created (response to create_agent_request, correlated via requestId)
     */
    private handleStatusMessage;
    private handleFetchAgentsResponse;
    private handleSendAgentMessageResponse;
    private handleAgentUpdate;
    private handleAgentStream;
    private handleReconnect;
    /**
     * Sends the bare (unwrapped) hello message. This is the only message NOT
     * wrapped in the session envelope.
     */
    private sendHello;
    private rejectAllPending;
    private log;
}
export default PaseoClient;
//# sourceMappingURL=index.d.ts.map