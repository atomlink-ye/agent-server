import { ChildProcess, spawn } from 'child_process'
import { createInterface } from 'readline'
import { EventEmitter } from 'events'
import type { PaseoClient } from '../paseo-client/index.js'

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
}

export class LarkEventConsumer extends EventEmitter {
  private process: ChildProcess | null = null
  private options: LarkEventConsumerOptions
  private running = false
  private restartTimer: NodeJS.Timeout | null = null

  constructor(options: LarkEventConsumerOptions) {
    super()
    this.options = {
      restartDelay: 5000,
      model: 'qa.fiat.chat.cloudways.default.sonnet-4-6',
      ...options,
    }
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
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
  }

  private spawn(): void {
    const { larkCliBin, uid, gid, env } = this.options

    console.log('[lark-event] Starting event consumer...')

    this.process = spawn(
      larkCliBin,
      ['event', 'consume', 'im.message.receive_v1', '--as', 'bot', '--quiet'],
      {
        uid,
        gid,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    const rl = createInterface({ input: this.process.stdout! })
    rl.on('line', (line) => {
      this.handleLine(line)
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) console.error(`[lark-event] ${msg}`)
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

    console.log(`[lark-event] Received message: "${event.content}" from ${event.sender_id} in ${event.chat_id}`)
    this.emit('message', event)
    this.handleMessage(event)
  }

  private async handleMessage(event: LarkMessageEvent): Promise<void> {
    const { paseoClient, model, agentCwd } = this.options

    // Strip @mention prefix if present
    const content = event.content.replace(/@\S+\s*/, '').trim()
    if (!content) {
      console.log('[lark-event] Empty message after stripping mention, ignoring')
      return
    }

    const prompt = this.buildAgentPrompt(content, event)

    try {
      const agent = await paseoClient.createAgent({
        prompt,
        model,
        cwd: agentCwd,
        mode: 'bypassPermissions',
      })
      console.log(`[lark-event] Created agent ${agent.id} for message ${event.message_id}`)
      this.emit('agent_created', { agentId: agent.id, event })
    } catch (err: any) {
      console.error(`[lark-event] Failed to create agent: ${err.message}`)
      this.emit('error', err)
    }
  }

  private buildAgentPrompt(content: string, event: LarkMessageEvent): string {
    return `You received a message from a Lark user. Process it and reply.

## Message Details
- Chat ID: ${event.chat_id}
- Chat Type: ${event.chat_type}
- Message ID: ${event.message_id}
- Sender ID: ${event.sender_id}
- Content: ${content}

## Instructions
1. Understand what the user is asking
2. Use your available tools and skills (including lark-cli) to fulfill the request
3. When done, reply to the user using lark-cli:
   lark-cli im +send --chat-id "${event.chat_id}" --content '[{"type":"text","text":"YOUR_REPLY_HERE"}]'

If the user asks about a document, use lark-cli docs or drive commands.
If the user asks you to comment on a document, use lark-cli drive +add-comment.
Always reply to the user when you're done.`
  }
}
