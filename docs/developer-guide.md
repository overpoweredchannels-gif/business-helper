# TradeOS Conversation Gateway — Developer Guide

## Overview

The Conversation Gateway is the **single public interface** for every conversational client
of TradeOS. No channel (Web, Voice, WhatsApp, Phone, MCP, Desktop, Mobile) may call the
Business Brain directly. All communication flows through the gateway.

## Architecture

```
Client (any channel)
  │
  ▼
POST /api/conversation/chat         (synchronous)
POST /api/conversation/chat/stream  (SSE streaming)
GET  /api/conversation/status       (health + metrics)
  │
  ▼
ConversationGateway  ←── TCGP v1.0 request validation
  │
  ▼
Business Brain (frozen)
```

## Quick Start

### 1. Install

```bash
npm install
npm run validate
```

The `validate` command runs:
- `tsc --noEmit` — TypeScript checks
- `test:brain` — Business Brain validation (73 tests)
- `test:gateway` — Gateway validation (40 tests)
- `test:startup` — Platform startup validation (17 tests)

### 2. Start Dev Server

```bash
npm run dev
```

### 3. Send a Chat Request

```bash
curl -X POST http://localhost:3000/api/conversation/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How is my business performing?",
    "channel": "web",
    "userId": "user_123",
    "organizationId": "org_456"
  }'
```

### 4. Check Gateway Status

```bash
curl http://localhost:3000/api/conversation/status
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/conversation/chat` | Send a message, get a response |
| POST | `/api/conversation/chat/stream` | Send a message, receive SSE events |
| GET  | `/api/conversation/status` | Gateway health and metrics |

Full schema documentation: [OpenAPI 3.1 Spec](openapi/tcgp-v1.yaml)

## Client Integration Patterns

### Web (Browser)

The `ConversationClient` SDK (framework-agnostic) handles session management,
retry logic, and event tracking:

```typescript
import { ConversationClient } from "@/lib/conversation";

const client = new ConversationClient({
  baseUrl: "http://localhost:3000",
});

const response = await client.chat("How is my business?", {
  channel: "web",
  userId: "user_123",
});

console.log(response.message);
```

### Streaming (Browser)

```typescript
import { ConversationClient } from "@/lib/conversation";

const client = new ConversationClient({ baseUrl: "http://localhost:3000" });

for await (const event of client.streamChat("Analyze my sales", {
  channel: "web",
})) {
  if (event.type === "text") {
    appendToUI(event.text!);
  } else if (event.type === "done") {
    console.log("Stream complete", event.provider, event.model);
  } else if (event.type === "error") {
    console.error("Stream error", event.error);
  }
}
```

### Voice / WhatsApp / Phone / MCP

All non-browser channels connect to the same endpoints. The `channel` field
distinguishes traffic:

```typescript
// Voice channel (IVR / telephony)
client.chat("What are my top products?", { channel: "voice" });

// WhatsApp business
client.chat("Send me the sales report", { channel: "whatsapp" });

// Phone (SMS / voice call)
client.chat("Yes, confirm the order", { channel: "phone" });

// MCP (Model Context Protocol)
client.chat("Analyze inventory", { channel: "mcp" });

// Desktop / Mobile (native apps)
client.chat("Show my dashboard", { channel: "desktop" });
client.chat("Push notification settings", { channel: "mobile" });
```

## Session & Conversation Management

### Session IDs

The gateway tracks sessions for rate limiting and continuity. Clients should
persist the sessionId:

```typescript
const sessionId = localStorage.getItem("tradeos_ai_session_id");

const client = new ConversationClient({
  baseUrl: "http://localhost:3000",
});

// The SDK allows manual sessionId (via apiKey-based prefix) or auto-generated.
// For web: the useAIChat hook persists sessionId in localStorage.
```

### Conversation IDs

For thread continuity, store the `conversationId` from the response and pass
it on subsequent requests:

```typescript
let conversationId: string | undefined;

async function chat(message: string) {
  const res = await client.chat(message, { channel: "web" });
  conversationId = res.conversationId;
  return res.message;
}

// Send multiple messages in the same thread:
await chat("Hello");
await chat("What are my sales?");  // same conversationId used automatically
client.newConversation();           // start a new thread
```

## Error Handling

The gateway returns structured errors:

```json
{
  "ok": false,
  "error": "VALIDATION_ERROR: Message is required and must be a non-empty string.",
  "version": "1.0",
  "correlationId": "corr_...",
  "requestId": "req_...",
  "conversationId": ""
}
```

| Error Code | HTTP Status | Meaning |
|-----------|-------------|---------|
| `VALIDATION_ERROR` | 422 | Malformed request (empty message, missing channel) |
| `UNSUPPORTED_VERSION` | 422 | Unsupported TCGP protocol version |
| `BRAIN_NOT_INITIALIZED` | 503 | Business Brain not loaded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Streaming Protocol (SSE)

The stream endpoint emits Server-Sent Events. Each `data` line is a JSON
`StreamEvent` object:

```json
data: {"type":"start","requestId":"req_...","conversationId":"conv_...","correlationId":"corr_...","version":"1.0","timestamp":"2026-01-01T00:00:00.000Z"}

data: {"type":"text","requestId":"req_...","conversationId":"conv_...","correlationId":"corr_...","version":"1.0","timestamp":"2026-01-01T00:00:00.000Z","text":"Your business performance..."}

data: {"type":"done","requestId":"req_...","conversationId":"conv_...","correlationId":"corr_...","version":"1.0","timestamp":"2026-01-01T00:00:00.000Z","provider":"gemini","model":"gemini-flash-latest"}
```

## Monitoring

The `/api/conversation/status` endpoint provides real-time metrics:

```bash
curl http://localhost:3000/api/conversation/status | jq
```

```json
{
  "ready": true,
  "brainAttached": true,
  "conversationCount": 5,
  "sessionCount": 3,
  "uptimeMs": 3600000,
  "metrics": {
    "requestCount": 150,
    "errorCount": 2,
    "validationErrorCount": 1,
    "brainErrorCount": 0,
    "totalDurationMs": 45000,
    "avgDurationMs": 300,
    "minDurationMs": 150,
    "maxDurationMs": 2000,
    "conversationsCreated": 5,
    "sessionsCreated": 3,
    "activeConversations": 5,
    "activeSessions": 3,
    "startedAt": 1700000000000,
    "uptimeMs": 3600000
  }
}
```

## Correlation ID Tracing

Every request gets a `correlationId` (client-provided or gateway-generated).
This ID flows through every event log entry, enabling end-to-end tracing:

```typescript
// Client provides a correlationId for traceability
const response = await client.chat("Hello", {
  channel: "web",
  metadata: { correlationId: "my-trace-id" },
});
// The gateway propagates it through all logs and streaming events.
```

## SDK Reference

The `ConversationClient` class provides:

- **`chat(message, options?)`** — Send message with automatic retry (3 attempts, exponential backoff)
- **`streamChat(message, options?)`** — Async generator for SSE streaming
- **`newConversation()`** — Reset conversation thread
- **`getSessionId()`** — Get current session ID
- **`getConversationId()`** — Get current conversation ID
- **`on(event, handler)` / `off(event, handler)`** — Event emitter (events: `chat.success`, `chat.timeout`, `retry`, `stream.event`, `conversation.reset`)

### Error types

| Class | When thrown |
|-------|------------|
| `ClientError` | Base class for all client errors |
| `TimeoutError` | Request exceeded configured timeout |
| `NetworkError` | Network/fetch failure |
| `GatewayRequestError` | Gateway returned a non-retryable error |
