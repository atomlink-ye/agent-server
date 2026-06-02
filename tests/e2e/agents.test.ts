import { describe, it, expect } from 'vitest'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001'
const API = `${BASE_URL}/api/v1`

// Use haiku for tests — cheapest and fastest model available
const TEST_MODEL = 'claude-haiku-4-5'

// Helper to make requests
async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  return { status: res.status, data: await res.json() }
}

describe('Agent Server E2E', () => {
  // Health check
  describe('GET /api/health', () => {
    it('should return ok status', async () => {
      const res = await fetch(`${BASE_URL}/api/health`)
      const data = await res.json()
      expect(res.status).toBe(200)
      expect(data.status).toBe('ok')
      expect(data.timestamp).toBeDefined()
    })
  })

  // Agent CRUD flow
  describe('Agent lifecycle', () => {
    let agentId: string

    it('POST /agents — should create an agent', async () => {
      const { status, data } = await api('/agents', {
        method: 'POST',
        body: JSON.stringify({
          prompt: 'Reply with exactly: hello world. Do not use any tools.',
          provider: 'claude',
          model: TEST_MODEL,
          mode: 'plan',
        }),
      })

      expect(status).toBe(201)
      expect(data.success).toBe(true)
      expect(data.data.id).toBeDefined()
      expect(data.data.provider).toBe('claude')
      agentId = data.data.id
      console.log(`  Created agent: ${agentId}`)
    })

    it('GET /agents — should list agents including the created one', async () => {
      const { status, data } = await api('/agents')

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      expect(Array.isArray(data.data)).toBe(true)
      // Paseo returns entries with nested `agent` field or flat — handle both
      const found = data.data.find((entry: any) => {
        const id = entry.id || entry.agent?.id
        return id === agentId
      })
      expect(found).toBeDefined()
    })

    it('GET /agents/:id — should get agent details', async () => {
      // Wait a moment for agent to initialize
      await new Promise(r => setTimeout(r, 3000))

      const { status, data } = await api(`/agents/${agentId}`)

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.id).toBe(agentId)
      expect(data.data.status).toBeDefined()
      console.log(`  Agent status: ${data.data.status}`)
    })

    it('POST /agents/:id/send — should send a prompt', async () => {
      // Wait for agent to be idle/ready
      await new Promise(r => setTimeout(r, 5000))

      const { status, data } = await api(`/agents/${agentId}/send`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: 'Now reply with exactly: goodbye.',
        }),
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      console.log(`  Sent prompt to agent: ${agentId}`)
    })

    it('GET /agents/:id/stream — should receive SSE events', async () => {
      const res = await fetch(`${API}/agents/${agentId}/stream`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')

      // Read first few events (with timeout)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let received = ''

      const timeout = new Promise<string>(resolve =>
        setTimeout(() => resolve(received), 5000)
      )

      const reading = (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            received += decoder.decode(value, { stream: true })
            if (received.includes('event: connected')) {
              break
            }
          }
        } catch {
          // timeout or abort
        }
        return received
      })()

      const result = await Promise.race([reading, timeout])
      reader.cancel()

      expect(result).toContain('event: connected')
      expect(result).toContain(agentId)
      console.log(`  SSE stream connected for agent: ${agentId}`)
    })

    it('DELETE /agents/:id — should stop and archive the agent', async () => {
      const { status, data } = await api(`/agents/${agentId}`, {
        method: 'DELETE',
      })

      expect(status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('archived')
      console.log(`  Archived agent: ${agentId}`)
    })

    it('GET /agents/:id — should return 404 or archived for deleted agent', async () => {
      const { status } = await api(`/agents/${agentId}`)
      // Either 404 or still returns with archived status - both are acceptable
      expect([200, 404]).toContain(status)
    })
  })

  // Validation tests
  describe('Input validation', () => {
    it('POST /agents — should reject empty prompt', async () => {
      const { status, data } = await api('/agents', {
        method: 'POST',
        body: JSON.stringify({ prompt: '' }),
      })

      expect(status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    })

    it('POST /agents — should reject missing prompt', async () => {
      const { status, data } = await api('/agents', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      expect(status).toBe(400)
      expect(data.success).toBe(false)
    })

    it('POST /agents — should reject invalid JSON', async () => {
      const res = await fetch(`${API}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      })
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data.success).toBe(false)
    })

    it('POST /agents/:id/send — should reject empty prompt', async () => {
      const { status, data } = await api('/agents/fake-id/send', {
        method: 'POST',
        body: JSON.stringify({ prompt: '' }),
      })

      expect(status).toBe(400)
      expect(data.success).toBe(false)
    })

    it('GET /agents/nonexistent — should return 404', async () => {
      const { status, data } = await api('/agents/nonexistent-agent-id-12345')

      expect([404, 500]).toContain(status)
      expect(data.success).toBe(false)
    })
  })

  // 404 handling
  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await fetch(`${BASE_URL}/api/v1/unknown`)
      const data = await res.json()

      expect(res.status).toBe(404)
      expect(data.success).toBe(false)
    })
  })
})
