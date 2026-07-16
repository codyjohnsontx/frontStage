-- Tenant isolation for client_requests. Client reads/writes run through
-- services that prove portal membership first, then operate under the host
-- org context (same pattern as the client portal reads).

ALTER TABLE client_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON client_requests
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
