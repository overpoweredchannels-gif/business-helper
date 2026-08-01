# TradeOS AI Master Architecture

> **Version**: 1.0  
> **Status**: Architecture Specification  
> **Applies to**: TradeOS — AI Business Operating System for Wholesalers, Distributors, Retailers & Shop Owners  
> **Region Focus**: Pakistan (Urdu / English / Roman Urdu)  
> **Core Principle**: One AI. One Assistant. One Business Partner.

---

## 1. Vision

### Purpose
Define the long-term north star for TradeOS AI — what we are building and why.

### Statement
TradeOS AI is not a chatbot attached to an ERP. It is an **AI Business Operating System** — a digital business partner that lives inside the owner's business. It understands inventory, sales, purchases, customers, suppliers, expenses, staff, market conditions, and Pakistani business workflows as deeply as the owner does.

The AI's role is to:
- **Know** the business completely
- **Monitor** everything continuously
- **Explain** what is happening and why
- **Recommend** what to do next
- **Execute** tasks safely after owner confirmation
- **Learn** the owner's preferences over time
- **Communicate** in English, Urdu, Roman Urdu, and eventually voice
- **Integrate** with WhatsApp, voice calls, and future MCP tools

The owner should never feel like they are using a computer system. They should feel like they have a highly capable, trusted, 24/7 business manager who never forgets anything.

### Responsibilities
- Be the single entry point for all owner-AI interaction
- Replace the existing four AI pages with one unified assistant
- Maintain a persistent, evolving understanding of the business
- Never allow direct, unconfirmed execution of business operations
- Scale from a single shop to a multi-branch enterprise

### Inputs
- Owner text messages (English / Urdu / Roman Urdu)
- Owner voice commands (via Web Speech API and premium providers)
- WhatsApp messages from owner and contacts
- System-generated triggers (low stock alerts, daily briefings, anomaly detection)

### Outputs
- Natural language answers
- Structured data (tables, charts, summaries)
- Confirmation requests before execution
- Audit logs and execution receipts
- Proactive notifications and recommendations

### Future Expansion
- Multi-owner collaboration (family business)
- Multi-branch business awareness
- Integration with external APIs (banks, couriers, tax authorities)
- Custom skill marketplace

### Dependencies
- Existing TradeOS data model (products, customers, suppliers, transactions, staff)
- AI provider router (Gemini / OpenAI / Groq / xAI / ZAI)
- Web Speech API (initial), Deepgram/ElevenLabs (future)
- WhatsApp Cloud API
- Supabase (persistence, real-time)

---

## 2. AI Philosophy

### Purpose
Establish the core principles that guide every design decision.

### Principles

**One Assistant, Not Modes**
The owner never selects "Chat Mode" or "Action Mode." The assistant itself determines what capability is needed for each input. A question gets an answer. A command goes through the execution pipeline. A voice input is transcribed, understood, and handled. The interface is unified — one conversation, one assistant.

**Safety First, Always**
The AI can read anything but writes nothing without owner confirmation. Every business operation (creating a sale, adding a purchase, sending a WhatsApp message) follows the seven-step execution pipeline: Understand → Plan → Validate → Confirm → Execute → Audit → Learn. No shortcuts.

**Local-First, Cloud-Augmented**
The AI must work when the internet is slow or unavailable. Core logic (command detection, entity matching, field validation) runs locally. Heavy AI tasks (complex analysis, forecasting) use cloud AI providers. The system degrades gracefully.

**Business Context Is Everything**
Every AI response is grounded in the actual data of the owner's business. The AI does not guess — it cites what it knows. When data is insufficient, it says so and asks for clarification.

**Proactive, Not Just Reactive**
The AI does not wait for questions. It monitors business health, detects anomalies, generates daily briefings, and alerts the owner to issues before they become crises.

**Learning Without Leaking**
The AI learns owner preferences (favorite suppliers, payment terms, pricing strategies) but never shares business data across organizations. Each business is an isolated tenant.

**Urdu / English / Roman Urdu Native**
The assistant understands and responds in all three without the owner switching modes. Language detection is automatic.

### Responsibilities
- Ensure all AI features adhere to these principles
- Guide the development roadmap prioritization
- Provide decision criteria when trade-offs arise

### Inputs
- Owner feedback (implicit: accepted/rejected recommendations; explicit: "stop suggesting that supplier")

### Outputs
- Consistent, predictable AI behavior
- Owner trust through transparency and safety

### Future Expansion
- Owner personality model (formal vs. casual communication preference)
- Learning from other similar businesses (anonymized, aggregated insights)

### Dependencies
- None — this is a guiding document

---

## 3. Business Knowledge Model

### Purpose
Define how the AI understands, structures, and references the owner's business.

### The Business Ontology

```
Organization
├── Products (name, brand, category, price, stock, reorder level)
│   ├── Inventory (current stock, purchase history, sales velocity)
│   └── Reorder Status (out_of_stock, urgent, low_soon, healthy)
├── Customers (name, shop, balance, credit limit, payment history)
│   └── Transactions (sales, payments, credit, returns)
├── Suppliers (name, contact, payment terms, lead time)
│   └── Transactions (purchases, payments, returns)
├── Sales (invoices, items, totals, profit, payment type)
│   └── Trends (daily, weekly, monthly, by product/customer/staff)
├── Purchases (invoices, items, totals, supplier)
├── Expenses (type, amount, date, linked to sale/purchase)
├── Staff (profiles, roles, permissions, duty sessions, locations)
├── Accounting
│   ├── Profit & Loss (revenue, COGS, expenses, net profit)
│   ├── Receivables (customer balances, aging, overdue)
│   ├── Payables (supplier balances, due dates)
│   └── Cash Flow (incoming, outgoing, net position)
├── Tasks (pending, in_progress, completed, by type/priority)
├── Market Intelligence (news, analyses, signals, import queue)
├── AI Artifacts
│   ├── Alerts (active, resolved, by severity/type)
│   ├── Briefings (daily summaries, signals, recommendations)
│   ├── Drafts (pending actions, conversation history)
│   └── Query Logs (past questions and answers)
└── Business Settings (tax rates, currency, language preferences)
```

### Context Assembly
When the AI needs to answer a question or process a command, it assembles a **context package** from the ontology. The context is scoped to the specific need:

- A sales question → sales overview + recent invoices + top customers + product performance
- A purchase command → suppliers list + products + current stock + pending purchases
- A staff query → active duty sessions + last known locations + staff profiles

The context is trimmed to fit within the AI provider's token window. Critical data is always included; supplementary data is included when relevant.

### Responsibilities
- Provide the single source of truth for all AI data lookups
- Ensure consistent entity naming across all AI interactions
- Enable the AI to answer questions about any part of the business

### Inputs
- All TradeOS database tables and computed analytics
- Real-time stock levels and transaction data

### Outputs
- Structured JSON context packages for AI API calls
- Entity resolution (matching "Pepsi" to the correct product ID)

### Future Expansion
- Product images and descriptions for visual recognition
- Supplier reliability scores based on historical performance
- Customer lifetime value and segmentation
- Seasonal patterns learned from historical data

### Dependencies
- TradeOS database schema (Supabase)
- Business Intelligence analytics engine
- Reorder recommendation engine

---

## 4. AI Internal Architecture

### Purpose
Define the internal structure of the AI Assistant — the components that work together to process every input.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     OWNER INTERFACE                          │
│           (Text / Voice / WhatsApp / Future MCP)             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                              │
│  - Receives input                                          │
│  - Determines top-level intent                              │
│  - Routes to the correct internal agent                     │
│  - Manages conversation state                               │
└──────────┬──────────┬──────────┬──────────┬────────────────┘
           │          │          │          │
           ▼          ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ BUSINESS │ │ ACTION   │ │ ANALYST │ │ COMMS   │
