# ADR-0001: Modular monolith + worker, and the initial stack

Status: accepted · Date: 2026-07-15

## Decision

Two deployables (Next.js web app, Node worker) sharing domain packages in a
pnpm monorepo. No microservices.

Stack: Next.js (App Router) · TypeScript strict · PostgreSQL 16 · Prisma 6 ·
Auth.js (Google + Microsoft OAuth) · Postgres-backed job queue + transactional
outbox · S3-compatible object storage (Phase 3) · Vitest · Playwright ·
Docker Compose for dev.

## Reasoning

- A pilot with 2–3 clients does not justify service boundaries; a modular
  monolith keeps transactions (state + audit + outbox) atomic and simple.
- The worker is a separate deployable because Linear side effects, retries,
  and reconciliation must survive web deploys and must not run inside
  serverless request lifecycles.
- Prisma over raw SQL/Drizzle: best migration story + typed client; RLS is
  still plain SQL in migrations, which Prisma supports cleanly.
- Auth.js over Better Auth: mature OAuth provider ecosystem (Google,
  Microsoft Entra), database session strategy fits our session table, and it
  keeps us provider-abstracted per the brief. Revisit only if adapter
  friction appears.
- Postgres queue over Redis/BullMQ: one fewer stateful dependency; the brief
  requires a queue interface so swapping later is contained.

## Consequences

Vercel can host the web app but nothing essential may live in Vercel-only
primitives; the worker runs anywhere Node runs. All background semantics
(locking, retries, backoff) are our code — kept deliberately small.
