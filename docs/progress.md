# Progress log

Honest record of what is actually built and verified. Newest first.

## 2026-07-15 — Phase 1: Linear projection pipeline

**Built:**

- `@frontstage/integration-core`: canonical model (`CanonicalProject`,
  `CanonicalWorkItem`, `WorkSystemAdapter`), simplified status mapping with
  per-portal overrides, curation-relevant content hashing, AES-256-GCM token
  crypto. The domain never sees provider types.
- `@frontstage/linear-adapter`: real OAuth (app actor, token exchange),
  GraphQL discovery with pagination + 429 guard, HMAC webhook verification
  (constant-time, 60s replay bound), and a fixture mode serving an
  official-shaped demo workspace (2 projects, 10 messy engineering issues)
  gated to dev.
- Schema + forced RLS for: integration_connections, source_objects (+
  append-only-ish snapshots), webhook_events (infrastructure, cross-tenant),
  client_organizations, portals, external_projects, source_links,
  external_work_items, external_project_versions (append-only via trigger,
  like audit_events).
- Worker: `integration.sync` (discovery + upsert + snapshot + archive
  detection), `webhook.process` (re-fetches real sources; trusts payloads
  only for dev simulations), scheduled reconciliation every 5 minutes.
- Web: Integrations page (fixture connect / OAuth start + callback / sync
  now / dev change simulation), Clients page (client orgs with identifier
  prefixes + portals), portal page (draft generation from Linear sources),
  projection editor (client name/summary/health, per-item visibility +
  client titles, divergence comparison with apply/keep decisions,
  publish), client preview (draft and published-snapshot views).
- `projectClientView()` pure leak boundary + 6 adversarial unit tests
  (internal titles, labels, estimates, assignees, state names, source ids
  cannot survive into client output). 51 tests passing workspace-wide.

**Verified live (fixture mode, browser + worker + Postgres):**

1. Connected the demo workspace → sync discovered 2 projects / 10 issues
   (12 source objects + snapshots).
2. Created client "Apex Health" (APEX) and portal "Credentialing
   Modernization".
3. Generated draft APEX-PRJ-001 → all 8 work items INTERNAL; client preview
   showed "Nothing is shared with the client yet" and zero leaked strings
   (psync/pwned/SPIKE/estimates/assignees all absent).
4. Curated: client-safe name/summary, health On Track, 4 items made visible,
   2 titles rewritten (e.g. ENG-42 → "Improve credential-verification
   reliability").
5. Preview showed exactly the 4 curated items with mapped statuses
   (In Progress / Planned), no internal identifiers.
6. Published v1 → immutable snapshot recorded.
7. Simulated a Linear-side change to ENG-42 through the real webhook path →
   worker processed it → work item flagged `sourceChanged`, curated title
   untouched, published v1 snapshot byte-identical. Nothing silently
   overwritten.

**Phase 1 exit criteria:** a (fixture) Linear project became a curated
client-facing project — verified; internal-only content does not leak —
verified in preview, snapshot, and unit tests; source changes never silently
overwrite client content — verified through the webhook + divergence flow.

**Known limitations (tracked in docs/publication-engine.md):**

- Real-workspace OAuth flow is implemented but unexercised until a Linear
  OAuth app is registered.
- Publish-confirm is the approval step; the publication policy engine is
  future work.
- Stateless-fixture quirk: the 5-minute reconciliation "reverts" simulated
  changes to fixture canon (creating an extra snapshot) since the fixture
  provider always reports original content. The human-review flag correctly
  persists until resolved. Real providers do not have this behavior.

## 2026-07-15 — Phase 0 slice 3: Phase 0 exit criteria closed

**Built:**

- `packages/database/test/rls.integration.test.ts` — cross-tenant probe
  suite. Provisions a fresh `frontstage_test` database, applies every
  migration via `prisma migrate deploy`, seeds two orgs as owner, then
  attacks RLS as the `frontstage_app` role: no-context blindness, org-scoped
  reads, WITH CHECK rejection of cross-org writes, zero-row cross-org
  updates, identity-scoped visibility, invitation email binding, audit
  append-only (owner included). 8 tests, all passing.
- `packages/observability` — structured JSON logger with child contexts and
  correlation ids (4 unit tests).
- Correlation ids flow through the whole pipeline: domain command → audit
  event → outbox event → job envelope → side-effect logs. Job payloads are
  now `{ correlationId, data }` envelopes.
- Worker: invitation-expiry sweep (every 60s) — expires overdue PENDING
  invitations across all orgs and writes SYSTEM audit events atomically.
- Migration `worker_role`: `frontstage_worker` with BYPASSRLS for the worker
  only (trusted system component; documented in ADR-0002). Worker switched
  off `frontstage_app`.

**Verified live:**

- Planted an invitation with a past expiry → sweep marked it EXPIRED and
  wrote the `invitation.expired` SYSTEM audit event within one cycle.
- Inserted an outbox event with correlation id `corr-test-123` → the same id
  appeared in `outbox_event_routed`, `invitation_email_sent`, and
  `job_completed` log lines; email delivered to Mailpit.
- Full suite: 29 tests passing (11 authorization, 8 RLS integration,
  6 web, 4 observability); typecheck clean; production build passes.

**Phase 0 exit criteria status:**

- Two organizations cannot access each other's data — **verified**
  (automated probe suite + live browser test).
- Role scopes are enforced — **verified** (unit tests + live contributor
  denial).
- Email-bound invitations work — **verified** (live flow + DB-level binding
  tests).
- Jobs and outbox events process reliably — **verified**, including the
  failure path: with Mailpit stopped, the email job failed with
  ECONNREFUSED, returned to PENDING with attempts=1, the error captured, and
  a backoff scheduled; after Mailpit restarted, the retry (attempt 2)
  completed and the email was delivered. Correlation id `corr-drill-1`
  traceable across every log line.

Remaining before Phase 1 features land: OAuth app registration (Google /
Microsoft) when Cody is ready — dev sign-in covers local work until then.

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
