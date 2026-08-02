# Unified AI Assistant — Architectural Plan

## 1. Problem Statement

TradeOS currently has **four separate AI pages** that share overlapping logic but are built independently:

| Page | Lines | Purpose | External AI? | Creates Records? |
|------|-------|---------|-------------|-----------------|
| AI Analytics | ~170 | Read-only Q&A over BI data | Yes | No |
| AI Business Query | ~300 | General business Q&A | Yes | No |
| AI Voice Operator | ~670 | Voice hub with intent routing | Yes | No |
| AI Assistant | ~730 | Action draft creation & execution | No (regex only) | Yes |

**Problems:**
- ~3,040 total lines of duplicated, scattered code
- 40+ state variables in a single file
- AI Assistant uses fragile regex instead of real language understanding
- Incomplete voice system (browser-only)
- No WhatsApp/messaging integration
- No chart/graph generation from AI
- A 1,046-line state machine (`conversation-engine.ts`) is completely unused

---

## 2. Solution: One Unified AI Assistant

A single page with three modes accessible via tabs, sharing one conversation engine, one data layer, and one voice system.

```
┌──────────────────────────────────────────────────────────┐
│                    AI ASSISTANT                          │
│  ┌──────────┬───────────┬──────────┐                     │
│  │   Chat   │  Actions  │  Voice   │  ← Mode Tabs       │
│  ├──────────┴───────────┴──────────┤                     │
│  │                                 │                     │
│  │   MAIN CONVERSATION             │   SIDE PANEL        │
│  │   ┌──────────────────────┐     │   ┌──────────────┐  │
│  │   │ Messages             │     │   │ Drafts       │  │
│  │   │ - Text               │     │   │ History      │  │
│  │   │ - Charts/Graphs      │     │   │ Alerts       │  │
│  │   │ - Action Cards       │     │   │ Briefings    │  │
│  │   │ - Tables             │     │   │ Settings     │  │
│  │   └──────────────────────┘     │   └──────────────┘  │
│  │   ┌──────────────────────┐     │                     │
│  │   │ Text Input + Voice   │     │                     │
│  │   │ + Quick Chips        │     │                     │
│  │   └──────────────────────┘     │                     │
│  └────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────┘
```

### 2.1 Three Modes

| Mode | What It Does | Replaces | Key Capability |
|------|-------------|----------|---------------|
| **Chat** | Ask any business question — sales, profit, staff, inventory, expenses | AI Analytics + AI Business Query | Text Q&A + charts/tables + voice reply |
| **Actions** | Give a business command — "Create purchase of 10 Pepsi from XYZ" | AI Assistant (upgraded) | LLM-powered command parsing + action execution + WhatsApp sending |
| **Voice** | Hands-free voice interface across Chat and Actions | AI Voice Operator | Speech input/output + auto-send + intent routing |

---

## 3. Component Tree

