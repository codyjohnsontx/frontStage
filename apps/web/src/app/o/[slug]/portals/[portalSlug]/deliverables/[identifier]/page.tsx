import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPortalBySlug } from "@/server/clients";
import {
  allowedTransitions,
  getDeliverableInternal,
  getMyDeliverablePermissions,
  isEditableStatus,
} from "@/server/deliverables";
import { DELIVERABLE_STATUS_LABELS } from "@/server/deliverable-view";
import {
  toggleSourceLinkAction,
  transitionDeliverableAction,
  updateDeliverableAction,
} from "../actions";

export default async function DeliverableDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; portalSlug: string; identifier: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { slug, portalSlug, identifier } = await params;
  const { error, saved } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();
  const portal = await getPortalBySlug(user, org.id, portalSlug);
  if (!portal) notFound();
  const found = await getDeliverableInternal(user, org.id, portal.id, identifier);
  if (!found) notFound();
  const { deliverable: d, availableSources } = found;
  const permissions = await getMyDeliverablePermissions(user, org.id, portal.id);

  // Mirror transitionDeliverable's rule: publishing to the client requires
  // deliverable.publish; every other move requires deliverable.edit. The
  // server re-asserts on submit — this only hides unusable buttons.
  const visibleTransitions = allowedTransitions(d.status).filter((target) =>
    target === "READY_FOR_REVIEW" ? permissions.canPublish : permissions.canEdit,
  );

  const editable = isEditableStatus(d.status);
  const linkedIds = new Set(d.sourceLinks.map((l) => l.sourceObjectId));
  const hidden = (
    <>
      <input type="hidden" name="slug" value={org.slug} />
      <input type="hidden" name="portalSlug" value={portal.slug} />
      <input type="hidden" name="identifier" value={d.identifier} />
    </>
  );

  return (
    <>
      <p className="muted" style={{ marginBottom: 0 }}>
        <Link href={`/o/${org.slug}/portals/${portal.slug}/deliverables`}>← Deliverables</Link> ·{" "}
        {d.identifier} · <span className="role-tag">{DELIVERABLE_STATUS_LABELS[d.status] ?? d.status}</span>
        {d.currentVersion > 0 && <span className="role-tag">v{d.currentVersion} frozen</span>}
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{d.title}</h1>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">Draft saved.</div>}
      {!editable && (
        <div className="error-banner" style={{ background: "#eef2f7", borderColor: "#d5dee9", color: "var(--accent)" }}>
          Content is frozen while this deliverable is{" "}
          {(DELIVERABLE_STATUS_LABELS[d.status] ?? d.status).toLowerCase()}. Move it back to In
          Progress to edit.
        </div>
      )}

      <div className="card">
        <h2>Client-facing content</h2>
        <form action={updateDeliverableAction}>
          {hidden}
          <fieldset disabled={!editable} style={{ border: "none", padding: 0, margin: 0 }}>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <label>
                <span className="muted">Title</span>
                <input name="title" defaultValue={d.title} required style={{ width: "100%" }} />
              </label>
              <label>
                <span className="muted">Client-safe description</span>
                <textarea name="description" defaultValue={d.description} rows={2} className="textarea" />
              </label>
              <label>
                <span className="muted">Scope</span>
                <textarea name="scope" defaultValue={d.scope} rows={2} className="textarea" />
              </label>
              <label>
                <span className="muted">Acceptance criteria</span>
                <textarea name="acceptanceCriteria" defaultValue={d.acceptanceCriteria} rows={3} className="textarea" />
              </label>
              <label>
                <span className="muted">Target date</span>{" "}
                <input name="targetDate" type="date" aria-label="Target date" defaultValue={d.targetDate ? d.targetDate.toISOString().slice(0, 10) : ""} />
              </label>
              {editable && (
                <div>
                  <button type="submit">Save draft</button>
                </div>
              )}
            </div>
          </fieldset>
        </form>
      </div>

      <div className="card">
        <h2>Lifecycle</h2>
        <p className="muted">
          Marking ready for review freezes the current content as v{d.currentVersion + 1}.
          Approved and Delivered stay separate: acceptance is not the same event as
          contractual delivery.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {visibleTransitions.length === 0 && (
            <span className="muted">No transitions available to your role from this state.</span>
          )}
          {visibleTransitions.map((target) => (
            <form key={target} action={transitionDeliverableAction}>
              {hidden}
              <input type="hidden" name="target" value={target} />
              <button
                type="submit"
                className={target === "READY_FOR_REVIEW" ? undefined : "secondary"}
              >
                {target === "READY_FOR_REVIEW"
                  ? `Freeze & mark ready for review (v${d.currentVersion + 1})`
                  : `Move to ${DELIVERABLE_STATUS_LABELS[target] ?? target}`}
              </button>
            </form>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Linked source work</h2>
        <p className="muted">
          Several internal issues can back one client-facing deliverable. These links are
          internal only — clients never see them.
        </p>
        {d.sourceLinks.length > 0 && (
          <ul className="muted" style={{ marginTop: 0 }}>
            {d.sourceLinks.map((l) => {
              // data is Json and may be JSON null — never assume an object.
              const data = l.sourceObject.data;
              const sourceRef =
                (typeof data === "object" && data !== null && !Array.isArray(data)
                  ? (data as { identifier?: string }).identifier
                  : undefined) ?? l.sourceObject.externalId;
              return (
                <li key={l.id}>
                  {sourceRef} — {l.sourceObject.title}
                  {l.relationship && ` (${l.relationship})`}
                </li>
              );
            })}
          </ul>
        )}
        <form action={toggleSourceLinkAction} className="form-row">
          {hidden}
          <select name="sourceObjectId" aria-label="Source work item" style={{ flex: 1, minWidth: 260 }}>
            {availableSources.map((s) => (
              <option key={s.id} value={s.id}>
                {linkedIds.has(s.id) ? "✓ " : ""}
                {s.title} — {s.stateName}
              </option>
            ))}
          </select>
          <select name="relationship" defaultValue="Implements" aria-label="Relationship">
            <option value="Implements">Implements</option>
            <option value="Supports">Supports</option>
            <option value="Tests">Tests</option>
            <option value="Designs">Designs</option>
            <option value="Deploys">Deploys</option>
            <option value="Related">Related</option>
          </select>
          <button type="submit" className="secondary">Link / unlink</button>
        </form>
      </div>

      {d.versions.length > 0 && (
        <div className="card">
          <h2>Version history</h2>
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Frozen</th>
                <th>Material hash</th>
              </tr>
            </thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.id}>
                  <td>v{v.version}</td>
                  <td className="muted">{v.createdAt.toLocaleString()}</td>
                  <td className="muted" style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                    {v.contentHash.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
