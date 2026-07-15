-- RLS for portal_memberships plus the client-access read path.

ALTER TABLE portal_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON portal_memberships
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- A client user can always see their own portal memberships (needed to
-- enumerate their portals before any org context exists).
CREATE POLICY user_reads_own_portal_memberships ON portal_memberships
  FOR SELECT USING (user_id = app_current_user_id());

-- A client user can see the portal rows they are an active member of --
-- mirrors member_reads_organization. Everything else a client reads goes
-- through org-context services that render published snapshots only.
CREATE POLICY client_member_reads_portal ON portals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM portal_memberships m
      WHERE m.portal_id = portals.id
        AND m.user_id = app_current_user_id()
        AND m.status = 'ACTIVE'
    )
  );
