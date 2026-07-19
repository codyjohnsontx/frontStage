-- Tenant isolation for deliverables and their frozen versions. Client reads
-- are service-mediated after portal-membership proof, then run under the
-- host organization context (same posture as client_requests).

ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deliverables
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

ALTER TABLE deliverable_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverable_source_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deliverable_source_links
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- Frozen versions are immutable client-facing history (§35): select+insert
-- only, with a trigger backstop like audit_events and publication snapshots.
ALTER TABLE deliverable_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverable_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON deliverable_versions
  FOR SELECT USING (organization_id = app_current_organization_id());
CREATE POLICY tenant_isolation_insert ON deliverable_versions
  FOR INSERT WITH CHECK (organization_id = app_current_organization_id());

CREATE OR REPLACE FUNCTION forbid_deliverable_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deliverable_versions is append-only; frozen versions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deliverable_versions_append_only
  BEFORE UPDATE OR DELETE ON deliverable_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_deliverable_version_mutation();
