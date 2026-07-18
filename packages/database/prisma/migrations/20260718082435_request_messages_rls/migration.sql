-- Tenant isolation for request_messages (same posture as client_requests:
-- forced RLS; client access is service-mediated after membership proof, and
-- INTERNAL_NOTE rows are additionally excluded at the application leak
-- boundary for client roles).

ALTER TABLE request_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON request_messages
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