```
ai-assistant/
├── page.tsx                    ← Single page (replaces 4 sections)
├── components/
│   ├── AiLayout.tsx             ← Layout wrapper (tabs, side panel, state)
│   ├── conversation/
│   │   ├── ConversationPanel.tsx ← Scrollable message list
│   │   ├── MessageBubble.tsx     ← Single message (text/chart/card/table)
│   │   ├── MessageInput.tsx      ← Text input + voice button + send
│   │   ├── QuickChips.tsx        ← Suggested questions/chips
│   │   └── ActionCard.tsx        ← Draft preview with execute/cancel
│   ├── chat/
│   │   ├── ChatMode.tsx          ← Chat mode wrapper
│   │   ├── ChartMessage.tsx      ← Renders chart from AI response
│   │   └── DataTable.tsx         ← Renders structured table data
│   ├── actions/
│   │   ├── ActionsMode.tsx       ← Actions mode wrapper
│   │   ├── DraftList.tsx         ← List of existing drafts
│   │   ├── DraftCard.tsx         ← Single draft (status, fields, execute)
│   │   └── ManualFieldsForm.tsx  ← Manual field override form
│   ├── voice/
│   │   ├── VoiceMode.tsx         ← Voice mode wrapper
│   │   ├── SpeechRecognition.tsx ← Web Speech API handler
│   │   ├── SpeechSynthesis.tsx   ← TTS handler
│   │   ├── HandsFreeControls.tsx ← Auto-send timer, countdown
│   │   └── VoiceVisualizer.tsx   ← Audio visualization
│   ├── sidepanel/
│   │   ├── SidePanel.tsx         ← Right panel container
│   │   ├── DraftHistory.tsx      ← Drafts list (Actions mode)
│   │   ├── QueryHistory.tsx      ← Query log (Chat mode)
│   │   ├── AlertsPanel.tsx       ← Alerts + briefings
│   │   └── SettingsPanel.tsx     ← Language, voice, model settings
│   └── shared/
│       ├── LanguageSelector.tsx  ← Language dropdown
│       ├── DateRangeSelector.tsx ← Date range chips
│       └── StatusMessage.tsx     ← Success/error banner
├── hooks/
│   ├── useConversation.ts       ← Conversation state machine
│   ├── useSpeechRecognition.ts  ← Voice input hook
│   ├── useSpeechSynthesis.ts    ← TTS output hook
│   ├── useAutoSend.ts           ← Hands-free timer hook
│   └── useAiDrafts.ts           ← Draft CRUD hook
├── lib/
│   ├── intent-detector.ts       ← LLM intent classification
│   ├── command-parser.ts        ← LLM command → structured action
│   ├── context-builder.ts       ← Unified business context builder
│   ├── message-router.ts        ← Routes messages to handlers
│   └── whatsapp/
│       ├── client.ts            ← WhatsApp Cloud API client
│       ├── webhook.ts           ← Incoming message webhook handler
│       └── message-builder.ts   ← Template message builder
└── types.ts                     ← AI Assistant types
```

---

## 4. State Machine

Adapted from the unused `conversation-engine.ts`:

```
IDLE → WAITING_FOR_INPUT
         ↓
    INTENT_DETECTED (LLM classifies)
         ↓
  ┌──────┼────────────────┐
  │      │                │
 CHAT  ACTION           UNKNOWN
  │      │                │
  ▼      ▼                ▼
ASKING  COLLECTING      CLARIFY
 LLM    FIELDS          (ask user)
  │      │                │
  ▼      ▼                └──→ back to WAITING_FOR_INPUT
SHOWING READY_TO_
RESULT  EXECUTE
         ↓
     CONFIRMING
      ↙        ↘
  EXECUTING   CANCELLED
     ↓
  COMPLETED
```

| State | Description |
|-------|-------------|
| `IDLE` | Initial, waiting for first input |
| `WAITING_FOR_INPUT` | User can type or speak |
| `INTENT_DETECTED` | LLM classified input type |
| `ASKING_LLM` | Waiting for AI API response (Chat mode) |
| `COLLECTING_FIELDS` | Asking follow-up questions (Actions mode) |
| `READY_TO_EXECUTE` | All fields collected, waiting for confirmation |
| `CONFIRMING` | Waiting for yes/no |
| `EXECUTING` | Creating the record (purchase/sale/expense/task/WhatsApp) |
| `COMPLETED` | Done, result displayed |

---

## 5. Data Flow

```
User Input (text or voice)
       │
       ▼
┌──────────────────┐
│  Intent Detector │── LLM classifies → chat_query / action_command / unknown
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Message Router  │── Routes to correct handler
└──────┬───────────┘
       │
  ┌────┴────┐
  │         │
  ▼         ▼
CHAT       ACTION
  │         │
  │  ┌──────────────┐
  │  │ Command      │── LLM extracts entities: customer, product, quantity, price
  │  │ Parser       │
  │  └──────┬───────┘
  │         │
  │         ▼
  │  ┌──────────────┐
  │  │ Field        │── Loop: ask for missing fields, user responds
  │  │ Collector    │
  │  └──────┬───────┘
  │         │
  │         ▼
  │  ┌──────────────┐
  │  │ Confirmation │── "Create this purchase? Yes/No"
  │  └──────┬───────┘
  │         │
  │         ▼
  │  ┌──────────────┐
  │  │ Executor     │── Insert into Supabase, create audit log
  │  └──────────────┘
  │
  ▼
Response (text / chart / action card / table)
       │
       ▼
Conversation Panel displays + optionally speaks
```