│ KNOWLEDGE│ │ AGENT    │ │ AGENT   │ │ AGENT   │
│ AGENT    │ │          │ │         │ │         │
├──────────┤ ├──────────┤ ├─────────┤ ├─────────┤
│ Answer   │ │ Parse    │ │ Analyze │ │ WhatsApp│
│ questions│ │ commands │ │ data    │ │ Voice   │
│ Explain  │ │ Collect  │ │ Forecast│ │ MCP     │
│ data     │ │ fields   │ │ Recommend│ │         │
└──────────┘ └──────────┘ └─────────┘ └─────────┘
                │
                ▼
         ┌─────────────────────────────────────────────┐
         │              PLANNER                          │
         │  Decomposes action into steps                │
         └──────────────────┬──────────────────────────┘
                            │
                            ▼
         ┌─────────────────────────────────────────────┐
         │              VALIDATOR                        │
         │  Checks permissions, data integrity, safety  │
         └──────────────────┬──────────────────────────┘
                            │
                            ▼
         ┌─────────────────────────────────────────────┐
         │              EXECUTOR                         │
         │  Creates records, sends messages, triggers   │
         └──────────────────┬──────────────────────────┘
                            │
                            ▼
         ┌─────────────────────────────────────────────┐
         │              AUDITOR                          │
         │  Logs everything, learns from outcome        │
         └─────────────────────────────────────────────┘
```

### Components

| Component | Role | 
|-----------|------|
| **Orchestrator** | Receives input, classifies intent, routes to agent, manages state |
| **Business Knowledge Agent** | Answers factual questions about the business |
| **Action Agent** | Processes commands that change business state |
| **Analyst Agent** | Analyzes trends, generates forecasts, produces recommendations |
| **Comms Agent** | Handles WhatsApp messaging, voice I/O, future MCP integrations |
| **Planner** | Decomposes high-level commands into executable steps |
| **Validator** | Checks safety, permissions, data integrity before execution |
| **Executor** | Performs the actual database operations or external API calls |
| **Auditor** | Logs every action, updates business memory, learns preferences |

### Responsibilities
- Process every owner input through the correct pipeline
- Maintain conversation state across turns
- Ensure no action is executed without validation and confirmation

### Inputs
- Owner message (text or transcribed speech)
- Current conversation state
- Business context (assembled from Business Knowledge Model)

### Outputs
- Response message (text, structured data, chart, action card)
- State transition
- Audit log entry (for actions)

### Future Expansion
- Multi-modal input (images of products, screenshots of invoices)
- Parallel agent collaboration for complex tasks
- Agent self-reflection and improvement

### Dependencies
- AI provider router
- Business Knowledge Model
- Conversation Memory

---

## 5. Internal AI Agents

### Purpose
Define the specialized sub-agents that handle different categories of owner input.

---

### 5.1 Orchestrator

**Purpose**: The entry point for all owner input. Classifies intent and routes to the correct agent.

**Responsibilities**:
- Receive all owner messages
- Classify intent using LLM (not regex) into one of: `business_question`, `action_command`, `analysis_request`, `communication_task`, `system_control`, or `clarification`
- Route to the correct internal agent
- Maintain and transition conversation state
- Handle errors and ambiguous input gracefully

**Inputs**: Owner message text, conversation history, current state

**Outputs**: Routed message with intent classification, confidence score

**Future Expansion**: Multi-intent detection (one message containing both a question and a command)

**Dependencies**: AI provider router, Conversation Memory

---

### 5.2 Business Knowledge Agent

**Purpose**: Answers factual questions about the business. Reports what is true.

**Responsibilities**:
- Answer questions about any part of the business ontology
- Assemble relevant context from the Business Knowledge Model
- Generate responses with citations (specific numbers, dates, records)
- Admit when data is insufficient
- Support follow-up questions within the same analytical context
- Generate chart data when visualization is helpful

**Inputs**: Question text, requested data scope, current business context

**Outputs**: Answer text, optional chart data, optional table data, source references

**Future Expansion**: Comparative analysis ("How does this month compare to last year?"), root cause analysis

**Dependencies**: Business Knowledge Model, AI provider router

---

### 5.3 Action Agent

**Purpose**: Processes commands that change business state. Creates, updates, or triggers business operations.

**Responsibilities**:
- Parse business commands into structured actions using LLM
- Extract entities (products, customers, suppliers, quantities, prices)
- Identify missing required fields
- Engage in conversation to collect missing information
- Present draft action for owner confirmation
- On confirmation, pass to Planner for execution
- Handle cancellation gracefully

**Supported Action Types**:
- `create_sale` — Generate a sales invoice
- `create_purchase` — Generate a purchase order
- `create_expense` — Record an expense
- `create_task` — Create a task
- `create_customer` — Add a new customer
- `create_supplier` — Add a new supplier
- `create_product` — Add a new product
- `send_whatsapp` — Send a WhatsApp message
- `update_record` — Update an existing record (limited, validated fields)
- `cancel_transaction` — Cancel/void a transaction (with audit trail)

**Inputs**: Command text, business context (products, customers, suppliers), existing draft state (if continuing conversation)

**Outputs**: Structured parsed action, list of missing fields, draft summary for confirmation

**Future Expansion**: Bulk operations ("Add these 5 products"), conditional commands ("If stock of X is low, order Y")

**Dependencies**: Business Knowledge Model, AI provider router (for parsing), Planner

---

### 5.4 Analyst Agent

**Purpose**: Analyzes data, identifies patterns, generates forecasts and recommendations.

**Responsibilities**:
- Analyze trends in sales, profit, expenses, inventory over time
- Generate business health assessments
- Produce prioritized recommendations
- Forecast future outcomes based on historical patterns
- Identify anomalies and potential issues
- Generate daily briefings automatically
- Explain analytical reasoning transparently

**Inputs**: Historical business data, time range, specific analytical question (optional)

**Outputs**: Analysis text, forecast data, recommendation list, chart data, confidence levels

**Future Expansion**: What-if simulation ("What if I increase the price of product X by 10%?"), anomaly detection triggers

**Dependencies**: Business Knowledge Model, Business Intelligence analytics engine, AI provider router

---

### 5.5 Comms Agent

**Purpose**: Handles all external communication — WhatsApp messages, voice I/O, and future MCP tool calls.

**Responsibilities**:
- Compose and send WhatsApp messages via Cloud API
- Process incoming WhatsApp messages and route to Orchestrator
- Manage voice session lifecycle (start, listen, process, respond, speak)
- Select appropriate voice provider (Web Speech / Deepgram / ElevenLabs)
- Handle message delivery status and errors
- Queue outgoing messages for reliable delivery

**Inputs**: Message content, recipient (customer, supplier, or phone number), voice audio, language preference

**Outputs**: Sent message confirmation, delivery status, transcribed text, synthesized speech

**Future Expansion**: Email integration, SMS gateway, WhatsApp broadcast lists, scheduled messages

**Dependencies**: WhatsApp Cloud API, Voice provider router, AI provider router (for message drafting)

---

## 6. Business Memory

### Purpose
Define how the AI learns, stores, and retrieves information across sessions to become more useful over time.

### Memory Types

**Short-Term Memory (Conversation Context)**
- Duration: Single conversation session
- Storage: In-memory state + `ai_conversations` / `ai_conversation_messages` tables
- Content: Current intent, collected fields, recent messages, active draft
- Eviction: Session ends or times out after 30 minutes of inactivity

**Medium-Term Memory (Owner Preferences)**
- Duration: Persistent across sessions
- Storage: `ai_owner_preferences` table (key-value, scoped to organization)
- Content: Preferred suppliers, payment terms, discount habits, communication style, common product bundles, frequently used report formats
- Learning: Implicit (AI observes patterns in confirmed actions) and explicit (owner states preference directly)
- Retrieval: Automatically included in context when relevant to current input

**Long-Term Memory (Business Knowledge Graph)**
- Duration: Permanent
- Storage: Business ontology (continuously updated from database) + `ai_business_memory` table (insights, patterns, anomalies)
- Content: Entity relationships, historical patterns, seasonal trends, past decisions and outcomes, learned business rules
- Learning: Analyst Agent periodically generates insights and stores them
- Retrieval: Included in context during relevant queries

**Episodic Memory (Past Interactions)**
- Duration: Persistent (configurable retention)
- Storage: `ai_conversation_messages` table with full history
- Content: Every past question, answer, draft, execution, and outcome
- Retrieval: Semantic search across past conversations when current input references a past event ("Remember that purchase I made last week?")

### Responsibilities
- Provide relevant context to every AI request
- Learn owner preferences without explicit programming
- Enable the AI to reference past conversations naturally
- Evict or archive old data to manage storage and token costs

### Inputs
- Conversation messages
- Owner actions (confirmed/cancelled/executed)
- System-generated insights

### Outputs
- Context packages for AI API calls
- Preference data for action default values
- Past conversation references

### Future Expansion
- Vector embeddings for semantic memory search
- Automatic memory consolidation (summarizing old conversations into insights)
- Cross-session learning without data leakage

### Dependencies
- Supabase (storage)
- AI provider router (for generating embeddings and summaries)

---

## 7. Planner

### Purpose
Decompose high-level actions into safe, executable steps that can be validated individually.

### How It Works
When the Action Agent produces a structured action (e.g., "create_sale for customer X with product Y"), the Planner decomposes it into ordered steps:

```
Command: "Create a sale of 5 cartons Pepsi to Usman General Store for cash"

