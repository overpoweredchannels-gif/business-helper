# OP OWNER — AI Rules (Canonical Source)

> **This is the single authoritative document for ALL AI system behavior in OP OWNER. Every AI system (Business Query, Market Intelligence, Voice Operator, Action Drafts, Analytics, Alerts, Briefings) MUST comply. No exceptions.**

---

## Scope

These rules apply to:
- **AI Business Query** (`/api/ai-business-query`)
- **Market Intelligence Analysis** (`/api/market-intelligence/analyze`)
- **AI Voice Operator** (planned)
- **AI Action Drafts** (planned)
- **AI Analytics** (planned)
- **AI Alerts** (planned)
- **AI Daily Briefings** (planned)

---

## 1. Truth & Data Integrity

| Rule | Description |
|------|-------------|
| **R1.1 Never Hallucinate Business Data** | Answer ONLY from provided `business_summary` / `market_intelligence` context. If data missing: "This information is not available in your recorded business data." |
| **R1.2 Distinguish Fact from Inference** | Facts = numbers, dates, names from data. Inferences = trends, causes, predictions. Label clearly: "Based on the data..." vs "This suggests..." |
| **R1.3 Cite Evidence** | Analytics Explainer mode: Every claim references specific data points from provided summary. |
| **R1.4 No External Knowledge in Business Q&A** | Do not use training knowledge about market prices, competitor actions, or regulations unless explicitly provided in context. |
| **R1.5 Admit Uncertainty** | Confidence levels: High (≥2 supporting data points), Medium (1 data point + logic), Low (logic only). Always state confidence. |

---

## 2. Action & Mutation Safety

| Rule | Description |
|------|-------------|
| **R2.1 Never Execute Without Confirmation** | AI creates **drafts only** (`ai_action_drafts.status = 'draft'`). Owner must explicitly confirm before execution. |
| **R2.2 Confirmation Required for Every Mutation** | Purchase, Sale, Payment, Expense, Task, Staff, Settings — all require owner "Yes, execute" action. |
| **R2.3 Show Preview Before Confirm** | `execution_preview` field must show: entity, values, affected balances, linked records. |
| **R2.4 Reversible by Default** | Every AI-initiated action must have clear undo path (void invoice, reverse payment, cancel task). |
| **R2.5 Log Intent, Not Just Result** | `ai_action_drafts` + `ai_action_messages` capture full conversation leading to action. |

---

## 3. Permissions & Access Control

| Rule | Description |
|------|-------------|
| **R3.1 Respect Staff Permissions** | AI responses filtered by requester's permissions (`can_view_profit`, `can_manage_customers`, etc.). |
| **R3.2 Organization Isolation** | Never cross `organization_id` boundaries. All queries scoped to requester's org. |
| **R3.3 Owner Override Only** | Only `role = 'owner'` can confirm high-risk actions (credit limit changes, staff permissions, deletions). |
| **R3.4 Audit Every AI Interaction** | `ai_business_query_logs`, `market_ai_analyses`, `ai_action_drafts` — all create audit trail. |

---

## 4. Language & Localization

| Rule | Description |
|------|-------------|
| **R4.1 Support Three Language Modes** | `english`, `urdu` (Nastaliq), `roman_urdu` (Latin script). Detect from `language` param or question script. |
| **R4.2 Preserve Business Terminology** | In Urdu/Roman Urdu: keep terms like *karobar*, *udhar*, *wasool*, *tain*, *rate*, *carton*, *piece*, *PKR*. Do not over-translate. |
| **R4.3 Match Question Language** | If `language = 'auto'`, reply in the script/style of the question. |
| **R4.4 Number Formatting** | Currency: PKR with `en-PK` locale (₨1,23,456.00). Dates: `dd MMM yyyy` (Pakistan format). |

---

## 5. Market Intelligence Specific

| Rule | Description |
|------|-------------|
| **R5.1 Analyze Only Provided Text** | Market analysis uses ONLY title/summary/raw_text provided. No live news fetching. |
| **R5.2 Pakistani FMCG Context** | Categories fixed (defined in `src/lib/tradeos/constants.ts`): `cooking_oil_ghee`, `sugar`, `wheat_flour`, `rice`, `pulses`, `spices`, `beverages`, `dairy`, `fuel_transport`, `packaging`, `currency_imports`, `taxes_policy`, `weather_agriculture`, `general_fmcg`. |
| **R5.3 Threat/Opportunity Taxonomy** | Use only defined enums: `price_up/down`, `supply_shortage/improvement`, `demand_up/down`, `currency`, `tax`, `import`, `fuel`, `weather`, `transport`, `regulation`. |
| **R5.4 Action Recommendations Must Be Evidence-Linked** | "Increase inventory" only if text mentions shortage/rising demand. "Delay purchasing" only if price drop expected. |
| **R5.5 Score Calibration** | Risk/Opportunity 0-100: 0-25 Low, 26-50 Medium, 51-75 High, 76-100 Critical. Justify in `business_health_reason`. |

---

## 6. Voice Operator Specific

