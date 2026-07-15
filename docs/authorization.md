# Authorization

## Model

Capability-based. Domain services ask "does this actor have
`deliverable.approve` on this resource?" — never "is this actor a Portal
Admin?". Roles are predefined permission bundles; custom roles can arrive
later as data without rewriting call sites.

Three pieces:

1. **Permissions** — the `Permission` union in
   `packages/authorization/src/permissions.ts` (25 capabilities, from
   `organization.manage` to `audit.view`).
2. **Roles** — `ROLE_PERMISSIONS` bundles for the ten predefined roles
   (6 internal, 4 client). `INTERNAL_ONLY_PERMISSIONS` is a tested invariant:
   no client role may ever include one.
3. **Scoped assignments** — the database stores who has which role at what
   scope: `ORGANIZATION` (scopeId null), `CLIENT_ORGANIZATION`, `PORTAL`, or
   `PROJECT`.

## Evaluation

`hasPermission(context, permission, resource)`:

1. Hard tenant check: `resource.organizationId === context.organizationId`,
   else deny — regardless of roles.
2. An assignment covers the resource when its scope matches
   (org-wide covers everything; portal/project scopes must match ids exactly;
   a scoped assignment with a null scopeId matches nothing).
3. The covering role's bundle must include the permission.

The context is always built server-side from the authenticated session plus
membership/role rows. Never from ids supplied in a form or URL.

## Read access

Write capabilities are modeled as permissions. Read access for client roles is
governed by the **visibility layer** (Phase 1): internal/client-visible/
client-actionable/selected-audience states on projected content.
`CLIENT_VIEWER` therefore has an intentionally empty permission bundle.

## Role bundle summary

- `ORGANIZATION_OWNER` / `ORGANIZATION_ADMIN` — all capabilities today; owner
  is a distinct role because billing, ownership transfer, and org deletion
  (future capabilities) will be owner-only.
- `PORTAL_ADMIN` — portal management, membership, full project/deliverable/
  update lifecycle, triage, meetings, portal-scoped audit view.
- `PROJECT_LEAD` — edit/publish/health on their scope, deliverables, updates,
  meetings, triage.
- `CONTRIBUTOR` — draft updates, comment (incl. internal notes), triage
  assigned requests; cannot publish.
- `INTERNAL_VIEWER` — read-only (`project.history.view`).
- `CLIENT_ADMIN` — submit requests, comment (+ client-user management, which
  becomes a distinct capability in Phase 2).
- `CLIENT_APPROVER` — additive: `deliverable.approve` plus contributor rights.
- `CLIENT_CONTRIBUTOR` — submit requests, comment.
- `CLIENT_VIEWER` — no write capabilities.

Enforcement layers: capability check in domain services (this package) →
tenant scoping on queries → PostgreSQL RLS as backstop (ADR-0002).