Planner output:
1. ✅ Verify customer "Usman General Store" exists → found (id: abc-123)
2. ✅ Verify product "Pepsi" exists → found (id: xyz-789)
3. ✅ Verify stock ≥ 5 cartons → current stock: 12 ✓
4. ⚠️ Price not specified → need to ask owner or use default
5. ✅ Payment type: cash
6. 📋 Draft: Sale of 5 × Pepsi @ Rs. X,XXX to Usman General Store
```

Each step is marked as:
- ✅ **Ready** — data available, no action needed
- ⚠️ **Needs Input** — missing field, must ask owner
- ❌ **Blocked** — cannot proceed (e.g., insufficient stock)

The Planner presents a complete picture: what is ready, what is missing, and what the final result will look like.

### Responsibilities
- Break every action into granular, verifiable steps
- Pre-check all conditions before presenting to Validator
- Clearly separate what is known from what needs owner input
- Estimate the final result (draft invoice total, etc.)

### Inputs
- Structured action from Action Agent (action type + parsed fields)
- Current business context (product prices, stock levels, customer credit)

### Outputs
- Ordered list of steps with status (ready/needs-input/blocked)
- Draft summary (what the final result will look like)
- List of questions to ask the owner

### Future Expansion
- Multi-step workflows (e.g., "Record the expense and create a task to follow up")
- Conditional planning ("If stock is low, include a reorder step")

### Dependencies
- Business Knowledge Model (for entity resolution and validation)
- Product inventory data
- Customer/supplier credit data

---

## 8. Validator

### Purpose
Ensure every action is safe, permitted, and data-integrity-checked before it reaches the owner for confirmation.

### Validation Checks

**Permission Check**
- Does the owner have permission to perform this action? (Always yes for owner)
- Does the action involve a section the owner has access to?
- Future: If staff use the AI, check staff permissions

**Data Integrity Check**
- Do all referenced entities exist? (Customer, product, supplier IDs)
- Are all required fields populated?
- Are numeric values reasonable? (Price > 0, quantity > 0)
- Are dates valid and in correct order?

**Business Logic Check**
- Is there sufficient stock for this sale?
- Is the customer within their credit limit? (For credit sales)
- Does the purchase price make sense? (Not wildly different from last purchase)
- Are there duplicate pending drafts for the same action?

**Safety Check**
- Does this action delete data? (Never allowed unless explicitly confirmed with warning)
- Does this action modify prices or rates? (Flagged for extra confirmation)
- Does this action affect multiple records? (Batch operations require extra scrutiny)

### Responsibilities
- Catch errors before they reach the database
- Prevent data corruption from malformed actions
- Flag potentially dangerous operations for extra confirmation
- Provide clear error messages when validation fails

### Inputs
- Planned steps from Planner
- Current business data for cross-referencing

### Outputs
- Validation result: ✅ Pass / ⚠️ Warning / ❌ Failed
- List of warnings (non-blocking but important)
- List of errors (blocking — must fix before proceeding)

### Future Expansion
- Machine learning validation (flag transactions that look unusual for this business)
- Regulatory compliance checks (FBR invoicing rules)

### Dependencies
- Business Knowledge Model (entity lookup, data queries)
- Permission Model

---

## 9. Executor

### Purpose
The only component that writes to the database or calls external APIs. It is the gatekeeper of all state-changing operations.

### How It Works
1. Receives a fully validated, owner-confirmed action
2. Performs the operation in a transaction (all-or-nothing)
3. Records the result (success with entity IDs, or failure with error details)
4. Updates the audit log
5. Refreshes relevant data in the Business Knowledge Model
6. Returns success/failure to the conversation

### Supported Operations
- `expenses` → Insert expense record
- `tasks` → Insert task record
- `purchase_transactions` + `purchase_items` → Insert purchase with line items
- `sales_transactions` + `sales_items` → Insert sale with line items
- `products` → Insert new product
- `customers` → Insert new customer
- `suppliers` → Insert new supplier
- `ai_action_drafts` → Update draft status to "executed" with entity reference
- `audit_logs` → Log every executed action
- `ai_owner_preferences` → Update learned preferences
- WhatsApp API → Send message via Cloud API

### Responsibilities
- Execute confirmed actions atomically
- Never execute without Validator approval and owner confirmation
- Provide clear success/failure responses
- Generate execution receipts (invoice numbers, transaction IDs)

### Inputs
- Validated action from Validator
- Owner confirmation signal

### Outputs
- Execution result: success (with created entity IDs) or failure (with error details)
- Updated business context (refreshed after execution)

### Future Expansion
- Idempotency (prevent duplicate execution if confirmation is sent twice)
- Scheduled/delayed execution ("Execute this tomorrow at 9 AM")
- Rollback capability for certain action types

### Dependencies
- Supabase client
- WhatsApp Cloud API client
- AI provider router (for generating invoice numbers, etc.)

---

## 10. Auditor

### Purpose
Record every AI action, learn from outcomes, and continuously improve the assistant.

### What Is Audited
- Every owner message received
- Every AI response generated
- Every draft created, modified, confirmed, or cancelled
- Every execution attempt (success and failure)
- Every validation warning or error
- Every preference learned
- Every external API call (WhatsApp, voice)

### Audit Storage
- `audit_logs` table (existing — extended with AI-specific action types)
- `ai_action_drafts` table (existing — status tracking)
- `ai_conversation_messages` table (full conversation history)

### Learning From Audit
The Auditor runs periodic analysis:
- Which action types are most common? → Optimize those paths
- Which commands fail validation most often? → Improve user guidance
- Which drafts are cancelled most? → Understand owner hesitation
- Which responses get positive feedback? → Reinforce those patterns

### Responsibilities
- Record every action with sufficient detail for reconstruction
- Enable post-hoc analysis of any AI decision
- Feed learning data back into the system
- Never allow audit logs to be deleted (appending only)

### Inputs
- All messages, actions, and system events

### Outputs
- Immutable audit records
- Periodic learning summaries for memory update

### Future Expansion
- Anomaly detection in owner behavior (potential account compromise)
- Audit dashboard for the owner (review all AI actions)
- Compliance exports for tax/regulatory purposes

### Dependencies
- Supabase (audit_logs table)
- Business Memory (for storing learned patterns)

---

## 11. Business Intelligence

### Purpose
Provide analytical intelligence — not just data retrieval, but meaningful insight, forecasting, and recommendation.

### Capabilities

**Business Health Assessment**
- Score (0–100) based on multiple metrics
- Label: Excellent / Good / Average / Needs Attention / Critical
- Reasons explaining the score
- Trend direction (improving, declining, stable)

**Forecasting**
- Sales forecast (next 7/30 days based on historical patterns)
- Inventory depletion forecast (when will stock run out at current velocity)
- Cash flow forecast (expected incoming/outgoing)
- Confidence levels for each forecast

**Recommendation Engine**
- Reorder recommendations (what to order, quantity, from which supplier)
- Pricing recommendations (products that could be priced higher)
- Customer follow-up recommendations (overdue accounts)
- Expense reduction opportunities (categories with unusual spending)
- Staff scheduling recommendations (busy periods understaffed)

**Anomaly Detection**
- Unusual sales dips or spikes
- Unexpected expense categories
- Customer payment pattern changes
- Supplier delivery delays
- Staff location anomalies

**Report Generation**
- Daily briefing (automatic, every morning)
- Weekly performance summary
- Monthly P&L explanation
- Custom report on any topic ("Show me my top 10 customers this year")

### Responsibilities
- Provide proactive intelligence without waiting for questions
- Generate daily briefings automatically
- Surface issues before they become critical
- Explain every recommendation with reasoning and data

### Inputs
- Full business data (sales, purchases, inventory, expenses, staff, market)
- Historical patterns
- Owner preferences and goals

### Outputs
- Health score with explanation
- Forecasts with confidence levels
- Prioritized recommendations
- Anomaly alerts
- Structured reports

### Future Expansion
- Market trend integration (commodity prices, inflation, seasonal factors)
- Competitive intelligence (if owner opts in to anonymized data sharing)
- Goal tracking (owner sets targets, AI tracks progress)

### Dependencies
- Business Knowledge Model
- AI provider router (for analysis and forecasting)
- Market Intelligence data (for external factors)

---

## 12. Voice Architecture

### Purpose
Enable natural, real-time voice conversations between the owner and the AI assistant in English, Urdu, and Roman Urdu.

### Architecture

```
┌──────────┐    Speech Audio    ┌──────────────┐    Text    ┌──────────┐
│  Owner   │ ──────────────────> │  STT Provider  │ ────────> │    AI    │
│ (Device) │ <────────────────── │  TTS Provider  │ <──────── │ Assistant│
└──────────┘    Speech Audio    └──────────────┘    Text    └──────────┘
```

### Provider Abstraction

```typescript
interface VoiceProvider {
  transcribe(audio: Blob, language: string): Promise<TranscriptionResult>;
  synthesize(text: string, language: string, voice?: string): Promise<ArrayBuffer>;
}
```

### Provider Tiers

| Tier | STT Provider | TTS Provider | Languages | Latency | Cost |
|------|-------------|-------------|-----------|---------|------|
| 1 (Free) | Web Speech API | Web Speech API | en, ur, pa | Fast | Free |
| 2 (Premium) | Deepgram | ElevenLabs | en, ur, hi, ar | Fast | Per-second |
| 3 (Enterprise) | Custom fine-tuned model | Custom voice model | All + dialect-specific | Optimized | Highest |

### Tier 1 Implementation (Initial)
- Uses browser's `webkitSpeechRecognition` / `SpeechRecognition`
- Language auto-detection from input
- `speechSynthesis` for TTS with voice selection
- Urdu voice selection: prefers `ur-PK`, `pa-PK`, falls back to `en-PK`
- English voice selection: prefers `en-PK`, `en-IN`, falls back to `en-US`
- Works entirely client-side

### Tier 2 Implementation (Future)
- Deepgram Nova-2 for STT (supports Urdu, English, Hinglish)
- ElevenLabs for TTS (natural voices, multi-language)
- Server-side processing via API routes
- WebSocket streaming for lower latency

### Voice Conversation Flow
1. Owner taps voice button → microphone activates
2. Audio streams to STT provider (or browser API)
3. Transcribed text enters the AI Assistant pipeline
4. AI generates response text
5. Response text sent to TTS provider
6. Audio plays back to owner
7. Hands-free: auto-send after silence detection with configurable delay

### Responsibilities
- Transcribe owner speech accurately in supported languages
- Synthesize AI responses naturally in the correct language
- Handle interruptions, background noise, and connectivity issues
- Support hands-free mode for driving or working

### Inputs
- Raw audio (from microphone or voice channel)
- Language hint (optional, auto-detected)

### Outputs
- Transcribed text → AI Assistant
- Synthesized audio → owner's speaker

### Future Expansion
- Two-way voice calling via Twilio/Vonage
- Custom wake word ("Hey TradeOS")
- Speaker identification (distinguish owner from staff)
- Emotion detection in voice

### Dependencies
- Web Speech API (Tier 1)
- Deepgram API key (Tier 2)
- ElevenLabs API key (Tier 2)
- Voice provider router abstraction

---

## 13. WhatsApp Architecture

### Purpose
Extend the AI Assistant to WhatsApp — the owner's primary communication channel in Pakistan — enabling them to interact with their business via messages.

### Architecture

```
┌──────────┐  WhatsApp msg   ┌──────────────┐  Forward   ┌──────────┐
│  Owner   │ ──────────────> │  Meta Cloud   │ ────────> │  Webhook │
│ (Phone)  │ <────────────── │  API          │ <──────── │  Handler │
└──────────┘  WhatsApp msg   └──────────────┘  Response  └────┬─────┘
                                                              │
                                                              ▼
                                                       ┌──────────────┐
                                                       │     AI       │
                                                       │  Assistant   │
                                                       │  (Orchestrator)│
                                                       └──────────────┘
