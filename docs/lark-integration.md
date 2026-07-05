# Lark/Feishu Integration

## Overview

The Lark integration receives messages via event streaming, manages thread-based sessions, and spawns/reuses Claude Code agents. Responses are delivered as thread replies.

### Message Flow

```
User @mentions bot in group/DM
       ↓
lark-cli event consume (NDJSON stream)
       ↓
LarkEventConsumer.handleLine()
  - Parse JSON
  - Filter: type=im.message.receive_v1, message_type=text
  - Deduplicate by event_id
       ↓
LarkEventConsumer.handleMessage()
  - Strip @mention
  - Determine thread: root_id (existing thread) or message_id (new thread)
  - Check /new command → reset session if requested
  - Send reaction (OK emoji)
       ↓
Session lookup (LarkSessionStore)
  ├── Session exists → sendPrompt to existing agent
  └── No session → Create new agent, store in session store
       ↓
Agent executes task
       ↓
Agent replies: lark-cli im +messages-reply --message-id "<thread_root>" --reply-in-thread --text "<reply>"
```

### Event Format

```json
{
  "type": "im.message.receive_v1",
  "event_id": "ev_xxx",
  "message_id": "om_xxx",
  "chat_id": "oc_xxx",
  "chat_type": "group",
  "message_type": "text",
  "sender_id": "ou_xxx",
  "content": "@BotName do something",
  "timestamp": "1719000000000"
}
```

### Thread Session Management

Sessions are stored in-memory (`LarkSessionStore`):

```typescript
interface LarkSession {
  threadId: string      // Root message_id
  agentId: string       // Paseo agent ID
  chatId: string        // Lark chat_id
  createdAt: number
  lastActiveAt: number
}
```

- **Key**: `threadId` (= `root_id` for thread replies, or `message_id` for new conversations)
- **TTL**: 1 hour (configurable)
- **Cleanup**: Automatic on agent archive/stop + periodic TTL sweep

### Reply Mechanism

Agents receive a prompt template with the thread-reply command:
```
<user_task>

---
Reply when done (reply in thread): lark-cli im +messages-reply --message-id "<thread_root>" --reply-in-thread --as bot --text "<reply>"
Note: Replace <reply> with your actual response text. For multi-line replies, use \n for newlines.
```

This makes the response appear as a thread reply to the original message.

### /new Command

Users can send `/new` in a thread to force a fresh session. The next message will create a new agent.

## lark-cli Commands

| Operation | Command |
|-----------|---------|
| Event stream | `lark-cli event consume im.message.receive_v1 --as bot` |
| Send message | `lark-cli im +send --chat-id "<id>" --content '[...]'` |
| Reply in thread | `lark-cli im +reply --message-id "<id>" --content '[...]'` |
| Send reaction | `lark-cli im reactions create --message-id "<id>" --data '{"reaction_type":{"emoji_type":"OK"}}'` |
| Config init | `lark-cli config init --app-id <id> --app-secret-stdin --brand lark` |

## Limitations

1. **Text only**: Images and other message types are ignored
2. **In-memory sessions**: Sessions are lost on server restart (no persistence)
3. **Single-instance only**: Session store is per-process, not shared across replicas
4. **Thread field dependency**: Relies on `root_id` being present in lark-cli event output for thread detection
