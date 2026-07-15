# ADR-0004: PostgreSQL-backed job queue + transactional outbox

Status: accepted · Date: 2026-07-15

## Decision

Side effects (Linear writes, email, notification fan-out) never execute inside
request transactions. Instead:

1. The domain transaction writes state changes + `audit_events` +
   `outbox_events` rows and commits atomically.
2. The worker polls `outbox_events` (`FOR UPDATE SKIP LOCKED`), translates
   events into `jobs`, and executes with exponential backoff, attempt caps,
   and error capture (`last_error`, `next_attempt_at`).

The queue lives behind a `JobQueue` interface so a dedicated broker can
replace it without touching domain code.

## Reasoning

The brief's canonical scenario: a client approval must be recorded and remain
valid even if Linear is down (§42). Fire-and-forget calls or request-time API
calls to Linear violate that. Postgres gives us exactly-once handoff from the
domain transaction to the side-effect pipeline without adding Redis/SQS at
pilot scale; `SKIP LOCKED` polling is proven and sufficient for our volume.

## Consequences

- Every externally visible side effect gets a correlation id and appears in
  the error center (Phase 1+) when it fails.
- Duplicate protection on the execution side comes from idempotency records
  and provider-level dedup keys where available.
- Worker liveness becomes an operational requirement; a heartbeat metric and
  a "pending Linear synchronization" UI state (per brief §42) surface delays
  honestly.
