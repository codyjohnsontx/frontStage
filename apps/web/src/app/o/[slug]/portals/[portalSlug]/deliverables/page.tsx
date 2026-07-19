import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPortalBySlug } from "@/server/clients";
import { listPortalDeliverables } from "@/server/deliverables";
import { DELIVERABLE_STATUS_LABELS } from "@/server/deliverable-view";
import { createDeliverableAction } from "./actions";

export default async function DeliverablesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; portalSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, portalSlug } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();
  const portal = await getPortalBySlug(user, org.id, portalSlug);
  if (!portal) notFound();
  const deliverables = await listPortalDeliverables(user, org.id, portal.id);

  return (
    <>
      <p className="muted" style={{ marginBottom: 0 }}>
        <Link href={`/o/${org.slug}/portals/${portal.slug}`}>← {portal.name}</Link>
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>Deliverables</h1>
      {error && <div className="error-banner">{error}</div>}
      <p className="muted">
        Deliverables are owned by Frontstage, not Linear. Content is frozen into an immutable
        version each time you mark one ready for review — that exact version is what the
        client approves.
      </p>

      {deliverables.length === 0 ? (
        <div className="empty-state">
          <p>No deliverables yet.</p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Status</th>
                <th>Version</th>
                <th>Owner</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {deliverables.map((d) => (
                <tr key={d.id}>
                  <td className="muted">{d.identifier}</td>
                  <td>
                    <Link href={`/o/${org.slug}/portals/${portal.slug}/deliverables/${d.identifier}`}>
                      {d.title}
                    </Link>
                  </td>
                  <td>
                    <span className="role-tag">{DELIVERABLE_STATUS_LABELS[d.status] ?? d.status}</span>
                  </td>
                  <td className="muted">{d.currentVersion === 0 ? "—" : `v${d.currentVersion}`}</td>
                  <td className="muted">{d.internalOwner.name ?? d.internalOwner.email}</td>
                  <td className="muted">
                    {d.targetDate ? d.targetDate.toISOString().slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>New deliverable</h2>
        <form action={createDeliverableAction}>
          <input type="hidden" name="slug" value={org.slug} />
          <input type="hidden" name="portalSlug" value={portal.slug} />
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label>
              <span className="muted">Title</span>
              <input name="title" required minLength={3} maxLength={140} style={{ width: "100%" }} />
            </label>
            <label>
              <span className="muted">Client-safe description</span>
              <textarea name="description" rows={2} style={{ width: "100%", fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", borderRadius: 8 }} />
            </label>
            <label>
              <span className="muted">Scope</span>
              <textarea name="scope" rows={2} style={{ width: "100%", fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", borderRadius: 8 }} />
            </label>
            <label>
              <span className="muted">Acceptance criteria (what the client is agreeing to)</span>
              <textarea name="acceptanceCriteria" rows={3} style={{ width: "100%", fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", borderRadius: 8 }} />
            </label>
            <label>
              <span className="muted">Target date</span>{" "}
              <input name="targetDate" type="date" aria-label="Target date" />
            </label>
            <div>
              <button type="submit">Create deliverable</button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
