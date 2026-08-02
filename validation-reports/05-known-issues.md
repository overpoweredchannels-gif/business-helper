# Business Brain Known Issues

**Generated:** 2026-07-29T20:05:57.054Z

## Critical (0)
- None

## High (0)
- None

## Medium (0)
- None

## Low (2)

### L1: clear() uses bracket-access to private fields
- **Location:** `MemoryWriter.clear()`
- **Detail:** Accesses `this.store["_sections"]` and `this.store["_lastRefreshedAt"]` directly
- **Impact:** Works but relies on TypeScript private-access bypass quirk
- **Fix:** Add a public `reset()` method to MemoryStore (deferred — non-urgent)

### L2: EntityIndex fully rebuilt on every writeRaw()
- **Location:** `writeRaw()` calls `buildIndex()` with all 4 entity maps
- **Impact:** Not a bottleneck for Phase 1 (single bootstrap per page load); may matter for incremental sync
- **Fix:** Implement partial index update when incremental data push is introduced

## Resolved Issues

### Previously Medium (now resolved)

| Issue | Resolution |
|-------|-----------|
| Analytics not refreshable after initial bootstrap | `refreshAnalytics()` added to MemoryWriter and BusinessBrain interface |
| Per-product profit margin formula inverted (`(revenue - profit) / revenue`) | Changed to `profit / revenue * 100` |
| No input sanitization on chat messages | `sanitize.ts` added with length limits, control-char stripping, injection-pattern blocking |
| No rate limiting on chat endpoint | Sliding-window rate limiter in `rate-limit.ts` applied to server route (20/min/IP) and brain instance (60/min) |
| No PII-aware logging or response filtering | `pii-filter.ts` masks phone, CNIC, email, name, address in logs and AI responses |
| Empty KPIs in Context | Fixed in Phase 2.5 by adding `computeAnalytics()` to MemoryWriter |
| Forecast profit range inversion for negative values | Fixed in Phase 2.5 |
| MemoryWriter.clear() not resetting meta section | Fixed in Phase 2.5 |
| Fuzzy search not handling special characters | Fixed in Phase 2.5 |