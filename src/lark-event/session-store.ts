/**
 * In-memory session store mapping Lark thread IDs to Paseo agent sessions.
 * Enables session continuity: messages in the same thread reuse the same agent.
 */

export interface LarkSession {
  /** Primary key (chat_id for P2P, thread_id or message_id for group) */
  threadId: string
  /** Original message_id that created this session (secondary lookup key) */
  originMessageId: string
  /** Paseo agent ID */
  agentId: string
  /** Lark chat_id for the conversation */
  chatId: string
  /** Timestamp when session was created */
  createdAt: number
  /** Timestamp of last activity */
  lastActiveAt: number
}

export class LarkSessionStore {
  private sessions: Map<string, LarkSession> = new Map()
  private readonly maxAge: number
  private cleanupTimer: NodeJS.Timeout | null = null

  /**
   * @param maxAge Session TTL in milliseconds (default 1 hour)
   */
  constructor(maxAge = 60 * 60 * 1000) {
    this.maxAge = maxAge
    // Run cleanup every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000)
  }

  /** Look up a session by thread root message ID */
  getByThread(threadId: string): LarkSession | undefined {
    const session = this.sessions.get(threadId)
    if (!session) return undefined
    // Check if expired
    if (Date.now() - session.lastActiveAt > this.maxAge) {
      this.sessions.delete(threadId)
      return undefined
    }
    return session
  }

  /** Look up a session by originMessageId (secondary key, for thread migration) */
  getByOriginMessage(messageId: string): { key: string; session: LarkSession } | undefined {
    for (const [key, session] of this.sessions) {
      if (session.originMessageId === messageId) {
        if (Date.now() - session.lastActiveAt > this.maxAge) {
          this.sessions.delete(key)
          return undefined
        }
        return { key, session }
      }
    }
    return undefined
  }

  /** Store or update a session */
  set(threadId: string, session: LarkSession): void {
    this.sessions.set(threadId, session)
  }

  /** Update lastActiveAt for an existing session */
  touch(threadId: string): void {
    const session = this.sessions.get(threadId)
    if (session) {
      session.lastActiveAt = Date.now()
    }
  }

  /** Remove a session by thread ID */
  removeByThread(threadId: string): void {
    this.sessions.delete(threadId)
  }

  /** Remove all sessions for a given agent ID (e.g., when agent is archived) */
  removeByAgent(agentId: string): void {
    for (const [threadId, session] of this.sessions) {
      if (session.agentId === agentId) {
        this.sessions.delete(threadId)
      }
    }
  }

  /** Remove expired sessions */
  private cleanup(): void {
    const now = Date.now()
    for (const [threadId, session] of this.sessions) {
      if (now - session.lastActiveAt > this.maxAge) {
        this.sessions.delete(threadId)
      }
    }
  }

  /** Stop the cleanup timer */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /** Iterate all sessions (for secondary lookup) */
  entries(): IterableIterator<[string, LarkSession]> {
    return this.sessions.entries()
  }

  /** Current number of active sessions (for diagnostics) */
  get size(): number {
    return this.sessions.size
  }
}
