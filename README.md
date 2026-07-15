# Frontstage

**Keep the work backstage. Keep clients in the loop.**

Frontstage gives clients a clear, secure view of product and engineering delivery
without exposing the team's internal workspace. Linear is the first and deepest
integration; the domain model is deliberately not coupled to it.

## Status

Phase 0 (Foundation) in progress. See [docs/progress.md](docs/progress.md) for
exactly what works today and [docs/roadmap.md](docs/roadmap.md) for the phase plan.

## Local development

Prerequisites: Node 20+, pnpm 9+, Docker.

```bash
pnpm install
pnpm db:up                 # Postgres on localhost:5434, Mailpit UI on :8025
cp .env.example packages/database/.env   # DATABASE_URL for migrations (owner role)
pnpm db:migrate            # apply migrations (includes RLS policies + app/worker roles)
pnpm test                  # unit tests + RLS cross-tenant probes (needs Postgres up)
pnpm typecheck
```

Run the apps (each needs its own env file; see `.env.example` for values):

```bash
# apps/web/.env.local — DATABASE_URL uses the frontstage_app role (RLS enforced),
# AUTH_SECRET, AUTH_URL/APP_URL, ENABLE_DEV_LOGIN=true until OAuth apps exist
cd apps/web && pnpm dev --port 3100

# apps/worker/.env — DATABASE_URL uses the frontstage_worker role, SMTP -> Mailpit
cd apps/worker && pnpm dev
```

Sign in at http://localhost:3100 (dev sign-in), invitation emails land in
Mailpit at http://localhost:8025.

## Repository layout

```
apps/            (Phase 0: web app and worker arrive next)
packages/
  database/      Prisma schema, migrations (incl. row-level security), client helpers
  authorization/ Capability-based permission model, role bundles, scope evaluation
docs/            Architecture, domain model, ADRs, roadmap, progress
```

## Key documents

- [Architecture](docs/architecture.md)
- [Domain model](docs/domain-model.md)
- [Authorization](docs/authorization.md)
- [Security](docs/security.md)
- [Roadmap](docs/roadmap.md)
- [ADRs](docs/adr/)
