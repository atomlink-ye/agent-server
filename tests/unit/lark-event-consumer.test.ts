import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, chmodSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LarkEventConsumer, type LarkMessageEvent } from '../../src/lark-event/consumer.js'

const MOCK_SCRIPT = join(tmpdir(), 'mock-lark-cli.sh')

function createMockScript(events: object[], delayMs = 100): string {
  const lines = events.map(e => `echo '${JSON.stringify(e)}'`).join(`\nsleep 0.${delayMs}\n`)
  const script = `#!/bin/bash\n${lines}\nsleep 10\n`
  writeFileSync(MOCK_SCRIPT, script)
  chmodSync(MOCK_SCRIPT, '755')
  return MOCK_SCRIPT
}

function createMockPaseoClient() {
  return {
    createAgent: vi.fn().mockResolvedValue({ id: 'agent-123', status: 'running' }),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as any
}

function sampleEvent(overrides?: Partial<LarkMessageEvent>): LarkMessageEvent {
  return {
    type: 'im.message.receive_v1',
    event_id: 'evt_001',
    message_id: 'om_msg001',
    chat_id: 'oc_chat001',
    chat_type: 'group',
    message_type: 'text',
    sender_id: 'ou_user001',
    content: '@agent-server-bot say hello',
    timestamp: '1781597289124',
    ...overrides,
  }
}

describe('LarkEventConsumer', () => {
  let mockPaseoClient: ReturnType<typeof createMockPaseoClient>
  let consumer: LarkEventConsumer

  beforeEach(() => {
    mockPaseoClient = createMockPaseoClient()
  })

  afterEach(() => {
    consumer?.stop()
    vi.clearAllMocks()
    try { unlinkSync(MOCK_SCRIPT) } catch {}
  })

  it('should parse NDJSON events and create agents', async () => {
    const event = sampleEvent()
    createMockScript([event])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      model: 'test-model',
      agentCwd: '/tmp',
      restartDelay: 0,
    })

    const agentPromise = new Promise<{ agentId: string; threadId: string; event: LarkMessageEvent }>((resolve) => {
      consumer.on('agent_created', resolve)
    })

    consumer.start()
    const result = await agentPromise

    expect(result.agentId).toBe('agent-123')
    expect(result.threadId).toBe('om_msg001') // message_id becomes threadId for new messages
    expect(mockPaseoClient.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        cwd: '/tmp',
        mode: 'bypassPermissions',
        prompt: expect.stringContaining('say hello'),
      })
    )
  })

  it('should strip @mention from content', async () => {
    const event = sampleEvent({ content: '@bot-name please help me' })
    createMockScript([event])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    const agentPromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', resolve)
    })

    consumer.start()
    await agentPromise

    const prompt = mockPaseoClient.createAgent.mock.calls[0][0].prompt
    expect(prompt).toContain('please help me')
    expect(prompt).not.toContain('@bot-name')
  })

  it('should ignore non-text messages', async () => {
    const textEvent = sampleEvent({ content: '@bot do something' })
    const imageEvent = sampleEvent({ message_type: 'image', content: '[image]', event_id: 'evt_002' })
    createMockScript([imageEvent, textEvent])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    const agentPromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', resolve)
    })

    consumer.start()
    await agentPromise

    // Only the text event should trigger agent creation
    expect(mockPaseoClient.createAgent).toHaveBeenCalledTimes(1)
  })

  it('should ignore empty content after stripping mention', async () => {
    const emptyEvent = sampleEvent({ content: '@bot-name ', event_id: 'evt_empty' })
    const validEvent = sampleEvent({ content: '@bot hi there', event_id: 'evt_valid' })
    createMockScript([emptyEvent, validEvent])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    const agentPromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', resolve)
    })

    consumer.start()
    await agentPromise

    expect(mockPaseoClient.createAgent).toHaveBeenCalledTimes(1)
    const prompt = mockPaseoClient.createAgent.mock.calls[0][0].prompt
    expect(prompt).toContain('hi there')
  })

  it('should include reply-in-thread instructions in prompt', async () => {
    const event = sampleEvent({ chat_id: 'oc_special_chat', content: '@bot what time is it' })
    createMockScript([event])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    const agentPromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', resolve)
    })

    consumer.start()
    await agentPromise

    const prompt = mockPaseoClient.createAgent.mock.calls[0][0].prompt
    expect(prompt).toContain('+messages-reply')
    expect(prompt).toContain('--reply-in-thread')
    expect(prompt).toContain('om_msg001') // thread root is the message_id
  })

  it('should reuse session for messages in same thread', async () => {
    // First message creates the agent
    const firstEvent = sampleEvent({ content: '@bot task one', event_id: 'evt_1', message_id: 'om_root' })
    // Second message is in the same thread (has root_id pointing to first message)
    const threadEvent = sampleEvent({
      content: '@bot follow up',
      event_id: 'evt_2',
      message_id: 'om_reply1',
      root_id: 'om_root',
    })
    createMockScript([firstEvent, threadEvent])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    let agentCreatedCount = 0
    let promptSentCount = 0
    consumer.on('agent_created', () => agentCreatedCount++)
    consumer.on('prompt_sent', () => promptSentCount++)

    const donePromise = new Promise<void>((resolve) => {
      consumer.on('prompt_sent', resolve)
    })

    consumer.start()
    await donePromise

    // First message creates agent, second sends prompt to existing agent
    expect(agentCreatedCount).toBe(1)
    expect(promptSentCount).toBe(1)
    expect(mockPaseoClient.createAgent).toHaveBeenCalledTimes(1)
    expect(mockPaseoClient.sendPrompt).toHaveBeenCalledWith('agent-123', 'follow up')
  })

  it('should create new agent if existing session agent is dead', async () => {
    // First message creates agent
    const firstEvent = sampleEvent({ content: '@bot task', event_id: 'evt_1', message_id: 'om_root' })
    // Second message in thread, but sendPrompt will fail
    const threadEvent = sampleEvent({
      content: '@bot more work',
      event_id: 'evt_2',
      message_id: 'om_reply1',
      root_id: 'om_root',
    })
    createMockScript([firstEvent, threadEvent])

    // sendPrompt fails (agent dead)
    mockPaseoClient.sendPrompt.mockRejectedValue(new Error('Agent not found'))

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    let agentCreatedCount = 0
    const donePromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', () => {
        agentCreatedCount++
        if (agentCreatedCount === 2) resolve()
      })
    })

    consumer.start()
    await donePromise

    // Both messages create agents (second one because sendPrompt failed)
    expect(mockPaseoClient.createAgent).toHaveBeenCalledTimes(2)
  })

  it('should deduplicate events with same event_id', async () => {
    const event = sampleEvent({ event_id: 'evt_dupe' })
    // Same event delivered twice (Lark retry)
    createMockScript([event, event])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    const agentPromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', resolve)
    })

    consumer.start()
    await agentPromise

    // Wait a bit to ensure second event was processed (and deduped)
    await new Promise(r => setTimeout(r, 300))

    expect(mockPaseoClient.createAgent).toHaveBeenCalledTimes(1)
  })

  it('should handle /new command to reset session', async () => {
    // Create session first
    const firstEvent = sampleEvent({ content: '@bot hello', event_id: 'evt_1', message_id: 'om_root' })
    // /new command in thread
    const newCmd = sampleEvent({
      content: '@bot /new',
      event_id: 'evt_new',
      message_id: 'om_new',
      root_id: 'om_root',
    })
    // Follow-up after /new should create new agent
    const followUp = sampleEvent({
      content: '@bot fresh start',
      event_id: 'evt_3',
      message_id: 'om_follow',
      root_id: 'om_root',
    })
    createMockScript([firstEvent, newCmd, followUp])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    let agentCreatedCount = 0
    const donePromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', () => {
        agentCreatedCount++
        if (agentCreatedCount === 2) resolve()
      })
    })

    consumer.start()
    await donePromise

    // Two agents created: first message + after /new reset
    expect(mockPaseoClient.createAgent).toHaveBeenCalledTimes(2)
    // sendPrompt should NOT have been called (session was reset before follow-up)
    expect(mockPaseoClient.sendPrompt).not.toHaveBeenCalled()
  })

  it('should handle multiple events sequentially', async () => {
    const events = [
      sampleEvent({ content: '@bot task one', event_id: 'evt_1', message_id: 'msg_1' }),
      sampleEvent({ content: '@bot task two', event_id: 'evt_2', message_id: 'msg_2' }),
    ]
    createMockScript(events)

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    let count = 0
    const donePromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', () => {
        count++
        if (count === 2) resolve()
      })
    })

    consumer.start()
    await donePromise

    // Different message_ids (no root_id) = different threads = new agents
    expect(mockPaseoClient.createAgent).toHaveBeenCalledTimes(2)
  })

  it('should handle malformed JSON gracefully', async () => {
    // Write a script that outputs bad JSON then good JSON
    const event = sampleEvent()
    const script = `#!/bin/bash
echo 'not valid json'
echo '${JSON.stringify(event)}'
sleep 10
`
    writeFileSync(MOCK_SCRIPT, script)
    chmodSync(MOCK_SCRIPT, '755')

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    const agentPromise = new Promise<void>((resolve) => {
      consumer.on('agent_created', resolve)
    })

    consumer.start()
    await agentPromise

    expect(mockPaseoClient.createAgent).toHaveBeenCalledTimes(1)
  })

  it('should stop the child process on stop()', async () => {
    const event = sampleEvent()
    createMockScript([event])

    consumer = new LarkEventConsumer({
      larkCliBin: MOCK_SCRIPT,
      paseoClient: mockPaseoClient,
      restartDelay: 0,
    })

    consumer.start()

    // Wait a bit for the process to start
    await new Promise(r => setTimeout(r, 200))

    consumer.stop()

    // After stop, no more events should be processed
    await new Promise(r => setTimeout(r, 200))
    // The process should have been killed
  })
})
