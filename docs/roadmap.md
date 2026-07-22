# Roadmap

Single source of truth for delivery order. Phases follow the master brief
(§63); each phase is broken into vertical slices — a slice ships end-to-end
(schema → services → UI → tests → live verification → docs) before the next
begins. Detailed evidence for shipped work lives in [progress.md](progress.md).

Legend: ✅ shipped · 🔜 next up · ⬜ planned

---

## Phase 0 — Foundation ✅

Exit criteria (all verified): two organizations cannot access each other's
data · role scopes enforced · email-bound invitations work · jobs and outbox
process reliably.

- ✅ **0.1 Monorepo + tenancy core** — pnpm workspace, strict TS, Docker
  (Postgres 16 + Mailpit), Prisma schema (identity, orgs, memberships,
  scoped roles, invitations, audit, outbox, jobs, flags, idempotency),
  forced RLS + append-only audit, capability authorization package.
- ✅ **0.2 Web app + worker** — Auth.js (Google/Microsoft ready, dev login),
  org creation + switcher, invitation flow (email binding enforced by RLS,
  explicit POST accept), worker outbox drainer + job runner, invitation
  email via Mailpit.
- ✅ **0.3 Exit-criteria closure** — cross-tenant probe suite against a
  fresh migrated DB, structured logging + correlation ids end-to-end,
  invitation expiry sweep, `frontstage_worker` BYPASSRLS role, live
  outage/retry drill.

## Phase 1 — Linear projection ✅ (fixture mode)

Exit criteria (all verified): a Linear project becomes a curated
client-facing project · internal-only content does not leak · source changes
never silently overwrite client content.

- ✅ **1.1 Adapter boundary + projection pipeline** — integration-core
  canonical model, Linear adapter (OAuth app-actor, GraphQL discovery,
  HMAC webhooks, fixture workspace), source objects + snapshots, sync +
  5-min reconciliation, clients/portals, draft projections
  (internal-by-default), curation editor, divergence compare, client
  preview, publish to immutable snapshots, `projectClientView()` leak
  boundary with adversarial tests.
- ✅ **1.2 Review hardening** — error-message hygiene, minimal webhook
  payloads, discriminated unions, CAS + conflict policy on concurrent
  source updates, bidirectional divergence flags, schema constraints
  (unique workspace, RESTRICT on snapshots, RLS indexes).

Live-workspace validation still pends Linear OAuth app registration (see
parking lot).

## Phase 2 — Client collaboration ✅ (fixture mode)

Exit criteria met (see progress.md): a client submits a request → it
creates a (fixture) Linear Triage issue → internal and public communication
remain correctly separated, with three tested leak boundaries.

- ✅ **2.1 Clients get in the door** — portal memberships + client-role
  invitations (CLIENT_ADMIN/APPROVER/CONTRIBUTOR/VIEWER, reusing Phase 0
  invitation machinery scoped to portals), client-facing portal shell
  (`/portal/…`, simpler nav than the internal console), client overview
  rendering **published snapshots only**, org/portal context always
  visible, cross-client isolation probes added to the RLS suite.
- ✅ **2.2 Requests** — request forms per portal, client submission with
  idempotency key, initial state "Received — Not Yet Committed" with the
  no-commitment explainer, Linear Triage issue creation through the outbox
  (adapter gains `createWorkItem`; fixture mode simulates), client priority
  vs internal delivery priority stored separately, request list + detail
  for both sides.
- ✅ **2.3 Two-track communication** — public replies vs internal notes
  (structurally unreachable by client roles; adversarial leak tests like
  the projection boundary), request-for-clarification, formal accept /
  decline with reason, duplicate linking (link to existing Linear issue,
  close-as-duplicate with history), immediate notification emails via the
  outbox pipeline (digest preferences deferred to the notification system,
  Phase 4+).

## Phase 3 — Deliverables and approvals 🔜

Exit: a client approves an exact version · the approval survives a simulated
Linear outage · a material change invalidates only the new version.

- ✅ **3.1 Deliverables + versions** — portal-owned deliverables
  (identifier, scope, acceptance criteria, internal owner), source links,
  lifecycle (Draft → … → Approved → Delivered, kept separate), immutable
  version history frozen at ready-for-review with material content hashes.
  Client approver assignment moves to 3.3 with the approval flow.
- 🔜 **3.2 Attachments** — object-storage abstraction (S3-compatible,
  MinIO in dev), explicit publish-to-client copy with hash + immutable
  attachment versions, scan-state seam, short-lived signed URLs,
  tenant-scoped storage keys.
- ⬜ **3.3 Version-bound approval** — approval statement + optional
  conditions/comment, records identity/membership/auth context/version
  hash, commits atomically with audit + outbox, Linear comment side effect
  with "approval recorded / Linear sync pending" UI, retry surface.
- ⬜ **3.4 Material change + reapproval** — configurable material fields,
  editor confirms materiality (override requires reason + audit), material
  change creates an unapproved new version while prior approval history
  stays valid.

## Phase 4 — Delivery management ⬜

Exit: a client review meeting can be prepared, run, recorded, and published ·
outcomes flow back to Linear according to policy.

- ⬜ **4.1 Milestones + work packages** — client-facing milestones
  (no fake percentages), work packages grouping several source issues into
  one outcome, derived status with audited manual overrides.
- ⬜ **4.2 Health, updates, scheduled publication** — qualitative health
  with summary/reason/next action, internal-vs-published mismatch
  escalation timers, structured project updates, scheduling with frozen
  content + change warnings.
- ⬜ **4.3 Meetings** — agenda generation from open approvals/risks/
  requests, participant confirmation, driver mode (record decisions,
  approve deliverables, assign action items), post-meeting record,
  action-item routing to Linear per policy.

## Phase 5 — Intelligence and polish ⬜

Exit: coherent, documented, demonstrable, pilot-ready.

- ⬜ **5.1 AI drafting** — provider abstraction + one implementation,
  disabled by default, org + portal opt-in, only visibility-eligible input,
  per-claim source references ("why is this in the draft?"), human-only
  publish.
- ⬜ **5.2 Export + custom fields** — JSON/CSV/ZIP export (audited),
  custom request forms, controlled custom-field system.
- ⬜ **5.3 Demo** — failure-simulation controls (dev/demo only),
  resettable sandbox with Northline/Apex seed data, guided walkthrough
  covering the messy-internal → client-safe contrast.
- ⬜ **5.4 Hardening pass** — accessibility review, security review
  (including deferred items below), performance review, Playwright e2e
  suite across the pilot acceptance criteria (§64).

---

## Parking lot (deferred with reasons, revisit explicitly)

Needs Cody:
- Register Google + Microsoft OAuth apps (replaces dev login).
- Create the Linear OAuth app + webhook secret, then run the live-workspace
  validation pass against a dedicated test workspace.

Deferred engineering (tracked from reviews):
- Composite `(id, organization_id)` FKs + explicit Organization relations —
  batch integrity-hardening pass (RLS already enforces scoping).
- TIMESTAMPTZ column conversion — with the hardening pass.
- Revocable DB sessions + session-duration policies — with portal security
  policies (Phase 3+).
- Publication policy engine (`publication_policies` / approval chains /
  scheduled publication) — Phase 4.2 builds the first piece.
- Scheduler lease for multi-replica workers — when a second worker replica
  is actually deployed.
- Zero-downtime index strategy (CONCURRENTLY migrations) — production
  deployment runbook.
- Vitest v4 workspace upgrade — standalone chore PR.
