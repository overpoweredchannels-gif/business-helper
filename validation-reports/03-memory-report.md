# Business Brain Memory Report

**Timestamp:** 2026-07-29T20:05:57.054Z

## Memory Architecture
- **Pattern:** Single in-memory MemoryStore instance per process (singleton)
- **Layout:** 16 sections under MemorySections, each independently typed
- **Indexing:** EntityIndex provides fuzzy search over 4 entity types
- **Lifespan:** Created per bootstrap, survives for session, cleared on re-bootstrap

## Section Inventory
| Section | Type | Purpose |
|---------|------|---------|
| products | Map<string, ProductMemory> | Catalog with stock, pricing, velocity, status flags
| customers | Map<string, CustomerMemory> | Profiles with credit, payments, activity flags
| suppliers | Map<string, SupplierMemory> | Profiles with purchases, payments, delivery stats
| staff | Map<string, StaffMemory> | Profiles with duty tracking and sales stats
| sales | SalesMemory | Aggregated: period summaries, daily/monthly series
| purchases | PurchasesMemory | Aggregated: period summaries, supplier breakdowns
| expenses | ExpensesMemory | Categorized expenses, daily breakdowns, anomaly detection
| inventory | InventoryMemory | Computed: stock counts, values, status breakdowns
| analytics | AnalyticsMemory | Computed: health score, KPIs, trends, forecasts, recs
| recommendations | object | Active recs with priority/category breakdowns
| conversations | ConversationMemoryState | Chat history, pipeline state
| preferences | PreferencesSnapshot | Language, period hints, topic frequency, suggested Qs
| permissions | PermissionsSnapshot | Feature toggles per org
| meta | MemoryMeta | Org identity, schema version, refresh metadata
| tasks | TaskMemory | Counts by status/priority
| alerts | AlertMemory | Active/critical counts, recent list

## Data Flow
1. **Ingest:** 13 Supabase tables loaded in parallel via SupabaseLoader
2. **Transform:** MemoryWriter.writeRaw() maps raw rows to MemorySections
3. **Compute:** Inventory and Analytics sections computed post-write
4. **Index:** EntityIndex built for fuzzy search
5. **Serve:** ContextRetriever reads sections → ContextBundle for AI
6. **Skills:** 6 skills read sections → derived business intelligence

## Memory Constraints
- All data lives in Node.js heap; no LRU or TTL eviction
- No persistence layer (re-bootstrap on page reload)
- Optimized for single-org use case; scalability with multiple orgs not yet addressed