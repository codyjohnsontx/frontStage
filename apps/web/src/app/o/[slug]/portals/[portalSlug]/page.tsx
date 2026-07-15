import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPortalBySlug } from "@/server/clients";
import { listAvailableProjectSources } from "@/server/projections";
import { createDraftAction } from "./actions";

export default async function PortalPage({
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

  const availableSources = await listAvailableProjectSources(user, org.id, portal.id);

  return (
    <>
      <p className="muted" style={{ marginBottom: 0 }}>
        {portal.clientOrganization.name} · client portal
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{portal.name}</h1>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h2>Client-facing projects</h2>
        {portal.externalProjects.length === 0 ? (
          <p className="muted">
            No projections yet. Create one from a Linear source below — everything starts
            internal-only until you curate and publish it.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Published version</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {portal.externalProjects.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{p.identifier}</td>
                  <td>{p.name}</td>
                  <td>
                    <span className="role-tag">{p.status.toLowerCase()}</span>
                  </td>
                  <td className="muted">{p.currentVersion === 0 ? "—" : `v${p.currentVersion}`}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link className="button" href={`/o/${org.slug}/portals/${portal.slug}/projects/${p.identifier}`}>
                      Curate
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>New projection from Linear</h2>
        {availableSources.length === 0 ? (
          <p className="muted">
            No unlinked Linear projects available. Connect Linear and sync on the
            Integrations page first.
          </p>
        ) : (
          <form action={createDraftAction} className="form-row">
            <input type="hidden" name="slug" value={org.slug} />
            <input type="hidden" name="portalSlug" value={portal.slug} />
            <input type="hidden" name="portalId" value={portal.id} />
            <select name="sourceObjectId" aria-label="Linear project" style={{ flex: 1, minWidth: 260 }}>
              {availableSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <button type="submit">Generate draft projection</button>
          </form>
        )}
      </div>
    </>
  );
}
