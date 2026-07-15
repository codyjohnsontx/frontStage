# Progress log

Honest record of what is actually built and verified. Newest first.

## 2026-07-15 — Phase 0 slice 2: web app, invitations end-to-end, worker

**Built:**

- `apps/web` (Next.js 15 App Router, strict TS): Auth.js v5 with Google +
  Microsoft providers (activate when OAuth credentials are set) plus a
  dev-only Credentials sign-in (hard-disabled in production). JWT sessions;
  revocable DB sessions remain a tracked gap. Pages: login, org list/create,
  org home with context chip + switcher, members (invite/revoke), invitation
  preview + explicit accept (POST, so email scanners cannot auto-accept).
- All tenant/identity queries run as the non-owner `frontstage_app` role via
  `withRlsContext` — the app now actually operates under RLS.
- Migration `identity_context_policies`: `app.current_user_id` /
  `app.current_user_email` GUCs. Users see their own memberships/orgs;
  invitations are visible **only** to the invited email — email binding is
  enforced at the database layer, not just in application code.
- `apps/worker`: outbox drainer (`FOR UPDATE SKIP LOCKED`) routes domain
  events to jobs; job runner with attempt caps, exponential backoff, and
  structured JSON logs; invitation email handler via SMTP/Mailpit.
- Domain services (`apps/web/src/server/`): organizations, invitations,
  authorization context loading, audit + outbox helpers, hashed single-use
  tokens. 6 new unit tests (tokens, slug); 17 total passing.

**Verified live in the browser (dev servers on :3100, Mailpit :8025):**

1. Dev sign-in as Cody → created "Northline Product Studio" (owner role,
   audit event, RLS org context).
2. Invited jordan@northline.dev as Contributor → invitation + audit + outbox
   committed atomically; worker delivered the email to Mailpit
   (outbox PROCESSED, job COMPLETED).
3. Opened the accept link **as Cody** → refused; the invitation row is
   invisible to the wrong identity (RLS email binding).
4. Signed in as Jordan → preview showed org/role → explicit accept →
   membership + contributor role assignment created; landed in the org.
5. Jordan (Contributor) tried to invite → "You do not have permission" —
   capability check (`organization.manage`) denied server-side.
6. Revisited the accept link → "already accepted" (single-use).
7. Database state confirmed: 3 audit events, outbox PROCESSED, job
   COMPLETED, invitation ACCEPTED.

**Environment notes:** the web app runs on port **3100** locally
(`pnpm dev --port 3100`) because ctxChat occupies :3000; AUTH_URL/APP_URL in
`apps/web/.env.local` point at 3100.

**Remaining for Phase 0 exit:** automated cross-tenant probe test suite
(two orgs, API-level attempts), invitation-expiry sweep job, structured
logging package, request-level correlation ids.

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
