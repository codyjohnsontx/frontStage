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

## Known gaps (tracked, intentional at this phase)

- The dev superuser (`frontstage`) bypasses RLS by design; production app
  connections must use the non-owner `frontstage_app` role. Wiring the app to
  connect as `frontstage_app` happens with the web app slice.
- `withOrganizationContext` exists but nothing enforces its use yet; an
  integration test suite (cross-tenant probes) lands with the first API
  routes.
- MFA/session-duration policies: schema seam exists (`security_policies`
  planned Phase 1), enforcement later per brief.