```

### Flow

**Outgoing (AI → WhatsApp)**
1. Owner tells AI: "Send message to Supplier XYZ that payment is due tomorrow"
2. Comms Agent drafts message
3. Shows preview to owner in the conversation
4. Owner confirms
5. Executor calls WhatsApp Cloud API
6. Message sent, delivery status logged

**Incoming (WhatsApp → AI)**
1. Contact sends message to owner's WhatsApp Business number
2. Meta sends webhook to `/api/whatsapp/webhook`
3. Webhook handler parses message (text, image, document)
4. Routes to AI Assistant via Comms Agent
5. AI determines if it should respond, forward to owner, or take action
6. Response sent back via WhatsApp API

### Supported Message Types
- Text messages
- Template messages (pre-approved, high-quality send)
- Media messages (images of products, invoices)
- Interactive messages (quick reply buttons, list menus)

### Contact Resolution
When receiving an incoming WhatsApp message, the system resolves the sender's phone number against the existing customer and supplier database. If matched, the conversation knows which business entity is communicating.

### Responsibilities
- Send notifications, invoices, payment reminders via WhatsApp
- Receive and process incoming WhatsApp messages
- Allow the owner to interact with their business entirely via WhatsApp
- Maintain conversation continuity across WhatsApp and in-app

### Inputs
- Outgoing: Message content + recipient phone number
- Incoming: Webhook payload from Meta

### Outputs
- Outgoing: Message sent to WhatsApp
- Incoming: Message routed to AI Assistant

### Future Expansion
- WhatsApp broadcast to customer lists
- Automated payment reminders via WhatsApp
- Order confirmation via WhatsApp
- Image-based product inquiry ("Send picture of product X")

### Dependencies
- Meta Business Account
- WhatsApp Business Account
- Registered phone number
- `WHATSAPP_API_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`
- Public HTTPS endpoint for webhook (ngrok for development, Vercel URL for production)
- AI provider router (for message drafting and response generation)

---

## 14. Security Model

### Purpose
Ensure every AI operation is secure, auditable, and resistant to misuse.

### Layers

**Layer 1: Authentication**
- Owner must be authenticated via Supabase Auth
- AI Assistant only operates within authenticated sessions
- No anonymous AI access

**Layer 2: Tenant Isolation**
- Every AI request is scoped to the owner's organization_id
- Business context is assembled only from the owner's data
- Cross-tenant data access is impossible by design
- AI memory is per-organization, never shared

**Layer 3: Permission Enforcement**
- AI respects existing TradeOS permissions
- An action is only valid if the owner has permission for the underlying section
- Staff using AI (future) would be subject to their staff permission set
- Permission check happens in the Validator, not the UI

**Layer 4: Execution Guard**
- No database write happens without Validator approval + owner confirmation
- The Executor is the ONLY code path that writes to the database
- Direct database writes from the AI are impossible by architecture
- Every execution is within a Supabase transaction (all-or-nothing)

**Layer 5: Rate Limiting**
- AI API calls are rate-limited per organization
- Action executions are rate-limited (prevent accidental bulk operations)
- WhatsApp messages have rate limits per recipient

**Layer 6: Input Sanitization**
- All owner input is sanitized before sending to AI providers
- AI provider responses are sanitized and validated before display
- SQL injection is impossible (Supabase parameterized queries)
- XSS prevention in displayed AI responses

**Layer 7: Audit Trail**
- Every AI action is logged immutably
- Audit logs cannot be deleted
- Full reconstruction of any AI decision is possible

### Responsibilities
- Prevent unauthorized AI access
- Ensure tenant data isolation
- Enforce business permissions on AI actions
- Prevent direct, unconfirmed database writes
- Provide complete audit trail

### Inputs
- Owner authentication state
- Organization context
- Permission data

### Outputs
- Security gates (pass/fail at each layer)
- Audit log entries

### Future Expansion
- Staff AI access with scoped permissions
- API keys for external integrations
- IP-based access restrictions for WhatsApp webhook

### Dependencies
- Supabase Auth
- TradeOS permission model
- Supabase Row Level Security

---

## 15. Permission Model

### Purpose
Define what the AI can and cannot do, and how permissions are enforced.

### Permission Levels

**Level 1: Read Everything**
The AI can read all business data within the organization. This includes:
- Products, customers, suppliers (names, prices, balances)
- All transactions (sales, purchases, payments, expenses)
- Staff data (profiles, locations, duty sessions)
- Market intelligence
- AI artifacts (alerts, briefings, drafts)

This level has no restrictions — the AI must see everything to be useful.

**Level 2: Write Only With Confirmation**
The AI can write to the database only after:
- Validator approval (all checks pass)
- Owner confirmation ("Yes, execute this")

Write operations are atomic within a single action type.

**Level 3: Sensitive Operations Require Extra Confirmation**
Certain operations require explicit warning + double confirmation:
- Deleting or voiding records
- Modifying prices or rates
- Batch operations (affecting multiple records)
- Operations involving large amounts

**Level 4: Never Allowed**
These operations are never available to the AI:
- Deleting the organization
- Removing staff members
- Changing owner credentials
- Modifying AI system prompts or configurations
- Accessing other organizations' data

### Enforcement Points
1. **Validator** — Checks permission before passing to Executor
2. **Executor** — Refuses to execute if permission checks were bypassed
3. **Auditor** — Flags any operation that bypassed permission checks

### Responsibilities
- Define clear boundaries for AI operations
- Prevent unauthorized or unsafe actions
- Provide transparent error messages when permission is denied

### Inputs
- Action type and parameters
- Owner role (always owner for now; staff in future)

### Outputs
- Permission decision (allow / deny with reason)

### Future Expansion
- Granular permissions per staff role
- Temporary permission elevation (owner approves a one-time action)
- Spending limits (maximum invoice amount without extra confirmation)

### Dependencies
- TradeOS staff permission model
- Security Model

---

## 16. AI Skills

### Purpose
Define the complete catalog of capabilities the AI Assistant possesses.

### Skill Catalog

| Skill | Category | Description | Confirmation Required |
|-------|----------|-------------|----------------------|
| Answer Business Question | Knowledge | Answer any question about the business | No |
| Explain Trend | Analysis | Explain why something changed (sales up/down, expenses increased) | No |
| Generate Chart | Analysis | Return structured chart data for visualization | No |
| Forecast | Analysis | Predict future sales, stock depletion, cash flow | No |
| Recommend Action | Analysis | Suggest what the owner should do next | No |
| Assess Health | Analysis | Calculate and explain business health score | No |
| Create Sale | Action | Generate a sales invoice | Yes |
| Create Purchase | Action | Generate a purchase order | Yes |
| Create Expense | Action | Record an expense | Yes |
| Create Task | Action | Create a task | Yes |
| Create Customer | Action | Add a new customer | Yes |
| Create Supplier | Action | Add a new supplier | Yes |
| Create Product | Action | Add a new product | Yes |
| Send WhatsApp | Communication | Send a message via WhatsApp | Yes |
| Read WhatsApp | Communication | Process incoming WhatsApp message | No (auto-respond) |
| Generate Briefing | System | Generate daily or on-demand briefing | No |
| Generate Alert | System | Create an alert from business data | No |
| Schedule Reminder | System | Set a reminder for future action | Yes |
| Learn Preference | System | Store an owner preference | No (implicit) |

### Skill Resolution
When the Orchestrator receives an input, it determines which skill to invoke. The mapping is:

- Question about data → Answer Business Question / Explain Trend
- Question about health → Assess Health
- Question about future → Forecast
- Question about what to do → Recommend Action
- Command to do something → Create [Sale/Purchase/Expense/Task/Customer/Supplier/Product]
- Communication task → Send WhatsApp / Read WhatsApp
- System request → Generate Briefing / Generate Alert / Schedule Reminder

### Responsibilities
- Provide a complete, well-defined set of capabilities
- Ensure every owner input maps to at least one skill
- Keep the skill catalog updated as new capabilities are added

### Inputs
- Owner message (implicitly requests a skill)

### Outputs
- Skill invocation with parameters

### Future Expansion
- Custom skills defined by the owner
- Third-party skills via MCP
- Skill chaining (one skill's output feeds another)

### Dependencies
- Internal AI Agents
- Execution Pipeline

---

## 17. Execution Pipeline

### Purpose
Define the mandatory seven-step process that every business operation must follow.

### The Pipeline

```
┌──────────┐   ┌──────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌───────┐
│UNDERSTAND│ → │ PLAN │ → │VALIDATE │ → │CONFIRM  │ → │EXECUTE  │ → │ AUDIT   │ → │ LEARN │
│          │   │      │   │          │   │         │   │         │   │         │   │       │
│ Owner    │   │Break │   │Check     │   │Show     │   │Create   │   │Log      │   │Update │
│ intent   │   │down  │   │permis-  │   │draft    │   │records  │   │every-   │   │memory │
│ detected │   │into  │   │sions,   │   │to owner │   │atomic-  │   │thing    │   │&      │
│ Action   │   │steps │   │data     │   │Ask yes/ │   │ally     │   │         │   │prefe- │
│ extracted│   │      │   │integrity│   │no       │   │         │   │         │   │rences │
└──────────┘   └──────┘   └──────────┘   └─────────┘   └─────────┘   └─────────┘   └───────┘
```

### Step Details

**Step 1: Understand**
- Owner input arrives
- Orchestrator classifies intent
- Action Agent (if applicable) extracts structured action from text
- Entities are resolved against the Business Knowledge Model
- Output: Structured intent + resolved entities

**Step 2: Plan**
- Planner decomposes action into granular steps
- Each step is checked against current business data
- Missing fields are identified
- Draft summary is generated (what the result will look like)
- Output: Ordered step list + draft summary + missing fields list

**Step 3: Validate**
- Validator checks permissions
- Validator checks data integrity
- Validator checks business logic (stock, credit, etc.)
- Validator checks safety rules
- Output: Validation result (pass/warning/fail) + warnings/errors

**Step 4: Confirm**
- If validation fails → explain errors to owner, ask for correction
- If validation passes with warnings → show warnings, ask for confirmation
- If validation passes → show draft summary, ask "Execute?"
- Output: Owner signal (yes/cancel/modify)

**Step 5: Execute**
- If owner confirms → Executor performs the operation in a transaction
- If owner cancels → Draft marked as cancelled, conversation continues
- If owner modifies → Updated instructions go back to Step 1
- Output: Execution result (success with IDs / failure with error)

**Step 6: Audit**
- Every step is logged immutably
- Full before/after state is recorded
- Output: Immutable audit trail

**Step 7: Learn**
- Success → Update preferences, reinforce patterns
- Failure → Log error pattern for improvement
- Owner feedback → Update preference model
- Output: Updated Business Memory

### Non-Operation Messages
For messages that do not involve business operations (questions, analysis requests, casual conversation), the pipeline short-circuits:

```
UNDERSTAND → (no action needed) → RESPONSE
```

The full seven-step pipeline is only for operations that change business state.

### Responsibilities
- Enforce safe execution for every business operation
- Prevent shortcuts or direct execution paths
- Provide complete transparency at every step
- Allow the owner to cancel or modify at any point before execution

### Inputs
- Owner message (triggers the pipeline)

### Outputs
- Execution result (for operations)
- Answer (for questions)
- Status at every step (displayed in conversation)

### Future Expansion
- Scheduled execution (pipeline runs at a future time)
- Batch pipeline (multiple operations in one flow)
- Conditional pipeline ("If X, do Y; otherwise do Z")

### Dependencies
- All Internal AI Agents
- Planner, Validator, Executor, Auditor
- Business Memory

---

## 18. Prompt Strategy

### Purpose
Define how prompts are structured for different AI tasks to ensure consistent, safe, high-quality responses.

### Prompt Types

**Type 1: Intent Classification**
- **Purpose**: Classify owner input into intent category
- **System Prompt**: Short, constrained, few-shot examples
- **Temperature**: 0 (deterministic)
- **JSON Mode**: Yes
- **Output Schema**: `{ intent: string, confidence: number, entities?: string[] }`
- **Token Budget**: Minimal (200 tokens)

**Type 2: Command Parsing**
- **Purpose**: Extract structured action from natural language command
- **System Prompt**: Domain-specific, includes entity catalog (products, customers, suppliers)
- **Temperature**: 0.1
- **JSON Mode**: Yes
- **Output Schema**: `{ action_type: string, fields: Record<string, unknown>, missing_fields: string[] }`
- **Token Budget**: Moderate (500 tokens for entities)

**Type 3: Business Question Answering**
- **Purpose**: Answer factual questions grounded in business data
- **System Prompt**: Role prompt (business manager), instruction to cite data, instruction to admit uncertainty
- **Temperature**: 0.2
- **JSON Mode**: Optional (text response with structured sections)
- **Context**: Full business context package
- **Token Budget**: Large (2000+ tokens)
- **Special Instructions**: "If data is insufficient, say so. Never make up numbers."

**Type 4: Analysis & Forecasting**
- **Purpose**: Analyze trends, generate forecasts, produce recommendations
- **System Prompt**: Analytical role, structured output format
- **Temperature**: 0.3
- **JSON Mode**: Yes
- **Output Schema**: `{ analysis: string, forecast?: { ... }, recommendations?: [], confidence: number }`
- **Token Budget**: Large (3000+ tokens)

**Type 5: Confirmation Summarization**
- **Purpose**: Generate a clear, concise summary of what will be executed
- **System Prompt**: Instruction to be specific (exact amounts, names, prices)
- **Temperature**: 0
- **JSON Mode**: No (plain text, owner-facing)
- **Token Budget**: Small (300 tokens)

**Type 6: Preference Learning**
- **Purpose**: Extract preference signal from owner action or statement
- **System Prompt**: Subtle inference instruction
- **Temperature**: 0.1
- **JSON Mode**: Yes
- **Output Schema**: `{ preference_key: string, preference_value: unknown, confidence: number }`
- **Token Budget**: Small (200 tokens)

### Prompt Principles
1. Every prompt includes the business context (scoped to request)
2. Every prompt includes the conversation history (last N messages)
3. Every prompt has a clearly defined output schema
4. Every prompt instructs the AI to refuse unsafe requests
5. System prompts are versioned for tracking changes

### Responsibilities
- Ensure consistent AI behavior across all tasks
- Minimize token usage while maintaining quality
- Prevent prompt injection from owner input
- Enable easy iteration on prompt quality

### Inputs
- Task type (determines which prompt template to use)
- Business context (assembled by Context Strategy)
- Conversation history

### Outputs
- Structured response matching the expected schema
- Raw text for owner-facing content

### Future Expansion
- A/B testing of prompt variations
- Automated prompt optimization from owner feedback
- Dynamic prompt assembly based on detected subtask

### Dependencies
- AI provider router
- Context Strategy
- Conversation Memory Strategy

---

## 19. Context Strategy

### Purpose
Define what business data is included in each AI request, how it is assembled, and how token budgets are managed.

### Context Assembly Rules

**Rule 1: Scope to Intent**
The context included depends on the detected intent:
- Sales question → Sales overview + top products + recent invoices + customer stats
- Purchase action → Suppliers + products + current stock + pending purchases
- Health assessment → Full business overview + trends + anomalies
- Staff query → Active sessions + staff profiles + last locations

**Rule 2: Critical Data Always Included**
- Organization name
- Current date/time
- Active section context
- Recent conversation history (last 5 exchanges)

**Rule 3: Supplementary Data Conditionally Included**
- Historical data (included when analyzing trends)
- Entity details (included when resolving specific entities)
- Market intelligence (included when relevant to the query)

**Rule 4: Token Budget Management**
- Small context: <500 tokens (intent classification, simple commands)
- Medium context: 500-2000 tokens (factual questions, entity resolution)
- Large context: 2000-6000 tokens (analysis, forecasting, complex commands)
- Capped at 80% of provider's maximum context window

**Rule 5: Freshness**
- Real-time data (stock levels, today's transactions) is fetched fresh for each request
- Analytical data (trends, aggregates) is cached for 5 minutes
- Static data (product names, supplier lists) is cached for 1 hour

### Context Assembly Function

```typescript
function assembleContext(intent: Intent, memory: BusinessMemory): ContextPackage {
  const base = {
    organization: memory.organization,
    date: new Date().toISOString(),
    recentConversation: memory.getRecentMessages(5),
  };
  
  switch (intent.scope) {
    case "sales":
      return { ...base, sales: memory.getSalesOverview(), ... };
    case "inventory":
      return { ...base, inventory: memory.getInventorySummary(), ... };
    // ... etc
  }
}
```

### Responsibilities
- Provide sufficient context for accurate AI responses
- Minimize token waste by including only relevant data
- Ensure data freshness for real-time queries
- Handle cases where context exceeds token budget gracefully

### Inputs
- Detected intent
- Business Memory data
- Current business state

### Outputs
- Assembled context package (ready for prompt insertion)

### Future Expansion
- Dynamic token budget allocation based on query complexity
- Hierarchical context (summary first, details on demand)
- Owner-specific context preferences ("Always include pending orders")

### Dependencies
- Business Knowledge Model
- Business Memory
- Intent classification

---

## 20. Conversation Memory Strategy

### Purpose
Define how conversations are stored, retrieved, and used across sessions.

### Storage Architecture

```
ai_conversations
├── id (uuid, PK)
├── organization_id (FK)
├── profile_id (FK)
├── mode: "unified" (always — we have one mode now)
├── title (auto-generated from first message)
├── status: "active" | "archived"
├── message_count
├── created_at
└── updated_at

