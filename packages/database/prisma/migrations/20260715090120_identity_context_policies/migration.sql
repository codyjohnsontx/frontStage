-- Identity-context RLS policies.
--
-- Some legitimate queries happen BEFORE an organization context exists:
--   * "Which organizations does the signed-in user belong to?" (org switcher)
--   * "Is this invitation addressed to the signed-in user's email?" (accept)
--
-- These run under transaction-local identity GUCs set from the VERIFIED
-- session (never from client input):
--   app.current_user_id    — authenticated user's id
--   app.current_user_email — authenticated user's email
--
-- Policies below are permissive and OR with the existing tenant policies.

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_current_user_email() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_user_email', true), '');
$$ LANGUAGE sql STABLE;

-- A user can always see their own membership rows (needed to enumerate orgs).
CREATE POLICY user_reads_own_memberships ON organization_memberships
  FOR SELECT USING (user_id = app_current_user_id());

-- A user can see the organization rows they are a member of.
CREATE POLICY member_reads_organization ON organizations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = app_current_user_id()
    )
  );

-- Invitations are visible to (and acceptable by) the invited email only.
-- This enforces email binding at the database layer: a forwarded invitation
-- is invisible to any other authenticated identity.
CREATE POLICY invitee_reads_invitation ON invitations
  FOR SELECT USING (lower(email) = lower(app_current_user_email()));

CREATE POLICY invitee_updates_invitation ON invitations
  FOR UPDATE
  USING (lower(email) = lower(app_current_user_email()))
  WITH CHECK (lower(email) = lower(app_current_user_email()));
