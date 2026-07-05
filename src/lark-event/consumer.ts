import { ChildProcess, spawn, execSync } from 'child_process'
import { createInterface } from 'readline'
import { EventEmitter } from 'events'
import type { PaseoClient } from '../paseo-client/index.js'
import { LarkSessionStore } from './session-store.js'

export interface LarkMessageEvent {
  type: string
  event_id: string
  message_id: string
  chat_id: string
  chat_type: string // 'group' | 'p2p'
  message_type: string // 'text' | 'image' | ...
  sender_id: string
  content: string
  timestamp: string
  /** Root message ID — present when this message is in a thread */
  root_id?: string
  /** Parent message ID — present when replying to a specific message in thread */
  parent_id?: string
}

export interface LarkEventConsumerOptions {
  larkCliBin: string
  paseoClient: PaseoClient
  /** Model to use for spawned agents */
  model?: string
  /** Working directory for spawned agents */
  agentCwd?: string
  /** User identity for lark-cli (uid/gid to run as) */
  uid?: number
  gid?: number
  /** Environment variables for the child process */
  env?: Record<string, string>
  /** Auto-restart delay in ms after crash (0 = no restart) */
  restartDelay?: number
  /** Session TTL in ms (default 1 hour) */
  sessionTtl?: number
}

/** Command to force a new session even within a thread */
const NEW_SESSION_CMD = '/new'

export class LarkEventConsumer extends EventEmitter {
  private process: ChildProcess | null = null
  private options: LarkEventConsumerOptions
  private running = false
  private restartTimer: NodeJS.Timeout | null = null
  private sessionStore: LarkSessionStore
  /** Set of event_ids already processed (deduplication window) */
  private processedEvents: Map<string, number> = new Map()
  private dedupeCleanupTimer: NodeJS.Timeout | null = null

  constructor(options: LarkEventConsumerOptions) {
    super()
    this.options = {
      restartDelay: 5000,
      model: 'qa.fiat.chat.cloudways.default.sonnet-4-6',
      sessionTtl: 60 * 60 * 1000, // 1 hour
      ...options,
    }
    this.sessionStore = new LarkSessionStore(this.options.sessionTtl)
    // Clean up deduplication map every 5 minutes (keep 5 min window)
    this.dedupeCleanupTimer = setInterval(() => this.cleanupDedupeMap(), 5 * 60 * 1000)

    // Listen for agent lifecycle events to clean up sessions
    this.options.paseoClient.on('agent_update', (payload: { agentId: string; status: string }) => {
      if (payload.status === 'archived' || payload.status === 'stopped') {
        this.sessionStore.removeByAgent(payload.agentId)
      }
    })
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.spawn()
  }

