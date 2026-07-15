-- Row-level security for tenant-owned tables, plus append-only enforcement
-- for audit_events. See docs/adr/0002-multi-tenancy-and-rls.md.
--
-- Strategy:
--  * The application connects as a dedicated non-superuser role
--    (frontstage_app) that does NOT own the tables, so RLS applies to it.
--  * Every tenant-scoped transaction sets app.current_organization_id via
--    set_config(..., true); policies compare against it.
--  * FORCE ROW LEVEL SECURITY makes policies apply even to the table owner,
--    protecting local dev where migrations and app share a role.

-- Application runtime role (idempotent; password managed per environment).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'frontstage_app') THEN
    CREATE ROLE frontstage_app LOGIN PASSWORD 'frontstage_app_dev';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO frontstage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO frontstage_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO frontstage_app;

-- Helper: current organization from transaction-local GUC (NULL when unset).
CREATE OR REPLACE FUNCTION app_current_organization_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Tenant-scoped tables: rows visible/writable only within the active org.
-- users / auth_accounts / sessions are identity-level (cross-org) and are
-- protected by application logic, not org RLS.
-- ---------------------------------------------------------------------------

-- organizations: the org row itself is only visible in its own context.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON organizations
  USING (id = app_current_organization_id());

ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_memberships
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

ALTER TABLE scoped_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoped_role_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scoped_role_assignments
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_records
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- audit_events: tenant-isolated AND append-only.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON audit_events
  FOR SELECT USING (organization_id = app_current_organization_id());
CREATE POLICY tenant_isolation_insert ON audit_events
  FOR INSERT WITH CHECK (organization_id = app_current_organization_id());
-- No UPDATE/DELETE policies: with RLS forced, those statements match no rows.

-- Belt and suspenders: reject UPDATE/DELETE on audit_events at trigger level
-- so even table owners / superusers get a loud error instead of a rewrite.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; corrections must be new corrective events';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- ---------------------------------------------------------------------------
-- Infrastructure tables (jobs, outbox_events, feature flags) are processed by
-- the worker across organizations; they are NOT org-scoped by RLS. The worker
-- runs with its own role and payloads carry organization_id for scoping when
-- side effects execute.
-- ---------------------------------------------------------------------------