---

## 6. LLM-Powered Command Parsing (Key Upgrade)

### Current (Regex):
```typescript
// Fragile, misses varied phrasing
if (command.includes("purchase") || command.includes("buy")) {
  actionType = "create_purchase_draft";
}
const match = command.match(/(\d+)\s*(cartons|pieces|units|kg)/);
```

### New (LLM):
```typescript
async function parseCommand(input: string, context: AiContext): Promise<ParsedAction> {
  // Call provider-router with structured extraction prompt
  // Returns: { action_type, entities, fields }
}
```

The provider router already supports 5 AI providers: **Gemini, OpenAI, Groq, xAI, ZAI**. For command parsing we use the fastest available (Groq/Llama or Gemini Flash) with low latency.

---

## 7. API Routes

| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/ai-business-query` | POST | Chat Q&A | Exists — enhance with streaming + chart data |
| `/api/ai-command-parse` | POST | LLM intent + command parsing | New |
| `/api/ai-voice-webhook` | POST | Voice provider webhook | New |
| `/api/whatsapp/webhook` | POST | WhatsApp Cloud API incoming | New |
| `/api/whatsapp/send` | POST | Send WhatsApp message | New |

---

## 8. WhatsApp Integration

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  User types   │     │  AI          │     │  WhatsApp    │
│  in AI Chat   │────>│  Assistant   │────>│  Cloud API   │
│  "Send msg    │     │  generates   │     │  sends msg   │
│   to Ali"     │     │  content     │     │  to contact  │
└──────────────┘     └──────────────┘     └──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Webhook     │
                    │  receives    │
                    │  replies     │
                    └──────────────┘
```

### Flow:
1. User says "Send message to Supplier XYZ that payment is due tomorrow"
2. AI Assistant detects intent → `send_whatsapp`
3. System finds Supplier XYZ's phone number
4. AI generates message content
5. Shows preview: "Send this message to Supplier XYZ?"
6. User confirms
7. System calls WhatsApp Cloud API
8. Replies come via webhook → displayed in conversation

### Requirements:
- Meta Business Account (free)
- WhatsApp Business Account (free)
- Phone number verified with WhatsApp Business API
- `WHATSAPP_API_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` in env

---

## 9. Voice System Upgrade Path

| Phase | Solution | Quality | Cost | Status |
|-------|----------|---------|------|--------|
| Now (P4) | Web Speech API | Basic, browser-dependent | Free | Already works |
| Later (P8) | Deepgram STT + ElevenLabs TTS | High quality, multi-language | Paid per-usage | Needs API keys |

The voice system uses the same provider-router pattern:
```typescript
interface VoiceProvider {
  transcribe(audio: Blob, language: string): Promise<string>;
  synthesize(text: string, language: string, voice?: string): Promise<ArrayBuffer>;
}
```

---

## 10. New Database Schema

```sql
create table ai_conversations (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid not null references organizations(id),
  profile_id uuid references profiles(id),
  mode text not null check (mode in ('chat', 'action')),
  title text,
  status text not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table ai_conversation_messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  message_type text not null check (message_type in ('text', 'chart', 'action_draft', 'action_executed', 'alert', 'briefing', 'whatsapp')),
  content jsonb not null,
  related_draft_id uuid references ai_action_drafts(id),
  related_query_log_id uuid references ai_business_query_logs(id),
  metadata jsonb,
  created_at timestamptz default now()
);
```

