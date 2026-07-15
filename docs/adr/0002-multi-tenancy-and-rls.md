# ADR-0002: Multi-tenancy via app-level scoping + PostgreSQL RLS

Status: accepted · Date: 2026-07-15

## Decision

Single database, shared schema. Every tenant-owned row carries
`organization_id`. Two enforcement layers:

1. Application: every query filters by the organization resolved from the
   authenticated session; tenant-scoped work runs inside
   `withOrganizationContext`, which sets the transaction-local GUC
   `app.current_organization_id`.
2. Database: RLS policies (`FORCE ROW LEVEL SECURITY`) compare
   `organization_id` to that GUC. The app connects as `frontstage_app`, a
   non-owner role without BYPASSRLS. Migrations run as the owner.

`audit_events` additionally has no UPDATE/DELETE policies and a trigger that
raises on mutation, making it append-only for everyone including owners.

Worker-infrastructure tables (`jobs`, `outbox_events`, flags) are not
org-scoped by RLS; payloads carry `organization_id` and the worker re-enters
org context when executing side effects.

## Reasoning

RLS alone is easy to get wrong silently (superuser bypass, forgotten GUC —
which fails closed to zero rows); app-level scoping alone dies to one missed
`where`. Together, a bug in either layer is contained by the other.
Database-per-tenant is operationally unjustifiable at pilot scale.

## Verification

Live-tested 2026-07-15: `frontstage_app` sees 0 organizations without
context, exactly one with context set, and audit mutation raises even as
superuser. Automated cross-tenant probe tests land with the first API routes.
