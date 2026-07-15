-- Tenant isolation for Phase 1 tables. webhook_events is deliberately NOT
-- org-scoped (infrastructure table processed cross-tenant by the worker,
-- like jobs/outbox_events).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'integration_connections',
    'source_objects',
    'source_object_snapshots',
    'client_organizations',
    'portals',
    'external_projects',
    'source_links',
    'external_work_items',
    'external_project_versions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

CREATE POLICY tenant_isolation ON integration_connections
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY tenant_isolation ON source_objects
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- Snapshots have no organization_id column; scope through the parent source.
CREATE POLICY tenant_isolation ON source_object_snapshots
  USING (EXISTS (
    SELECT 1 FROM source_objects s
    WHERE s.id = source_object_snapshots.source_object_id
      AND s.organization_id = app_current_organization_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM source_objects s
    WHERE s.id = source_object_snapshots.source_object_id
      AND s.organization_id = app_current_organization_id()
  ));

CREATE POLICY tenant_isolation ON client_organizations
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY tenant_isolation ON portals
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY tenant_isolation ON external_projects
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY tenant_isolation ON source_links
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY tenant_isolation ON external_work_items
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- Publication snapshots are immutable client history: no UPDATE/DELETE
-- policies (select+insert only), mirroring the audit_events posture.
CREATE POLICY tenant_isolation_select ON external_project_versions
  FOR SELECT USING (organization_id = app_current_organization_id());
CREATE POLICY tenant_isolation_insert ON external_project_versions
  FOR INSERT WITH CHECK (organization_id = app_current_organization_id());

CREATE OR REPLACE FUNCTION forbid_publication_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'external_project_versions is append-only; published snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER external_project_versions_append_only
  BEFORE UPDATE OR DELETE ON external_project_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_publication_snapshot_mutation();
