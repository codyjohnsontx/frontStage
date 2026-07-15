# Publication engine (Phase 1 scope)

## Model

```text
SourceObject (Linear project/issue, canonical + content hash + snapshots)
   ↑ source_links (primary marked)          ↑ external_work_items.sourceObjectId
ExternalProject (APEX-PRJ-001, client name/summary/health, DRAFT→PUBLISHED→ARCHIVED)
   └── ExternalWorkItem (clientTitle/clientDescription, visibility, curatedHash, sourceChanged)
   └── ExternalProjectVersion (immutable published snapshots, append-only via RLS + trigger)
```

## Rules enforced

- **Internal by default (§6.1)**: draft generation creates every work item
  with `visibility=INTERNAL`. The client view of an uncurated draft is empty.
- **The leak boundary**: everything client-facing renders through
  `projectClientView()` (`apps/web/src/server/projection-view.ts`) — a pure
  function whose output type simply has no fields for estimates, assignees,
  labels, internal titles/descriptions, state names, or source ids. Unit
  tests feed it hostile input and assert none of it survives serialization.
- **Simplified statuses (§21)**: canonical state type → client status via
  `DEFAULT_STATUS_MAPPING`, per-portal JSON override, invalid overrides fall
  back rather than leaking raw state, unknown state types degrade to
  "Planned".
- **No silent overwrites (§6.2, §17)**: sync/webhooks only flag divergence
  (`sourceChanged`). The editor shows curated-vs-source comparison with
  explicit "update from source" / "keep curated" decisions, both audited.
- **Immutable snapshots (§35)**: publishing freezes the exact client view as
  `external_project_versions` (append-only at the database level, like
  audit_events). Draft edits after publish do not change what clients see
  until the next publish.
- **Archival continuity (§34)**: sources that disappear from the provider are
  marked archived; their projections show a continuity note instead of
  vanishing.
- **Identifiers (§14)**: `PREFIX-PRJ-NNN` allocated from an atomic per-client
  counter; internal UUIDs never appear client-side.

## Simplifications (tracked)

- Publication approval: the publish confirmation is the internal approval
  step. The policy engine (`publication_policies` / `publication_requests`,
  scheduled publication, approval chains) is Phase 2+ work.
- Client preview renders the single client view; per-role previews
  (admin/approver/contributor/viewer) become meaningful once client roles can
  act (Phase 2 requests/approvals).
- Project-level source divergence (name/date changes on the Linear project
  itself) is stored via snapshots but not yet surfaced in the editor;
  work-item divergence is fully wired.
