# Roadmap

Phases follow the master brief (§63). Exit criteria are quoted per phase.

## Phase 0 — Foundation (current)

Monorepo, Docker dev env, Postgres, Prisma, auth (Google/Microsoft),
organizations, memberships, org switcher, invitations, capability
authorization, initial RLS, audit foundation, Postgres queue, outbox,
feature flags, logging.

Exit: two orgs cannot access each other's data; role scopes enforced;
email-bound invitations work; jobs and outbox process reliably.

Done so far: workspace + Docker + schema + RLS (verified) + authorization
package (tested). Next: web app scaffold with Auth.js (Google/Microsoft),
org creation/switcher, invitation flow end-to-end, worker skeleton draining
outbox/jobs.

## Phase 1 — Linear projection

Linear OAuth (app actor), connection management, discovery, webhooks,
snapshots, reconciliation, client orgs, portals, draft external projections,
visibility controls, status mapping, source comparisons, preview, first
publication, publication snapshots.

## Phase 2 — Client collaboration

Client membership + invitations, client overview, requests → Linear Triage,
dual priority, public replies vs internal notes, clarification/accept/decline,
duplicates, comment routing, notifications.

## Phase 3 — Deliverables and approvals

Deliverables, versions, acceptance criteria, attachments, review flow,
version-bound approval, conditions, material-change detection, reapproval,
Linear approval action via outbox, retry UI.

## Phase 4 — Delivery management

Milestones, work packages, derived statuses + overrides, health + escalation,
project updates, scheduled publication, meetings, decisions, action items,
Linear action routing.

## Phase 5 — Intelligence and polish

AI provider abstraction + one implementation, source-backed drafting, export,
custom request forms, custom fields, failure simulation, interactive demo,
accessibility/security/performance passes.