  stop(): void {
    this.running = false
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.dedupeCleanupTimer) {
      clearInterval(this.dedupeCleanupTimer)
      this.dedupeCleanupTimer = null
    }
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
    this.sessionStore.destroy()
  }

  private spawn(): void {
    const { larkCliBin, uid, gid, env } = this.options

    console.log('[lark-event] Starting event consumer...')

    // Must use shell invocation — lark-cli exits immediately when spawned directly
    // with piped stdio (no TTY). Running via sh -c keeps it alive.
    const cmd = `exec ${larkCliBin} event consume im.message.receive_v1 --as bot`
    this.process = spawn('sh', ['-c', cmd],
      {
        uid,
        gid,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )

    const rl = createInterface({ input: this.process.stdout! })
    rl.on('line', (line) => {
      this.handleLine(line)
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) {
        // Info-level messages from lark-cli (e.g. [event] ready, [source] connected)
        if (msg.startsWith('[event]') || msg.startsWith('[source]')) {
          console.log(`[lark-event] ${msg}`)
        } else {
          console.error(`[lark-event] ${msg}`)
        }
      }
    })

    this.process.on('error', (err) => {
      console.error(`[lark-event] Process error: ${err.message}`)
      this.emit('error', err)
    })

    this.process.on('exit', (code) => {
      console.warn(`[lark-event] Process exited with code ${code}`)
      this.process = null
      this.scheduleRestart()
    })
  }

  private scheduleRestart(): void {
    if (!this.running || !this.options.restartDelay) return
    console.log(`[lark-event] Restarting in ${this.options.restartDelay}ms...`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.running) this.spawn()
    }, this.options.restartDelay)
  }

  private handleLine(line: string): void {
    if (!line.trim()) return

    let event: LarkMessageEvent
    try {
      event = JSON.parse(line)
    } catch {
      console.warn(`[lark-event] Failed to parse: ${line.slice(0, 100)}`)
      return
    }

    if (event.type !== 'im.message.receive_v1') return
    if (event.message_type !== 'text') {
      console.log(`[lark-event] Ignoring non-text message type: ${event.message_type}`)
      return
    }

    // Deduplicate events (Lark may retry delivery)
    if (this.isDuplicate(event.event_id)) {
      console.log(`[lark-event] Duplicate event ${event.event_id}, skipping`)
      return
    }

    console.log(`[lark-event] Received message: "${event.content}" from ${event.sender_id} in ${event.chat_id} (root_id=${event.root_id || 'none'})`)
    this.emit('message', event)
    this.handleMessage(event)
  }

  private isDuplicate(eventId: string): boolean {
    if (this.processedEvents.has(eventId)) return true
    this.processedEvents.set(eventId, Date.now())
    return false
  }

  private cleanupDedupeMap(): void {
    const cutoff = Date.now() - 5 * 60 * 1000
    for (const [id, ts] of this.processedEvents) {
      if (ts < cutoff) this.processedEvents.delete(id)
    }
  }

  private async handleMessage(event: LarkMessageEvent): Promise<void> {
    const { paseoClient, model, agentCwd } = this.options

    // Strip @mention prefix if present
    const content = event.content.replace(/@\S+\s*/, '').trim()
    if (!content) {
      console.log('[lark-event] Empty message after stripping mention, ignoring')
      return
    }

    // Determine session key
    // P2P: use chat_id (one conversation = one session, simple and reliable)
    // Group: resolve thread_id via +messages-mget, fall back to message_id
    let threadId: string
    if (event.chat_type === 'p2p') {
      threadId = event.chat_id
    } else {
      threadId = event.root_id || this.resolveThreadId(event.message_id) || event.message_id
    }
    const isInThread = event.chat_type === 'p2p' || threadId !== event.message_id

    // Check for /new command to force a fresh session
    if (content === NEW_SESSION_CMD) {
      this.sessionStore.removeByThread(threadId)
      this.sendReaction(event.message_id, 'DONE')
      console.log(`[lark-event] Session reset for thread ${threadId}`)
      return
    }

    // Send ack reaction
    this.sendReaction(event.message_id, 'OK')

    // Try to reuse existing session for this thread
    let existingSession = this.sessionStore.getByThread(threadId)
    // For group threads: if not found by thread_id, try secondary lookup
    // (first message stored under message_id before thread was created)
    if (!existingSession && event.chat_type !== 'p2p' && threadId !== event.message_id) {
      // threadId is a resolved thread_id but session was stored under message_id
      // Search sessions in same chat, check if their originMessageId now resolves to this thread_id
      for (const [key, session] of this.sessionStore.entries()) {
        if (session.chatId === event.chat_id && key !== threadId) {
          const originThreadId = this.resolveThreadId(session.originMessageId)
          if (originThreadId === threadId) {
            existingSession = session
            // Migrate: update key from message_id to thread_id (permanent)
            this.sessionStore.removeByThread(key)
            this.sessionStore.set(threadId, { ...session, threadId })
            console.log(`[lark-event] Migrated session key: ${key} → ${threadId}`)
            break
          }
        }
      }
    }
    if (existingSession) {
      try {
        await paseoClient.sendPrompt(existingSession.agentId, content)
        this.sessionStore.touch(threadId)
        console.log(`[lark-event] Sent to existing agent ${existingSession.agentId} in thread ${threadId}`)
        this.emit('prompt_sent', { agentId: existingSession.agentId, threadId, event })
        return
      } catch (err: any) {
        // Agent may have died/been archived — fall through to create new one
        console.warn(`[lark-event] Failed to send to existing agent ${existingSession.agentId}: ${err.message}, creating new agent`)
        this.sessionStore.removeByThread(threadId)
      }
    }

    // Create a new agent for this thread
    const prompt = this.buildAgentPrompt(content, event, threadId)

    try {
      const agent = await paseoClient.createAgent({
        prompt,
        model,
        cwd: agentCwd,
        mode: 'bypassPermissions',
      })

      // Store session mapping with originMessageId for secondary lookup
      this.sessionStore.set(threadId, {
        threadId,
        originMessageId: event.message_id,
        agentId: agent.id,
        chatId: event.chat_id,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      })

      console.log(`[lark-event] Created agent ${agent.id} for thread ${threadId} (message ${event.message_id})`)
      this.emit('agent_created', { agentId: agent.id, threadId, event })
    } catch (err: any) {
      console.error(`[lark-event] Failed to create agent: ${err.message}`)
      this.emit('error', err)
    }
  }

  private sendReaction(messageId: string, emojiType: string): void {
    const { larkCliBin, uid, gid, env } = this.options
    try {
      const cmd = `${larkCliBin} im reactions create --message-id "${messageId}" --data '{"reaction_type":{"emoji_type":"${emojiType}"}}' --as bot`
      spawn('sh', ['-c', cmd], {
        uid,
        gid,
        env,
        stdio: 'ignore',
        detached: true,
      }).unref()
      console.log(`[lark-event] Sent reaction ${emojiType} to ${messageId}`)
    } catch (err: any) {
      console.warn(`[lark-event] Failed to send reaction: ${err.message}`)
    }
  }

  private resolveThreadId(messageId: string): string | null {
    const { larkCliBin, uid, gid, env } = this.options
    try {
      const cmd = `${larkCliBin} im +messages-mget --message-ids "${messageId}" --as bot`
      const output = execSync(cmd, {
        uid,
        gid,
        env,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      // Output may have warning lines before JSON — find first '{'
      const jsonStart = output.indexOf('{')
      if (jsonStart === -1) return null
      const data = JSON.parse(output.slice(jsonStart))
      // Navigate: data.data.messages[0].thread_id or data.data[0].thread_id
      const messages = data?.data?.messages || data?.data || []
      const msgList = Array.isArray(messages) ? messages : [messages]
      for (const msg of msgList) {
        if (msg?.thread_id) {
          console.log(`[lark-event] Resolved thread_id=${msg.thread_id} for message ${messageId}`)
          return msg.thread_id
        }
      }
    } catch (err: any) {
      console.warn(`[lark-event] Failed to resolve thread_id for ${messageId}: ${err.message}`)
    }
    return null
  }


  private buildAgentPrompt(content: string, event: LarkMessageEvent, threadId: string): string {
    // Reply target: use message_id for reply-in-thread (not threadId which may be chat_id for P2P)
    const replyTarget = event.message_id
    const replyCmd = `lark-cli im +messages-reply --message-id "${replyTarget}" --reply-in-thread --as bot --text "<reply>"`

    return `${content}

---
Reply when done (reply in thread): ${replyCmd}
Note: Replace <reply> with your actual response text. For multi-line replies, use \\n for newlines.`
  }
}
