# Security

## Threat priorities (in order)

1. Cross-tenant data exposure (Client A sees Client B, or any client sees
   internal data).
2. Internal content leaking through projections (comments, estimates,
   internal labels/files reaching client responses or APIs).
3. Invitation abuse (forwarded invite accepted by the wrong identity).
4. Privilege escalation via client-supplied ids (org id in URL/form).
5. Audit tampering.

## Controls implemented (Phase 0)

- **Tenant isolation, two layers**: application queries always filter by
  `organizationId`; PostgreSQL RLS (FORCEd, keyed off transaction-local
  `app.current_organization_id`) is the backstop. Verified manually against
  the live dev database: the `frontstage_app` role sees zero rows without
  context and only its org's rows with context.
- **Append-only audit**: no UPDATE/DELETE RLS policies plus a trigger that
  raises even for table owners/superusers (verified).
- **Invitations** (schema level): bound to an email, hashed single-use token,
  expiry, revocation, role+scope fixed before acceptance. Acceptance flow
  (Phase 0 web app) must compare the authenticated email to the invitation
  email and reject mismatches.
- **No passwords**: Google/Microsoft OAuth only; sessions store token hashes.
- **Client-role invariant**: tested guarantee that no client role bundle
  contains an internal-only permission.

## Rules for all future code

- Authorization resolves from session + membership rows, never from
  client-supplied organization/portal ids.
- All sensitive checks are server-side.
- Secrets never in source control; OAuth/integration tokens encrypted at rest
  (Phase 1: libsodium sealed or AES-GCM with a KMS-style key from env).
- Signed, short-lived URLs for any published attachment; storage keys are
  structurally tenant-scoped.
- Logs carry correlation ids, never secrets or client content bodies.

## Additional controls (added later in Phase 0)

- The web app connects as `frontstage_app` (RLS enforced); the worker uses a
  separate `frontstage_worker` role with BYPASSRLS for cross-tenant queue
  processing and maintenance sweeps — never for request-serving code.
- Automated cross-tenant probe suite
  (`packages/database/test/rls.integration.test.ts`): 8 attacks against a
  freshly migrated test database run in `pnpm test`.
- Invitation expiry sweep: the worker expires overdue PENDING invitations
  every 60s and writes SYSTEM audit events.
- Correlation ids flow command → audit event → outbox → job → side-effect
  logs (`@frontstage/observability`).

## Known gaps (tracked, intentional at this phase)

- JWT sessions are not individually revocable; revocable DB sessions and
  session-duration policies arrive with portal security policies (Phase 1+).
- Dev-only credentials sign-in exists behind `ENABLE_DEV_LOGIN` and a
  production hard-disable; remove entirely once OAuth apps are registered.
- MFA: schema seam exists (`security_policies` planned Phase 1),
  enforcement later per brief.
- Integration tokens encryption-at-rest lands with the Linear connection
  work (Phase 1).