| Rule | Description |
|------|-------------|
| **R6.1 Session Continuity** | Maintain context across `ai_voice_operator_messages` in a session. Reference prior turns. |
| **R6.2 Intent Classification** | Every user utterance → `detected_intent`: `query`, `command`, `confirmation`, `correction`, `clarification`. |
| **R6.3 Route to Correct System** | `routed_to`: `business_query`, `market_intelligence`, `action_draft`, `task_manager`, `staff_duty`, `settings`. |
| **R6.4 Spoken-First Responses** | Output optimized for TTS: shorter sentences, explicit numbers ("one lakh twenty three thousand"), pauses. |
| **R6.5 Wake Word Privacy** | Only process audio after wake word ("OP OWNER" / "Hey Business"). No continuous recording. |

---

## 7. Analytics & Briefings

| Rule | Description |
|------|-------------|
| **R7.1 Structured Output Only** | Analytics Explainer → JSON with `Summary`, `Evidence`, `Recommendations`, `Confidence` sections. |
| **R7.2 Evidence = Data Quotes** | "Sales: 47 invoices, ₨12.3L" not "Sales are good." |
| **R7.3 Recommendations = Data-Driven** | "Reduce credit limit for Customer X" only if aging shows overdue > 60 days. |
| **R7.4 Confidence = Explicit** | High/Medium/Low + one-sentence reason. |
| **R7.5 Daily Briefing = Actionable** | Top 3 signals → 1 recommended action each. No generic advice. |

---

## 8. Provider Router (System Level)

| Rule | Description |
|------|-------------|
| **R8.1 Fallback Chain is Sacred** | Order: Gemini → OpenAI → xAI → Groq → Z.ai. Never skip. |
| **R8.2 Local Fallback on Total Failure** | If all providers fail AND `AI_ENABLE_LOCAL_FALLBACK=true`, return structured local summary from `business_summary`. |
| **R8.3 Timeout = 20s Max** | Per attempt. Total chain must complete < 60s. |
| **R8.4 JSON Mode Enforcement** | Strip fences, parse object, validate shape. On parse failure → retry next model/provider. |
| **R8.5 Log Every Attempt** | `attempts[]` in response: provider, model, ok, status, error. Enables debugging. |

---

## 9. Error Handling & Degradation

| Rule | Description |
|------|-------------|
| **R9.1 Graceful Degradation** | AI unavailable → show local summary + warning banner. Core ERP works without AI. |
| **R9.2 User-Facing Errors = Actionable** | "AI temporarily unavailable. Your data is safe. Try again in a moment." Not stack traces. |
| **R9.3 Internal Errors = Detailed Logs** | Server logs: provider, model, prompt hash, error, latency. |
| **R9.4 Rate Limit Response** | 429 → immediate fallback to next provider. No user-visible delay. |

---

## 10. Continuous Improvement

| Rule | Description |
|------|-------------|
| **R10.1 Capture Owner Corrections** | When owner edits AI draft or marks suggestion wrong → log for future fine-tuning. |
| **R10.2 Track Hallucination Reports** | "Report inaccurate answer" button → `ai_business_query_logs.feedback = 'incorrect'`. |
| **R10.3 Monthly Eval Set** | Curated Q&A pairs (Urdu/English) → run against current prompt + provider → track accuracy. |
| **R10.4 Provider Rotation Review** | Quarterly: compare latency, cost, quality per provider per task type. Adjust order. |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  OP OWNER AI — DECISION TREE                                │
├─────────────────────────────────────────────────────────────┤
│  User asks question                                         │
│       │                                                     │
│       ▼                                                     │
│  Is business_summary provided?                              │
│       │                                                     │
│  ┌──┴──┐                                                    │
│  │ No  │ → "I need access to your business data first."    │
│  └──┬──┘                                                    │
│       │                                                     │
│       ▼                                                     │
│  Can I answer from data alone?                              │
│       │                                                     │
│  ┌──┴──┐                                                    │
│  │ Yes │ → Answer with evidence, confidence, language      │
│  └──┬──┘                                                    │
│       │                                                     │
│       ▼                                                     │
│  │ No  │ → "Not enough recorded data to answer accurately."│
│  └─────┘                                                    │
│                                                             │
│  User requests action                                       │
│       │                                                     │
│       ▼                                                     │
│  Create ai_action_draft (status: draft)                     │
│       │                                                     │
│       ▼                                                     │
│  Show execution_preview to owner                            │
│       │                                                     │
│       ▼                                                     │
│  Owner confirms?                                            │
│       │                                                     │
│  ┌──┴──┐                                                    │
│  │ Yes │ → Execute via server action, log audit, update    │
│  └──┬──┘   draft status: executed                          │
│       │                                                     │
│       ▼                                                     │
│  │ No  │ → Update draft status: cancelled, keep for review │
│  └─────┘                                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Enforcement

- **Code Review**: All AI prompt changes require review against these rules.
- **Testing**: Golden dataset eval must pass before prompt deployment.
- **Monitoring**: Alert on `ok: false` rate > 5% or local fallback rate > 10%.
- **Audit**: Quarterly review of `ai_action_drafts` for unauthorized executions (must be zero).

---

**Version**: 1.0  
**Owner**: OP OWNER Core Team  
**Review Cycle**: Quarterly or on major AI capability change