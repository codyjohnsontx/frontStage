# ADR-0003: Role definitions in code, scoped assignments in the database

Status: accepted · Date: 2026-07-15

## Decision

Role → permission bundles are constants in `@frontstage/authorization`
(`ROLE_PERMISSIONS`). The database stores only *assignments*:
(membership, roleKey, scopeType, scopeId) in `scoped_role_assignments`.
The brief's `roles` / `permissions` / `role_permissions` tables are deferred
until custom roles are actually built.

## Reasoning

- The pilot ships exactly ten predefined roles; putting their definitions in
  the database adds joins, seeds, and drift risk with zero pilot value.
- Bundles-in-code are unit-testable as invariants — e.g. the enforced rule
  that no client role contains an internal-only permission.
- The evaluation API (`hasPermission(context, permission, resource)`) is
  already shaped for custom roles: introducing them later means loading
  bundles from a table into the same `Record<RoleKey, Permission[]>` shape.
  Call sites never change because they check capabilities, not roles.

## Consequences

`RoleKey`/`ScopeType` are mirrored between the Prisma schema and the
authorization package (which stays database-independent). A sync test will
guard the mirror once the database package has a test setup.