ai_conversation_messages
├── id (uuid, PK)
├── conversation_id (FK → ai_conversations)
├── role: "user" | "assistant" | "system"
├── message_type: "text" | "chart" | "action_draft" | "action_executed" | "alert" | "briefing" | "whatsapp"
├── content (jsonb) — flexible, type-specific content
├── related_draft_id (FK → ai_action_drafts, nullable)
├── related_entity_type (string, nullable — "sales_invoice", "purchase_order", etc.)
├── related_entity_id (string, nullable)
├── metadata (jsonb) — token count, latency, provider, model, etc.
├── created_at
└── parent_message_id (uuid, nullable — for branching conversations)
```

### Conversation Lifecycle

1. **Start**: First message from owner creates a new conversation
2. **Continue**: Subsequent messages append to the same conversation
3. **Archive**: Conversation is archived after 24 hours of inactivity
4. **Resume**: Owner can reference a past conversation ("Remember that purchase draft?") → Episodic memory retrieves it
5. **Delete**: Owner can delete a conversation (soft delete, audit log preserved)

### Retrieval Strategy

- **Current conversation**: Full message history loaded (last 50 messages for context, rest lazy-loaded for scrolling)
- **Recent conversations**: List of last 20 conversations (title, date, message count)
- **Semantic search**: Full-text search across all conversations for the organization
- **Episodic retrieval**: When owner references a past event, vector similarity search retrieves relevant messages

### Token Management for Context
When including conversation history in AI context:
- Always include: Last 3 exchanges (user + assistant pairs)
- Usually include: Last 10 exchanges
- Sometimes include: Summarized history beyond 10 exchanges
- Never include: Full conversation history (would exceed token budget)

### Responsibilities
- Store every message durably
- Enable conversation continuity across sessions
- Support semantic search of past conversations
- Manage token budget by truncating or summarizing old history

### Inputs
- Every message (user and assistant)

### Outputs
- Conversation history for AI context
- Search results for past conversation retrieval

### Future Expansion
- Conversation summarization (auto-generate title and key points)
- Multi-branch conversations (owner explores multiple paths)
- Conversation export (PDF, JSON)

### Dependencies
- Supabase (storage)
- AI provider router (for summarization and embeddings)
- Business Memory

---

## 21. Future MCP Integration Strategy

### Purpose
Define how TradeOS AI will integrate with external tools and services via the Model Context Protocol (MCP), enabling the assistant to interact with the world beyond TradeOS.

### What is MCP?
The Model Context Protocol is an open standard that allows AI systems to discover and use external tools, data sources, and services through a standardized interface. Think of it as "USB-C for AI" — a universal connector for AI capabilities.

### Integration Points

**MCP Server Registry**
Each MCP server provides a set of tools that the AI can use:

```
TradeOS AI ←→ MCP Client ←→ MCP Server Registry
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Banking  │ │ Courier  │ │ Tax      │
              │ MCP      │ │ MCP      │ │ MCP      │
              └──────────┘ └──────────┘ └──────────┘
