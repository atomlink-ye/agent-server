import WebSocket from 'ws'
import { v4 as uuid } from 'uuid'
import { EventEmitter } from 'events'

// ─── Public Interfaces ──────────────────────────────────────────────────────

export interface AgentCreateOptions {
  /** Provider backend: 'claude' | 'codex' | 'opencode'. Defaults to 'claude'. */
  provider?: string
  /** Model identifier, e.g. 'claude-sonnet-4-20250514'. */
  model?: string
  /** Initial prompt / task description. */
  prompt: string
  /** Working directory for the agent. Defaults to process.cwd(). */
  cwd?: string
  /** Agent mode: 'default' | 'plan' | 'bypassPermissions'. Maps to modeId. */
  mode?: string
  /** Optional system prompt override. */
  systemPrompt?: string
}

export interface AgentInfo {
  id: string
  provider: string
  status: string
  title?: string
  createdAt: string
  updatedAt: string
}

export interface AgentStreamEvent {
  agentId: string
  type: string
  content: unknown
  timestamp: string
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timeout: NodeJS.Timeout
  /** The message type we expect as a response (for correlation). */
  expectedResponseType?: string
}

/** The session envelope that wraps all non-hello messages. */
interface SessionEnvelope {
  type: 'session'
  message: SessionInboundMessage | SessionOutboundMessage
}

/** Messages sent from client to server (inside session envelope). */
type SessionInboundMessage =
  | CreateAgentRequest
  | SendAgentMessageRequest
  | FetchAgentsRequest
  | CancelAgentRequest
  | ArchiveAgentRequest

/** Messages received from server (inside session envelope). */
type SessionOutboundMessage =
  | StatusMessage
  | FetchAgentsResponse
  | SendAgentMessageResponse
  | AgentUpdateMessage
  | AgentStreamMessage
  | { type: string; [key: string]: unknown }

interface CreateAgentRequest {
  type: 'create_agent_request'
  requestId: string
  config: {
    provider: string
    cwd: string
    modeId: string
    model: string
    systemPrompt?: string
  }
  initialPrompt: string
  attachments: unknown[]
}

interface SendAgentMessageRequest {
  type: 'send_agent_message_request'
  requestId: string
  agentId: string
  text: string
  attachments: unknown[]
}

interface FetchAgentsRequest {
  type: 'fetch_agents_request'
  requestId: string
  scope: string
}

interface CancelAgentRequest {
  type: 'cancel_agent_request'
  agentId: string
}

interface ArchiveAgentRequest {
  type: 'archive_agent_request'
  agentId: string
  requestId: string
}

interface StatusMessage {
  type: 'status'
  payload: {
    status: string
    requestId?: string
    agentId?: string
    agent?: AgentInfo
    serverId?: string
    hostname?: string
    version?: string
    [key: string]: unknown
  }
}

interface FetchAgentsResponse {
  type: 'fetch_agents_response'
  payload: {
    requestId: string
    entries: AgentInfo[]
    pageInfo: { hasMore: boolean; cursor?: string }
  }
}

interface SendAgentMessageResponse {
  type: 'send_agent_message_response'
  payload: {
    requestId: string
    agentId: string
    accepted: boolean
    error: string | null
  }
}

interface AgentUpdateMessage {
  type: 'agent_update'
  payload: {
    agentId: string
    status: string
    [key: string]: unknown
  }
}

interface AgentStreamMessage {
  type: 'agent_stream'
  payload: {
    agentId: string
    event: unknown
  }
}

// ─── Client Implementation ──────────────────────────────────────────────────

export class PaseoClient extends EventEmitter {
  private ws: WebSocket | null = null
  private readonly url: string
  private readonly clientId: string
  private connected = false
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private intentionalClose = false

  /** Local cache of agent info from agent_update events. */
  private agentCache: Map<string, AgentInfo> = new Map()

  /** Maximum time (ms) to wait for a response before rejecting. */
  private readonly REQUEST_TIMEOUT: number

  /** Maximum reconnection backoff delay (ms). */
  private static readonly MAX_RECONNECT_DELAY = 30_000
  /** Base delay for exponential backoff (ms). */
  private static readonly BASE_RECONNECT_DELAY = 1_000

  constructor(url = 'ws://127.0.0.1:6767/ws', options?: { requestTimeout?: number }) {
    super()
    this.url = url
    this.clientId = `agent-server-${uuid()}`
    this.REQUEST_TIMEOUT = options?.requestTimeout ?? 30_000
  }

  // ─── Connection Lifecycle ───────────────────────────────────────────────

