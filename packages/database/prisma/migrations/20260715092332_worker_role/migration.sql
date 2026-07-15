-- Dedicated worker role with BYPASSRLS.
--
-- The worker is a trusted system component: it drains the cross-tenant
-- outbox/job tables and runs maintenance sweeps (e.g. expiring invitations
-- across all organizations), which is impossible under per-org RLS context.
-- The WEB APP must never use this role — it stays on frontstage_app.
-- Password is a dev default; override per environment.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'frontstage_worker') THEN
    CREATE ROLE frontstage_worker LOGIN PASSWORD 'frontstage_worker_dev' BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO frontstage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO frontstage_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO frontstage_worker;
