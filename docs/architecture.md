# Frontstage architecture

## Shape

Modular monolith plus one background worker (ADR-0001). Two deployables:

- `apps/web` — Next.js (App Router), serves both the internal console and the
  client portal. Owns request-time authorization and all synchronous writes.
- `apps/worker` — long-running Node process. Drains the transactional outbox,
  runs the PostgreSQL-backed job queue, performs Linear side effects,
  reconciliation, notification delivery.

Domain logic lives in `packages/*`, organized by business capability. Route
handlers stay thin; nothing imports provider SDKs except the owning adapter
package.

## Data flow invariants

1. **Every client-visible fact is a Frontstage-owned projection.** Linear data
   lands in `source_objects` / snapshots; publication copies curated content
   into Frontstage-owned records. Source refreshes never overwrite curated
   external content (they mark divergence for review).
2. **Writes with side effects use the transactional outbox** (ADR-0004). The
   domain transaction commits state + audit event + outbox rows atomically;
   the worker performs Linear/email side effects with retries. A client
   approval is valid even when Linear is down.
3. **Tenant isolation is two-layered** (ADR-0002): application-level scoping
   on every query plus PostgreSQL row-level security keyed off a
   transaction-local `app.current_organization_id` setting.
4. **Authorization is capability-based** (`packages/authorization`): services
   check permissions against scoped role assignments; role names never appear
   in domain logic.

## Provider abstractions

Interfaces with one initial implementation each; no provider types cross the
boundary into domain code:

| Concern        | Interface home            | First implementation      |
| -------------- | ------------------------- | ------------------------- |
| Work systems   | `integration-core`        | `linear-adapter`          |
| Email          | `notifications`           | SMTP (Mailpit dev / provider in prod) |
| Object storage | attachments package (P3)  | S3-compatible             |
| Queue          | `packages/database` jobs  | Postgres `jobs` table     |
| AI drafting    | `ai` (P5)                 | Anthropic                 |

## Deployment

Docker-first. Web on Vercel (or any Node host), worker on Railway/Render/Fly,
managed Postgres, managed S3-compatible storage. No essential logic in
Vercel-specific primitives.

## Current state

Implemented: monorepo, Docker Postgres + Mailpit, Prisma schema for identity /
tenancy / authorization / invitations / audit / outbox / jobs / flags /
idempotency, RLS + append-only audit enforcement (verified against the live
database), authorization package with unit tests. See docs/progress.md.