  /**
   * Establishes the WebSocket connection and performs the hello handshake.
   * Resolves once the server acknowledges with a session-wrapped status/server_info message.
   */
  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    return new Promise<void>((resolve, reject) => {
      this.intentionalClose = false
      this.ws = new WebSocket(this.url)

      const connectionTimeout = setTimeout(() => {
        this.ws?.terminate()
        reject(new Error(`Connection to ${this.url} timed out`))
      }, this.REQUEST_TIMEOUT)

      this.ws.on('open', () => {
        this.log('info', 'WebSocket connected, sending hello')
        this.sendHello()
      })

      this.ws.on('message', (data: WebSocket.Data, isBinary: boolean) => {
        if (isBinary) return

        const raw = data.toString()

        // During handshake, intercept the session-wrapped status with server_info
        if (!this.connected) {
          try {
            const msg = JSON.parse(raw) as { type: string; message?: { type: string; payload?: { status: string } } }
            if (
              msg.type === 'session' &&
              msg.message?.type === 'status' &&
              msg.message?.payload?.status === 'server_info'
            ) {
              clearTimeout(connectionTimeout)
              this.connected = true
              this.reconnectAttempts = 0
              this.log('info', 'Handshake complete - server_info received')
              this.emit('connected')
              resolve()
            }
          } catch {
            // Not valid JSON during handshake; ignore.
          }
          return
        }

        this.handleMessage(raw)
      })

      this.ws.on('close', (code, reason) => {
        const wasConnected = this.connected
        this.connected = false
        this.log('info', `WebSocket closed (code=${code}, reason=${reason.toString()})`)
        this.rejectAllPending(new Error('WebSocket connection closed'))
        this.emit('disconnected', { code, reason: reason.toString() })

        if (!this.intentionalClose) {
          clearTimeout(connectionTimeout)
          if (!wasConnected) {
            reject(new Error(`WebSocket closed before handshake (code=${code})`))
          }
          this.handleReconnect()
        }
      })

      this.ws.on('error', (err) => {
        this.log('error', `WebSocket error: ${err.message}`)
        this.emit('error', err)
      })
    })
  }

  /**
   * Gracefully close the connection. No automatic reconnection will occur.
   */
  disconnect(): void {
    this.intentionalClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close(1000, 'client disconnect')
      this.ws = null
    }
    this.connected = false
    this.rejectAllPending(new Error('Client disconnected'))
    this.log('info', 'Disconnected')
  }

  /**
   * Returns whether the WebSocket is currently open and the handshake is complete.
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  // ─── Core Operations ────────────────────────────────────────────────────

  /**
   * Create a new agent with the given configuration.
   * Sends create_agent_request, resolves when status with agent_created is received.
   */
  async createAgent(options: AgentCreateOptions): Promise<AgentInfo> {
    const requestId = `req-${uuid()}`

    const message: CreateAgentRequest = {
      type: 'create_agent_request',
      requestId,
      config: {
        provider: options.provider ?? 'claude',
        cwd: options.cwd ?? process.cwd(),
        modeId: options.mode ?? 'default',
        model: options.model ?? 'claude-sonnet-4-20250514',
        ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      },
      initialPrompt: options.prompt,
      attachments: [],
    }

    const result = await this.sendSessionRequest(requestId, message)
    const payload = result as StatusMessage['payload']
    const agentInfo = payload.agent!

    // Cache the newly created agent
    this.agentCache.set(agentInfo.id, agentInfo)

    return agentInfo
  }

  /**
   * Send a prompt to an existing agent.
   * Sends send_agent_message_request, resolves when send_agent_message_response is received.
   */
  async sendPrompt(agentId: string, prompt: string): Promise<void> {
    const requestId = `req-${uuid()}`

    const message: SendAgentMessageRequest = {
      type: 'send_agent_message_request',
      requestId,
      agentId,
      text: prompt,
      attachments: [],
    }

    const result = await this.sendSessionRequest(requestId, message)
    const payload = result as SendAgentMessageResponse['payload']

    if (!payload.accepted) {
      throw new Error(payload.error ?? 'Agent rejected the message')
    }
  }

  /**
   * Get detailed info about a specific agent.
   * First checks the local cache (updated by agent_update events),
   * then falls back to fetch_agents_request and filters by ID.
   */
  async getAgent(agentId: string): Promise<AgentInfo> {
    // Check cache first
    const cached = this.agentCache.get(agentId)
    if (cached) {
      return cached
    }

    // Fall back to fetching all agents and filtering
    const agents = await this.listAgents()
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }
    return agent
  }

  /**
   * List all active agents.
   * Sends fetch_agents_request, resolves when fetch_agents_response is received.
   */
  async listAgents(): Promise<AgentInfo[]> {
    const requestId = `req-${uuid()}`

    const message: FetchAgentsRequest = {
      type: 'fetch_agents_request',
      requestId,
      scope: 'active',
    }

    const result = await this.sendSessionRequest(requestId, message)
    const payload = result as FetchAgentsResponse['payload']

    // Update cache with fetched agents
    for (const agent of payload.entries) {
      this.agentCache.set(agent.id, agent)
    }

    return payload.entries
  }

  /**
   * Stop/cancel a running agent.
   * Sends cancel_agent_request. This is fire-and-forget (no response expected).
   */
  async stopAgent(agentId: string): Promise<void> {
    this.ensureConnected()

    const message: CancelAgentRequest = {
      type: 'cancel_agent_request',
      agentId,
    }

    this.sendSessionMessage(message)
  }

  /**
   * Archive a stopped/idle agent.
   * Sends archive_agent_request. Fire-and-forget — Paseo confirms via agent_update but we don't block on it.
   */
  async archiveAgent(agentId: string): Promise<void> {
    this.ensureConnected()

    const requestId = `req-${uuid()}`

    const message: ArchiveAgentRequest = {
      type: 'archive_agent_request',
      agentId,
      requestId,
    }

    this.sendSessionMessage(message)

    // Update local cache optimistically
    const cached = this.agentCache.get(agentId)
    if (cached) {
      cached.status = 'archived'
      cached.updatedAt = new Date().toISOString()
    }
  }

  /**
   * Subscribe to streaming events for a specific agent.
   * Returns an unsubscribe function.
   */
  subscribe(agentId: string, callback: (event: AgentStreamEvent) => void): () => void {
    const streamHandler = (payload: AgentStreamMessage['payload']) => {
      if (payload.agentId === agentId) {
        callback({
          agentId: payload.agentId,
          type: 'stream',
          content: payload.event,
          timestamp: new Date().toISOString(),
        })
      }
    }
    this.on('agent_stream', streamHandler)

    const updateHandler = (payload: AgentUpdateMessage['payload']) => {
      if (payload.agentId === agentId) {
        callback({
          agentId: payload.agentId,
          type: 'status',
          content: payload,
          timestamp: new Date().toISOString(),
        })
      }
    }
    this.on('agent_update', updateHandler)

    return () => {
      this.off('agent_stream', streamHandler)
      this.off('agent_update', updateHandler)
    }
  }

  // ─── Internal: Session Message Sending ─────────────────────────────────

  /**
   * Wraps a message in the session envelope and sends it (fire-and-forget).
   */
  private sendSessionMessage(message: SessionInboundMessage): void {
    const envelope: SessionEnvelope = {
      type: 'session',
      message,
    }
    this.ws!.send(JSON.stringify(envelope))
  }

  /**
   * Sends a session-wrapped request and waits for the correlated response.
   * Correlation is done via requestId matching in incoming messages.
   */
  private sendSessionRequest(requestId: string, message: SessionInboundMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.ensureConnected()

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`Request ${message.type} (${requestId}) timed out after ${this.REQUEST_TIMEOUT}ms`))
      }, this.REQUEST_TIMEOUT)

      this.pendingRequests.set(requestId, { resolve, reject, timeout })

      const envelope: SessionEnvelope = {
        type: 'session',
        message,
      }

      this.ws!.send(JSON.stringify(envelope), (err) => {
        if (err) {
          clearTimeout(timeout)
          this.pendingRequests.delete(requestId)
          reject(new Error(`Failed to send request: ${err.message}`))
        }
      })
    })
  }

  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error('Not connected to Paseo server')
    }
  }

  // ─── Internal: Message Handling ─────────────────────────────────────────

  private handleMessage(data: string): void {
    let raw: { type: string; message?: SessionOutboundMessage; [key: string]: unknown }
    try {
      raw = JSON.parse(data)
    } catch {
      this.log('warn', `Received non-JSON message: ${data.slice(0, 100)}`)
      return
    }

    // All messages from server should be session-wrapped
    if (raw.type !== 'session' || !raw.message) {
      this.log('debug', `Received non-session message type: ${raw.type}`)
      this.emit('raw_message', raw)
      return
    }

    const msg = raw.message

    switch (msg.type) {
      case 'status':
        this.handleStatusMessage(msg as StatusMessage)
        break

      case 'fetch_agents_response':
        this.handleFetchAgentsResponse(msg as FetchAgentsResponse)
        break

      case 'send_agent_message_response':
        this.handleSendAgentMessageResponse(msg as SendAgentMessageResponse)
        break

      case 'agent_update':
        this.handleAgentUpdate(msg as AgentUpdateMessage)
        break

      case 'agent_stream':
        this.handleAgentStream(msg as AgentStreamMessage)
        break

      default:
        this.log('debug', `Unhandled session message type: ${msg.type}`)
        this.emit('unhandled_message', msg)
        break
    }
  }

  /**
   * Handles status messages. These can be:
   * - server_info (handled during handshake, but also post-connect)
   * - agent_created (response to create_agent_request, correlated via requestId)
   */
  private handleStatusMessage(msg: StatusMessage): void {
    const payload = msg.payload

    this.emit('status', payload)

    // Check if this resolves a pending request (e.g., agent_created)
    if (payload.requestId) {
      const pending = this.pendingRequests.get(payload.requestId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(payload.requestId)
        pending.resolve(payload)
        return
      }
    }
  }

  private handleFetchAgentsResponse(msg: FetchAgentsResponse): void {
    const payload = msg.payload

    if (payload.requestId) {
      const pending = this.pendingRequests.get(payload.requestId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(payload.requestId)
        pending.resolve(payload)
        return
      }
    }

    this.log('warn', `Received fetch_agents_response with no matching pending request`)
  }

  private handleSendAgentMessageResponse(msg: SendAgentMessageResponse): void {
    const payload = msg.payload

    if (payload.requestId) {
      const pending = this.pendingRequests.get(payload.requestId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(payload.requestId)
        pending.resolve(payload)
        return
      }
    }

    this.log('warn', `Received send_agent_message_response with no matching pending request`)
  }

  private handleAgentUpdate(msg: AgentUpdateMessage): void {
    const payload = msg.payload

    // Update local agent cache
    if (payload.agentId) {
      const existing = this.agentCache.get(payload.agentId)
      if (existing) {
        existing.status = payload.status
        existing.updatedAt = new Date().toISOString()
        if (payload.title) existing.title = payload.title as string
      } else {
        // Create a cache entry from the update
        this.agentCache.set(payload.agentId, {
          id: payload.agentId,
          provider: (payload.provider as string) ?? 'claude',
          status: payload.status,
          title: (payload.title as string) ?? undefined,
          createdAt: (payload.createdAt as string) ?? new Date().toISOString(),
          updatedAt: (payload.updatedAt as string) ?? new Date().toISOString(),
        })
      }
    }

    this.emit('agent_update', payload)
  }

  private handleAgentStream(msg: AgentStreamMessage): void {
    this.emit('agent_stream', msg.payload)
  }

  // ─── Internal: Reconnection ─────────────────────────────────────────────

  private handleReconnect(): void {
    if (this.intentionalClose) return
    if (this.reconnectTimer) return

    this.reconnectAttempts++
    const delay = Math.min(
      PaseoClient.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      PaseoClient.MAX_RECONNECT_DELAY,
    )

    this.log('info', `Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`)
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay })

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.connect()
        this.log('info', 'Reconnected successfully')
        this.emit('reconnected')
      } catch (err) {
        this.log('warn', `Reconnect attempt ${this.reconnectAttempts} failed: ${(err as Error).message}`)
        // handleReconnect will be called again from the 'close' handler.
      }
    }, delay)
  }

  // ─── Internal: Hello Handshake ──────────────────────────────────────────

  /**
   * Sends the bare (unwrapped) hello message. This is the only message NOT
   * wrapped in the session envelope.
   */
  private sendHello(): void {
    const hello = JSON.stringify({
      type: 'hello',
      clientId: this.clientId,
      clientType: 'cli',
      protocolVersion: 1,
      capabilities: {
        reasoning_merge_enum: true,
      },
    })
    this.ws!.send(hello)
  }

  // ─── Internal: Utilities ────────────────────────────────────────────────

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const timestamp = new Date().toISOString()
    const prefix = `[PaseoClient][${timestamp}][${level.toUpperCase()}]`
    switch (level) {
      case 'error':
        console.error(`${prefix} ${message}`)
        break
      case 'warn':
        console.warn(`${prefix} ${message}`)
        break
      case 'debug':
        this.emit('log', { level, message, timestamp })
        break
      default:
        console.log(`${prefix} ${message}`)
        break
    }
  }
}

export default PaseoClient
