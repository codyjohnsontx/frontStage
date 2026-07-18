# Progress log

Honest record of what is actually built and verified. Newest first.

## 2026-07-18 — Slice 2.3: two-track communication (Phase 2 complete)

**Built:**

- `request_messages` (forced RLS): one thread per request with four kinds —
  PUBLIC_REPLY, INTERNAL_NOTE, CLARIFICATION_REQUEST, CLIENT_MESSAGE.
  Internal notes are structurally unreachable by client roles: they never
  get outbox events (no Linear forward, no email) and `messagesClientView()`
  — the third leak boundary — drops them entirely (body, author, existence)
  and strips Linear sync fields from everything else, with adversarial
  tests.
- §28 default routing: client-visible messages forward to the linked Linear
  issue as comments through the outbox (`adapter.addComment`: real
  commentCreate + fixture). Retries cover the message-before-issue race;
  a permanently failed issue parks the comment FAILED.
- Formal decisions (§27): accept (optional note) / decline (reason
  required, client-visible), recorded on the request + posted to the thread
  + emailed. Duplicate handling: close-as-duplicate links to another
  request on the portal with history preserved and a client-facing merge
  note; link-to-existing-Linear-issue redirects future thread forwards.
- Clarification requests flag "needs your input" on the client side; first
  client-visible response moves RECEIVED → IN_REVIEW.
- Immediate notification emails to the requester (reply / clarification /
  decision / merge) through the outbox → email pipeline. Digest preferences
  remain future work with the notification system (Phase 4+), consistent
  with §32's immediate-by-default list for action-required events.
- Internal request detail page (thread with visually distinct internal
  notes, reply/note/clarify forms, decision + duplicate + Linear-link
  tools); client detail page gains the thread, reply form
  (comment.create roles), decision banner, and merge note.

**Verified live (scripted HTTP, dev servers on :3100):**

1. Public reply + clarification forwarded to Linear as fixture comments;
   the internal note was NOT forwarded and produced no email.
2. First client-visible reply moved APEX-REQ-001 RECEIVED → IN_REVIEW.
3. Dana's page showed the reply + clarification; leak sweep found no
   SECRET-NOTE, no psync, no ENG-42, no comment ids.
4. Dana replied; the CLIENT_MESSAGE forwarded to Linear.
5. REQ-002 declined with a reason → Dana sees "Declined" + the reason;
   REQ-003 closed as duplicate of REQ-001 → Dana sees the merge note with a
   link. Both generated immediate emails (4 total in Mailpit).

**Test suite:** 68 passing (thread leak-boundary + decision-visibility
tests added). Phase 2 exit criteria all verified: request → real (fixture)
Linear Triage issue; internal and public communication correctly separated.

## 2026-07-16 — Slice 2.2: client requests → Linear Triage

**Built:**

- `client_requests` table (forced RLS + composite tenant FK to portals):
  identifier (APEX-REQ-NNN from an atomic per-client counter), type/status
  enums, SEPARATE client priority and internal priority, internal-only
  Linear linkage columns (issue id/identifier, sync state, sync error).
- Adapter `createWorkItem`: real Linear `issueCreate` mutation (requires a
  destination team via the new `defaultTeamId` connection column) and a
  fixture mode returning official-shaped references.
- Submission pipeline: client submits → request committed immediately with
  status "Received — Not Yet Committed" + audit + outbox event, all atomic;
  worker job `linear.create_issue` creates the Triage issue with retry/
  backoff; a missing connection parks the request FAILED (visible
  internally, never to clients). Idempotency keys (§44): same key + same
  content returns the original identifier; same key + different content is
  rejected.
- `requestClientView()` — second leak boundary, mirroring the projection
  one: internal priority, Linear ids, and sync errors exist on the input
  type and provably never reach client output (adversarial unit tests).
- Client UI: Requests nav, list, submission form (with the no-commitment
  explainer), detail page. View-only roles see an explanation instead of a
  form and are rejected server-side.
- Internal UI: "Client requests" card on the portal page — requester,
  type/status, client priority, internal priority setter (request.triage),
  Linear ref + sync state.

**Verified live (scripted HTTP, dev servers on :3100):**

1. Dana (CLIENT_CONTRIBUTOR) submitted a bug → 303 to APEX-REQ-001, status
   "Received — Not Yet Committed".
2. Worker created fixture Triage issue TRI-78CA; request SYNCED; one
   correlation id across submit → outbox → job → log.
3. Idempotent resubmit (same key) returned the same identifier; row count
   stayed 1.
4. Client detail page leak check: no Linear identifiers, no sync state, no
   internal priority (the only "sync" match was the HTML async attribute).
5. Carol (CLIENT_VIEWER): form replaced by a view-only notice AND the
   direct POST rejected server-side.
6. Cody set internal priority LOW while client priority stayed HIGH; both
   visible internally, audit events recorded for submit + triage.

**Test suite:** 65 passing (adds request leak-boundary tests + 2
client_requests RLS probes incl. the composite-FK cross-portal rejection).

**Note:** the live-drill session-drop mystery was the test harness invoking
the layout's sign-out action (first $ACTION_ID on the page), not an app
bug.

## 2026-07-15 — Slice 2.1: clients get in the door

**Built:**

- `portal_memberships` table + forced RLS: tenant isolation, user-reads-own
  policy, and a `client_member_reads_portal` policy so a client can resolve
  their portal before any org context exists. Client users NEVER become
  members of the host organization — separate membership model.
- Client-role invitations: portal-scoped (CLIENT_ADMIN/APPROVER/
  CONTRIBUTOR/VIEWER only), reusing the email-bound single-use machinery;
  acceptance branches to create a PortalMembership and redirects to the
  client portal. Portal-scoped invitations are revocable with
  `portal.members.manage` (org-manage no longer required).
- Internal portal page: "Client access" card — invite client, list/remove
  members, revoke pending invitations.
- Client portal shell (`/portal/[slug]`): simpler nav, always-visible
  context (portal, client org, host org), overview listing PUBLISHED
  projects only (rendered purely from immutable snapshots), project detail
  with publication history. `/orgs` lists client portals and redirects pure
  client users straight to their portal.
- `loadAuthorizationContext` deliberately stays internal-only (a client
  membership must not pass the internal-console membership gate); client
  flows prove access via PortalMembership in `client-portal.ts`.
- 5 new cross-client isolation probes in the RLS suite (59 tests total):
  client sees only their own memberships/portal, other portals invisible
  even by direct slug, org-context scoping, cross-org write rejection,
  and client identity context reads zero internal tables.

**Verified live (scripted HTTP end-to-end, servers on :3100):**

1. Portal-scoped CLIENT_VIEWER invitation for carol@apex-health.test →
   preview correctly says "the Credentialing Modernization client portal".
2. Carol signed in (dev login), accepted via the server action → 303 to
   `/portal/apex-health-credentialing-modernization?joined=1`.
3. Overview shows APEX-PRJ-001 (curated name, On track); project page
   renders the published snapshot (curated titles, mapped statuses).
4. Leak check across both client pages: zero internal strings (psync,
   SPIKE, assignees, ENG ids, estimates all absent).
5. Access control: internal org page → 404 for Carol; unknown portal →
   404; `/orgs` → 307 straight to her portal.
6. Internal Client access card lists Carol as client viewer; re-visiting
   the invite link says "already accepted" (single-use).

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