```

### Planned MCP Integrations

| MCP Server | Purpose | Tools |
|------------|---------|-------|
| **Banking** | Check balance, verify payments, initiate transfers | `get_balance`, `verify_payment`, `initiate_transfer` |
| **Courier/Logistics** | Track shipments, calculate rates, book pickups | `track_shipment`, `calculate_rate`, `book_pickup` |
| **Tax/FBR** | File returns, check tax status, generate invoices | `check_tax_status`, `generate_tax_invoice` |
| **Payment Gateway** | Process payments, refunds, check transaction status | `process_payment`, `check_transaction`, `issue_refund` |
| **Communication** | Send emails, SMS (non-WhatsApp), Slack/Teams | `send_email`, `send_sms` |
| **E-commerce** | Sync products, orders, inventory with online store | `sync_products`, `get_orders`, `update_inventory` |

### How MCP Tools Are Integrated
1. MCP server is registered with TradeOS (configuration, not code)
2. Server provides tool definitions (name, description, input schema)
3. AI Assistant includes tool definitions in the system prompt
4. When AI decides to use a tool, Comms Agent calls the MCP server
5. Result is returned to the AI for processing
6. Response is shown to the owner

### Security for MCP
- MCP servers are organization-scoped (owner chooses which to enable)
- Tool calls require owner confirmation (unless configured as trusted)
- Sensitive tools (banking transfers) always require confirmation
- MCP servers are isolated (cannot access TradeOS data directly)

### Responsibilities
- Provide a standardized interface for external tool integration
- Enable the AI to perform operations beyond TradeOS (payments, shipping, taxes)
- Maintain security boundaries between MCP tools and TradeOS data

### Inputs
- MCP tool definition (from server registration)
- AI-generated tool call request

### Outputs
- Tool execution result (back to AI for processing)

### Future Expansion
- MCP marketplace (owner browses and installs integrations)
- Custom MCP server development kit
- MCP server analytics (usage, reliability, cost)

### Dependencies
- MCP protocol specification
- MCP client library (Node.js)
- Comms Agent (for routing MCP tool calls)

---

## 22. Enterprise Scaling Strategy

### Purpose
Define how the AI architecture scales from a single shop to multi-branch enterprises.

### Scaling Dimensions

**Dimension 1: Multi-Branch**
- Organization model extended with branch/location hierarchy
- AI aware of which branch data belongs to
- Queries can be scoped: "How is the Lahore branch performing?"
- Actions target specific branches
- Centralized or branch-level AI configuration

**Dimension 2: Multi-User**
- Staff access to AI with role-based permissions
- Each staff member has scoped AI capabilities
- Owner sees all, staff see only what their role allows
- Staff AI actions attributed to the staff member in audit logs

**Dimension 3: Multi-Organization (Future)**
- Owner manages multiple businesses from one account
- AI maintains separate Business Memory per organization
- Context switching: "Switch to my clothing business"
- Cross-organization insights (anonymized and aggregated)

### Performance Scaling

**AI Provider Routing**
- Tiered provider selection based on query complexity:
  - Simple queries → Fast, cheap provider (Groq/Llama)
  - Complex analysis → Powerful provider (OpenAI/Gemini)
  - Background tasks → Batch processing with cheaper models

**Caching Layer**
- Frequent queries → Cached responses with invalidation on data change
- Business context → Cached with TTL based on data volatility
- Entity lookup → In-memory cache with database sync

**Rate Limiting & Queuing**
- Per-organization rate limits for AI API calls
- Background tasks queued for processing during low-usage periods
- Priority queue for owner-facing requests

### Data Scaling

**Conversation Archival**
- Conversations older than 90 days automatically archived to cold storage
- Archived conversations searchable but not in active context
- Summarization before archival preserves key information

**Context Window Optimization**
- Dynamic token allocation based on query needs
- Hierarchical context assembly (summary → detail drill-down)
- Automatic truncation with summarization when context exceeds limits

### Responsibilities
- Support business growth from single shop to enterprise
- Maintain performance under increasing load
- Ensure consistent AI experience regardless of business size
- Keep costs proportional to usage

### Inputs
- Organization configuration (branches, staff, settings)
- Usage patterns and load metrics

### Outputs
- Scaled architecture decisions (provider selection, caching, archival)

### Future Expansion
- Dedicated AI instance per enterprise customer
- Hybrid on-premise/cloud deployment for data-sensitive customers
- Custom AI fine-tuning on industry-specific data

### Dependencies
- Organization and branch data model
- Staff permission model
- Usage monitoring infrastructure

---

## 23. Development Roadmap

### Purpose
Define the phased implementation plan to build the unified AI Assistant from concept to production.

---

### Phase 1: Foundation — Unified Page Shell

**Goal**: Create the single AI Assistant page with conversation UI.

**Deliverables**:
- `ai-assistant/page.tsx` — New page replacing the four existing AI sections
- `AiLayout.tsx` — Layout wrapper with conversation panel
- `ConversationPanel.tsx` — Scrollable message list UI
- `MessageBubble.tsx` — Message renderer (text, basic cards)
- `MessageInput.tsx` — Text input with send button
- Folder structure created (all component folders)

**What works**: Owner can see the new AI page, send messages, receive simple responses

**What does NOT yet work**: No AI integration yet — responses are simulated

**Duration**: 2 days

---

### Phase 2: Chat Intelligence — Q&A + Analytics

**Goal**: Merge AI Analytics + AI Business Query into the Chat capability.

**Deliverables**:
- `context-builder.ts` — Unified business context builder (replaces two separate builders)
- `conversation-engine.ts` — Active state machine integration
- `useConversation.ts` — Conversation state hook
- Chat mode integrated with `/api/ai-business-query`
- `ChartMessage.tsx` — Chart rendering from AI response
- `DataTable.tsx` — Table rendering from AI response
- `QueryHistory.tsx` — Side panel query history

**What works**: Owner can ask business questions, get answers with charts and tables

**What does NOT yet work**: Action execution, voice, WhatsApp

**Duration**: 3 days

**Requires**: AI provider API key

---

### Phase 3: Action Engine — Command Parsing & Execution

**Goal**: Upgrade the AI Assistant from regex parsing to LLM-powered command parsing.

**Deliverables**:
- `intent-detector.ts` — LLM-based intent classification
- `command-parser.ts` — LLM-based command parsing
- `/api/ai-command-parse` — New API route for parsing
- `ActionCard.tsx` — Draft preview with execute/cancel
- `DraftList.tsx` — Draft history side panel
- `DraftCard.tsx` — Individual draft status card
- `ManualFieldsForm.tsx` — Manual field override form
- Integration with existing `executeAiActionDraft()` logic
- Execution pipeline (Understand → Plan → Validate → Confirm → Execute → Audit → Learn)

**What works**: Owner can say "Create purchase of 10 Pepsi from XYZ", AI parses it with LLM, collects missing fields, shows draft, executes on confirmation

**Duration**: 5 days

**Requires**: AI provider API key

---

### Phase 4: Voice Interface

**Goal**: Voice input and output across the unified assistant.

**Deliverables**:
- `useSpeechRecognition.ts` — Reusable voice input hook
- `useSpeechSynthesis.ts` — Reusable TTS output hook
- `SpeechRecognition.tsx` — Voice button UI component
- `SpeechSynthesis.tsx` — TTS controls
- Voice mode active in the main input area (no separate tab needed)
- Language auto-detection for speech
- Urdu voice support

**What works**: Owner can tap microphone, speak a question or command, hear response

**Duration**: 3 days

---

### Phase 5: Side Panel & Settings

**Goal**: Complete the side panel with all supporting information.

**Deliverables**:
- `SidePanel.tsx` — Side panel container
- `AlertsPanel.tsx` — Alerts and briefings display
- `SettingsPanel.tsx` — Language, voice, provider settings
- `LanguageSelector.tsx` — Language dropdown
- `DateRangeSelector.tsx` — Date range chips
- `StatusMessage.tsx` — Success/error banners

**What works**: Full side panel with alerts, settings, language selection

**Duration**: 2 days

---

### Phase 6: Conversation Memory

**Goal**: Full conversation persistence, history, and search.

**Deliverables**:
- `ai_conversations` and `ai_conversation_messages` database tables (run migration)
- Conversation save/load/archive logic
- Conversation history list in side panel
- Full-text search across conversations
- Token-aware context assembly from history

**What works**: Conversations persist across sessions, owner can browse history, search past conversations

**Duration**: 3 days

---

### Phase 7: WhatsApp Integration

**Goal**: Send and receive WhatsApp messages through the AI.

**Deliverables**:
- `lib/whatsapp/client.ts` — WhatsApp Cloud API client
- `lib/whatsapp/webhook.ts` — Webhook handler
- `lib/whatsapp/message-builder.ts` — Message template builder
- `/api/whatsapp/webhook` — Incoming message endpoint
- `/api/whatsapp/send` — Outgoing message endpoint
- WhatsApp contact resolution (match phone → customer/supplier)
- AI integration: "Send message to [contact] that [content]"
- Incoming message → AI processing → optional auto-response

**What works**: Owner can tell AI to send WhatsApp messages, incoming messages are routed to AI

**Duration**: 5 days

**Requires**: Meta Business Account, WhatsApp Business Account, verified phone number

---

### Phase 8: Premium Voice

**Goal**: Upgrade from Web Speech API to premium voice providers.

**Deliverables**:
- `lib/voice/provider-router.ts` — Voice provider abstraction
- Deepgram STT integration
- ElevenLabs TTS integration
- Server-side voice processing via API routes
- Fallback to Web Speech API when premium unavailable

**What works**: Higher quality speech recognition and synthesis, better Urdu support

**Duration**: 3 days

**Requires**: Deepgram API key, ElevenLabs API key (optional — Web Speech API fallback always works)

---

### Phase 9: Streaming & Advanced UI

**Goal**: Streaming AI responses and rich message types.

**Deliverables**:
- SSE (Server-Sent Events) streaming for AI responses
- Typewriter effect for streamed text
- Enhanced chart rendering (multiple chart types)
- Rich action cards (progress indicators during execution)
- Improved mobile responsiveness

**What works**: Responses appear as they are generated, richer visual experience

**Duration**: 3 days

---

### Phase 10: Polish & Production Readiness

**Goal**: Edge cases, error recovery, performance, and QA.

**Deliverables**:
- Error handling: AI provider failures, network issues, rate limits
- Loading states and skeletons for all async operations
- Empty states for all lists (no drafts, no history, no alerts)
- Mobile touch optimization (larger hit targets, swipe gestures)
- Keyboard shortcuts
- Accessibility (ARIA labels, keyboard navigation, screen reader support)
- Performance audit and optimization
- Rate limit handling (exponential backoff, queue)
- Remove 3,040+ lines of old code from page.tsx

**What works**: Production-ready, polished AI Assistant

**Duration**: 4 days

---

### Roadmap Summary

| Phase | Name | Days | Requires | Cumulative |
|-------|------|------|----------|------------|
| P1 | Foundation — Unified Page Shell | 2 | Nothing | 2 |
| P2 | Chat Intelligence — Q&A + Analytics | 3 | AI API key | 5 |
| P3 | Action Engine — Command Parsing & Execution | 5 | AI API key | 10 |
| P4 | Voice Interface | 3 | Nothing | 13 |
| P5 | Side Panel & Settings | 2 | Nothing | 15 |
| P6 | Conversation Memory | 3 | Nothing | 18 |
| P7 | WhatsApp Integration | 5 | Meta/WhatsApp setup | 23 |
| P8 | Premium Voice | 3 | Deepgram/ElevenLabs keys | 26 |
| P9 | Streaming & Advanced UI | 3 | Nothing | 29 |
| P10 | Polish & Production Readiness | 4 | Nothing | 33 |

**Total estimated effort: 33 days**

---

## Document Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-29 | Chief AI Architect | Initial master architecture document |

---

*This document defines the permanent AI architecture for TradeOS. All future AI development shall conform to this specification. Deviations require documented exceptions and architectural review.*