This replaces the current three tables (`ai_action_messages`, `ai_voice_operator_messages`, `ai_business_query_logs`) with one unified message store.

---

## 11. What Gets Deleted

Once the unified page replaces the four existing ones:

| Code | Lines | Reason |
|------|-------|--------|
| AI Analytics JSX in page.tsx | ~170 | Merged into Chat |
| AI Business Query JSX in page.tsx | ~300 | Merged into Chat |
| AI Voice Operator JSX in page.tsx | ~670 | Merged into Voice tab |
| AI Assistant JSX in page.tsx | ~730 | Merged into Actions tab |
| 40+ AI state variables | ~50 lines | Replaced by hooks |
| 15+ AI handler functions | ~1,000+ lines | Replaced by lib modules |
| `buildAnalyticsContext()` | ~120 lines | Replaced by unified context-builder |
| **Total removed** | **~3,040 lines** | |

---

## 12. Implementation Phases

| Phase | Name | What It Does | Effort | AI Key Needed? |
|-------|------|-------------|--------|---------------|
| **P1** | Page Shell | Create `ai-assistant/` with folder structure, 3-tab layout, side panel shell. No functionality yet. | 2 days | No |
| **P2** | Chat Mode | Merge AI Analytics + AI Business Query into one Chat tab. Unify context builder. | 1 day | Yes (for testing) |
| **P3** | LLM Command Parser | Replace regex command parsing with LLM call. Intent detection + entity extraction. | 3 days | Yes |
| **P4** | Voice Mode | Refactor SpeechRecognition + SpeechSynthesis into reusable hooks. Hands-free controls. | 2 days | No |
| **P5** | Side Panel | Draft history, query history, alerts, briefings, settings panels. | 2 days | No |
| **P6** | State Machine | Adapt `conversation-engine.ts` as the central state machine for all modes. | 2 days | No |
| **P7** | WhatsApp | Cloud API client, webhook handler, message builder, AI integration. | 5 days | No (Meta setup) |
| **P8** | Premium Voice | Deepgram STT + ElevenLabs TTS provider integration. | 3 days | No (API keys) |
| **P9** | Streaming + Charts | SSE streaming for AI responses. Chart/table rendering from AI data. | 3 days | Yes |
| **P10** | Polish | Edge cases, loading states, error recovery, mobile responsiveness. | 3 days | No |

**Total: ~26 days**

### Dependencies:
```
P1 ──→ P2 ──→ P3 ──→ P6 ──→ P7
 │               │            │
 ├──→ P4 ────────┼────────────┘
 ├──→ P5 ←───────┘
 └──→ P9 ────────┘
                  └──→ P10
```

---

## 13. Configuration (.env additions)

```bash
# --- Required for AI ---
# Pick one provider:
GEMINI_API_KEY=           # https://aistudio.google.com/app/apikey
# OPENAI_API_KEY=         # https://platform.openai.com/api-keys
# GROQ_API_KEY=           # https://console.groq.com/keys

AI_PROVIDER_ORDER=gemini  # comma-separated: "gemini,openai,groq"

# --- Optional: WhatsApp ---
WHATSAPP_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# --- Optional: Premium Voice ---
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=
```

---

## 14. Summary

| Metric | Current State | After Build |
|--------|--------------|-------------|
| AI pages | 4 separate | 1 unified page |
| Total AI code | ~3,040 lines (scattered) | ~2,000 lines (modular) |
| State variables | 40+ in page.tsx | 0 in page.tsx |
| AI Assistant parser | Regex (fragile) | LLM (robust) |
| Charts/graphs | Not available | AI generates structured data → chart rendering |
| Voice | Web Speech only | Web Speech + premium provider support |
| WhatsApp | Not available | Full send/receive integration |
| Staff tracking | Not queryable via AI | AI can answer "Where is my staff?" |
| Maintainability | Low (monolithic) | High (separate files, hooks, lib) |
