# Domain model

## Hierarchy

```
Organization (tenant root — every tenant-owned row carries organizationId)
├── Internal memberships + scoped role assignments
├── Integration connections (Phase 1)
├── Client Organizations (Phase 1)
│   └── Portals (Phase 1)
│       ├── External projects → milestones, work packages, deliverables,
│       │   updates, meetings, decisions, action items (Phases 1–4)
│       ├── Request forms + client requests (Phase 2)
│       └── Publication policies, audit events
└── Service accounts (later)
```

## System-of-record boundaries

- **Linear owns internal execution**: issues, workflow states, cycles,
  estimates, internal comments/labels/attachments. Frontstage stores these
  only as `source_objects` + snapshots for projection and divergence
  detection.
- **Frontstage owns external delivery**: client orgs, portals, memberships,
  external project identities, client-safe names/descriptions/statuses,
  health, milestones, deliverables + versions + approvals, work packages,
  requests, client comments, meetings, decisions, updates, publication
  snapshots, audit history.

## Phase 0 entities (implemented)

| Entity | Notes |
| --- | --- |
| `users`, `auth_accounts`, `sessions` | Identity is global; one user can belong to many orgs. Google/Microsoft OAuth only. |
| `organizations` | Tenant root. Soft-delete via `deletedAt`. |
| `organization_memberships` | User ↔ org, status ACTIVE/SUSPENDED. |
| `scoped_role_assignments` | (membership, roleKey, scopeType, scopeId). Role → permission bundles live in code (ADR-0003). |
| `invitations` | Email-bound, single-use (hashed token), expiring, revocable, role+scope assigned before acceptance. |
| `audit_events` | Append-only (RLS + trigger). Corrections are new corrective events. |
| `outbox_events`, `jobs` | Transactional outbox + Postgres-backed queue (ADR-0004). |
| `feature_flags` + overrides | Targeting by environment/org/portal/user. |
| `idempotency_records` | Unique (org, operation, key) with request hash; duplicate requests return the original result. |

## Identifier policy

Internal ids are UUIDs and are never exposed to clients. Client-facing
entities (Phase 1+) get readable identifiers like `APEX-PRJ-004`, generated
per portal/client scope with configurable prefixes.

## Enum-mirroring note

`RoleKey` and `ScopeType` exist both as Prisma enums and as TypeScript unions
in `@frontstage/authorization` (which must stay dependency-free of the
database package). A future test will assert the two stay in sync.
