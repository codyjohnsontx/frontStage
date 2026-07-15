import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPublishedSnapshot, previewClientView } from "@/server/projections";
import { HEALTH_LABELS } from "@/lib/health-labels";

/**
 * Client-role preview: renders ONLY the client-safe projection (the same
 * data shape that publication snapshots freeze). Nothing on this page may
 * read internal source fields.
 */
export default async function ClientPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; portalSlug: string; identifier: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug, portalSlug, identifier } = await params;
  const { view } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();

  const showPublished = view === "published";
  const published = showPublished ? await getPublishedSnapshot(user, org.id, identifier) : null;
  const projection = showPublished
    ? published?.snapshot
    : await previewClientView(user, org.id, identifier);

  if (!projection) {
    return (
      <main className="container" style={{ maxWidth: 720 }}>
        <div className="empty-state">
          <p>No published version exists yet.</p>
          <Link href={`/o/${slug}/portals/${portalSlug}/projects/${identifier}/preview`}>
            View the draft preview instead
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="error-banner" style={{ background: "#eef2f7", borderColor: "#d5dee9", color: "var(--accent)" }}>
        {showPublished
          ? `Published snapshot v${published?.version} — exactly what the client sees.`
          : "Draft preview — what the client WOULD see if you published right now."}{" "}
        <Link href={`/o/${slug}/portals/${portalSlug}/projects/${identifier}`}>Back to curation</Link>
        {" · "}
        <Link
          href={`/o/${slug}/portals/${portalSlug}/projects/${identifier}/preview${showPublished ? "" : "?view=published"}`}
        >
          {showPublished ? "View draft preview" : "View published snapshot"}
        </Link>
      </div>

      <p className="muted" style={{ marginBottom: 0 }}>{projection.identifier}</p>
      <h1 style={{ marginTop: "0.25rem" }}>{projection.name}</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>{projection.summary || <span className="muted">No summary yet.</span>}</p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Health: <strong>{HEALTH_LABELS[projection.health] ?? projection.health}</strong>
        </p>
      </div>

      <div className="card">
        <h2>Work in this project</h2>
        {projection.workItems.length === 0 ? (
          <p className="muted">Nothing is shared with the client yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {projection.workItems.map((w) => (
                <tr key={w.id}>
                  <td>
                    {w.title}
                    {w.description && <div className="muted" style={{ fontSize: "0.82rem" }}>{w.description}</div>}
                    {w.archivedNote && <div className="muted" style={{ fontSize: "0.78rem" }}>{w.archivedNote}</div>}
                  </td>
                  <td>
                    <span className="role-tag">{w.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
