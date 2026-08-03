# TradeOS API Layer Architecture

## 1. API Philosophy

The API Layer is the application boundary for TradeOS.

Its role is to expose business capabilities to external consumers while remaining free of business logic.

### API Routes are orchestration only
API routes should receive requests, validate and authenticate them, call business services, and return responses. They are not the place for pricing decisions, stock logic, accounting behavior, or business workflow definitions.

### APIs never contain business logic
Business logic belongs inside Business Services. The API layer should not determine whether a payment is valid, whether a sale should be allowed, or whether inventory can be oversold.

### APIs delegate to Business Services
The API layer is responsible for forwarding requests to the appropriate Business Service. That keeps the business rules centralized and consistent.

### APIs return standardized responses
All APIs should return predictable responses with clear status, error, metadata, and correlation information.

### APIs enforce authentication and authorization before invoking Business Services
Every request should be checked for authentication and authorization before the business service is called.

---

## 2. Responsibilities

### The API Layer may:
- receive HTTP requests
- authenticate users
- authorize access
- validate request shape
- call Business Services
- return standardized responses
- map DTOs

### The API Layer must not:
- calculate inventory
- calculate profit
- update stock logic
- perform pricing decisions
- perform accounting
- access repositories directly
- access Supabase directly

The API layer should be thin and policy-driven. It orchestrates the request lifecycle, not the business domain.

---

## 3. API Structure

The API layer should remain organized by domain.

Example folder organization:

```text
app/api/
  inventory/
  sales/
  purchases/
  customers/
  suppliers/
  payments/
  expenses/
  tasks/
  staff/
  ai/
  market/
  analytics/
  voice/
```

This structure supports clear domain ownership and makes it easier to evolve the platform over time.

---

## 4. Request Flow

The standard request flow is:

```text
Client
↓
API Route
↓
Authentication
↓
Authorization
↓
DTO Validation
↓
Business Service
↓
Repository
↓
Supabase Client
↓
Database
```

This flow ensures that every request enters the system through a controlled boundary and is handled by the correct business layer.

---

## 5. Response Standards

The API layer should return a consistent response envelope.

### Suggested response fields
- success: boolean
- data: payload or result object
- error: optional error object or message
- code: machine-readable error or status code
- timestamp: response timestamp
- request_id: correlation identifier

### Response patterns
- success responses should include the relevant domain data
- validation and authorization failures should be explicit
- business failures should preserve meaning without leaking unsafe internals

---

## 6. Error Handling

Errors should be categorized and handled consistently.

### Validation Errors
Raised when the request payload is malformed or missing required fields.

### Authentication Errors
Raised when the user cannot be identified or the session is invalid.

### Authorization Errors
Raised when the user is authenticated but lacks permission to perform the action.

### Business Errors
Raised when the Business Service rejects an operation due to domain rules, policy violations, or workflow state.

### Repository Errors
Raised when persistence fails due to the underlying data layer.

### Unexpected Errors
Used for unanticipated failures. These should be logged and surfaced safely.

The API layer should translate these into standardized response objects without losing the business context needed for debugging.

---

## 7. Authentication

The API layer should enforce authentication before any business operation is invoked.

### Expected authentication mechanisms
- JWT-based authentication where applicable
- Supabase Auth integration for session-based identity
- session validation for signed-in users
- organization validation to ensure the request is tied to the proper tenant
- role validation to ensure the caller has the appropriate privilege level

Authentication must occur at the edge of the request flow so that the business layer never receives anonymous or invalid identity context.

---

## 8. Authorization

Authorization should be checked before business execution.

### Typical roles and permissions
- Owner: full administrative access
- Manager: broad operational access
- Staff: limited task-specific access
- Read permissions: allow read-only access to domain data
- Write permissions: allow creation or update
- Delete permissions: allow destructive actions
- AI permissions: allow AI-related actions only when explicitly allowed

Authorization should be policy-driven and should use the Business Service or permission layer as the source of truth, not UI-level assumptions.

---

## 9. DTO Standards

The API layer should use explicit data transfer objects.

### Request DTOs
Used to define inbound payload structure for API routes.

### Response DTOs
Used to define outbound payload shape and ensure that responses are stable and predictable.

### Validation DTOs
Used to validate the request structure before it reaches the Business Service.

### Versioning
DTOs should be versioned or isolated by API version to avoid breaking compatibility as the platform evolves.

---

## 10. API Versioning

The API layer should reserve a clear version strategy.

Example version prefixes:
- /api/v1
- /api/v2

### Future compatibility strategy
- version the public contract explicitly
- preserve backward compatibility where practical
- avoid breaking changes in active integrations without migration plans
- keep route structure predictable for mobile, desktop, voice, and external integrations

---

## 11. External Integrations

The API layer should reserve clear boundaries for future external consumers.

### Potential integrations
- Voice Runtime
- Mobile App
- Desktop App
- WhatsApp
- POS
- Public APIs
- Future MCP integrations

These integrations should use the same authentication, authorization, DTO, and response patterns as the rest of the API layer.

---

## 12. Rate Limiting

Rate limiting should be planned as a platform concern.

### Future strategy
- protect public endpoints from abuse
- apply per-user and per-organization limits where appropriate
- support burst allowance for trusted clients
- log throttling events for operational visibility

---

## 13. Logging

The API layer should provide structured observability.

### Required logging areas
- request logging
- correlation IDs
- audit integration
- performance logging

Logging should support debugging, compliance review, and operational monitoring without exposing sensitive data inappropriately.

---

## 14. Security

The API layer must be treated as a security boundary.

### Security rules
- CSRF protections should be applied where required
- CORS policies should be explicit and limited
- input validation must be enforced on all request payloads
- output sanitization should be used where necessary
- organization isolation must be preserved at all times
- request size limits should be enforced to reduce abuse and failure risk

The API layer should never trust the client implicitly.

---

## 15. Summary

The API Layer is the controlled application boundary for TradeOS.

It accepts requests, verifies identity and access, transforms and validates payloads, forwards work to Business Services, and returns consistent responses. It does not own business logic, does not perform persistence directly, and does not bypass the service layer.

This architecture preserves a clean separation of concerns and ensures that TradeOS can evolve safely across web, mobile, voice, and external integration scenarios.
