# Linear integration

## Boundary

The domain never imports Linear types. `@frontstage/integration-core` defines
canonical types (`CanonicalProject`, `CanonicalWorkItem`, six-value
`CanonicalStateType`) and the `WorkSystemAdapter` interface;
`@frontstage/linear-adapter` maps Linear's GraphQL API into them. A future
Jira/GitHub adapter implements the same interface.

## Modes

- **oauth** (production): OAuth 2.0 with `actor=app` so mutations are
  attributed to the integration, not the installing admin. Tokens are
  AES-256-GCM encrypted at rest (`INTEGRATION_TOKEN_KEY`, 32-byte base64 env
  key; see `token-crypto.ts`). GraphQL access uses plain fetch with cursor
  pagination and a 429 guard that defers to job retry/backoff.
  Requires `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET`; the callback route is
  `/api/integrations/linear/callback` with an HttpOnly state cookie.
  **Not yet exercised against a live workspace** — no OAuth app registered.
- **fixture** (dev/demo, gated behind `ENABLE_DEV_LOGIN` + non-production):
  official-shaped demo workspace (2 projects, 10 realistically messy
  engineering issues) served by the same adapter interface. This is how the
  whole pipeline is verified locally.

## Data flow

1. **Sync / reconciliation** (worker `integration.sync` job): list projects +
   issues → upsert `source_objects` keyed by (connection, externalId) with a
   curation-relevant `contentHash` → snapshot on every content change →
   archive anything the provider stopped returning (`lastSeenAt < syncStart`)
   and flag its projections. Scheduled reconciliation re-enqueues sync for
   every non-disconnected connection every 5 minutes — webhooks are not the
   only reliability mechanism.
2. **Webhooks** (`POST /api/webhooks/linear`): verify HMAC-SHA256
   (`linear-signature`, constant-time compare) + 60s timestamp replay bound →
   dedupe on delivery id (or body hash) via a unique key → persist a minimal
   `webhook_events` row → ack → worker re-fetches current source state from
   the API (webhook bodies are never trusted as source of truth). Duplicate
   deliveries ack with `{duplicate: true}`.
3. **Divergence**: when a source's `contentHash` changes, linked
   `external_work_items` whose `curatedHash` differs get `sourceChanged=true`.
   Curated client content is never modified by sync — a human applies or
   ignores each change (audited either way).

## Simulation

The Integrations page (dev only) can inject a fabricated `Issue.update`
through the same `webhook_events` → `webhook.process` path as a real
delivery, driving the divergence workflow end-to-end without credentials.

## Going live checklist

1. Create an OAuth app in Linear (Settings → API), set
   `LINEAR_CLIENT_ID/SECRET`, generate `INTEGRATION_TOKEN_KEY`.
2. Register a webhook pointing at `/api/webhooks/linear`, set
   `LINEAR_WEBHOOK_SECRET`.
3. Connect from the Integrations page; first sync runs automatically.
4. Run the live-workspace test pass (OAuth, discovery, webhook, reconcile)
   against a dedicated test workspace — never a customer workspace.
