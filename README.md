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
cp .env.example packages/database/.env   # adjust if needed
pnpm db:migrate            # apply migrations (includes RLS policies)
pnpm test
pnpm typecheck
```

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
