# Progress log

Honest record of what is actually built and verified. Newest first.

## 2026-07-15 — Phase 0 slice 1: foundation

**Repository finding**: the pre-existing `frontStage/` directory was empty and
sat inside an unrelated git repository rooted at `~/Desktop` (a hackforla
website fork). A fresh, self-contained repo was initialized here. Nothing was
reusable.

**Built and verified:**

- pnpm monorepo, strict TypeScript base config
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Docker Compose: Postgres 16 (localhost:5434 — 5432/5433 were taken locally)
  and Mailpit for dev email capture.
- `@frontstage/database`: Prisma 6 schema for users, auth accounts, sessions,
  organizations, memberships, scoped role assignments, invitations, audit
  events, outbox events, jobs, feature flags (+ overrides), idempotency
  records. Two migrations applied to the live dev database.
- Row-level security migration: `frontstage_app` non-owner role, FORCEd RLS
  policies keyed off transaction-local `app.current_organization_id`,
  append-only trigger on `audit_events`.
  - Verified live: app role sees 0 orgs without context; only `org-a` with
    Org A context; UPDATE/DELETE on audit_events raises even as superuser.
- `@frontstage/authorization`: Permission union (25 capabilities), role
  bundles for 10 roles, scope-aware `hasPermission`. 11 unit tests passing,
  including tenant-mismatch denial and the "no client role holds an
  internal-only permission" invariant.
- Docs: README, architecture, domain model, authorization, security, roadmap,
  ADRs 0001–0004.

**Not yet built (next slices):** web app (Auth.js Google/Microsoft sign-in,
org creation/switcher, invitation accept flow), worker skeleton (outbox
drain + job runner), app connecting as `frontstage_app`, cross-tenant
integration test suite.

**Assumptions recorded:**

- OAuth apps (Google/Microsoft) will be registered by Cody when the web app
  slice lands; local dev can stub the provider list until credentials exist.
- Role definitions in code (ADR-0003) are acceptable for the pilot; custom
  roles are a later data-model addition.
- Port 5434 is free on this machine (5432/5433 occupied by other containers).
