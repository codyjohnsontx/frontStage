import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { listClientsWithPortals } from "@/server/clients";
import { createClientAction, createPortalAction } from "./actions";

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();

  const clients = await listClientsWithPortals(user, org.id);

  return (
    <>
      <h1>Clients</h1>
      {error && <div className="error-banner">{error}</div>}

      {clients.length === 0 && (
        <div className="empty-state">
          <p>No client organizations yet.</p>
          <p className="muted">
            A client organization groups the portals one customer can access. Their users
            never see other clients&apos; work.
          </p>
        </div>
      )}

      {clients.map((client) => (
        <div className="card" key={client.id}>
          <h2>
            {client.name} <span className="role-tag">{client.identifierPrefix}</span>
          </h2>
          {client.portals.length === 0 ? (
            <p className="muted">No portals yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Portal</th>
                  <th>Projects</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {client.portals.map((portal) => (
                  <tr key={portal.id}>
                    <td>{portal.name}</td>
                    <td className="muted">{portal._count.externalProjects}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="button" href={`/o/${org.slug}/portals/${portal.slug}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form action={createPortalAction} className="form-row" style={{ marginTop: "0.75rem" }}>
            <input type="hidden" name="slug" value={org.slug} />
            <input type="hidden" name="clientOrganizationId" value={client.id} />
            <input name="name" placeholder="New portal name (e.g. Credentialing Modernization)" required style={{ flex: 1, minWidth: 260 }} />
            <button type="submit" className="secondary">Add portal</button>
          </form>
        </div>
      ))}

      <div className="card">
        <h2>New client organization</h2>
        <form action={createClientAction} className="form-row">
          <input type="hidden" name="slug" value={org.slug} />
          <input name="name" placeholder="Client name (e.g. Apex Health)" required style={{ flex: 2, minWidth: 220 }} />
          <input name="prefix" placeholder="Prefix (e.g. APEX)" required pattern="[A-Za-z]{2,8}" style={{ width: 140 }} />
          <button type="submit">Create client</button>
        </form>
        <p className="muted">
          The prefix builds client-facing identifiers like APEX-PRJ-004. Internal database ids
          are never exposed.
        </p>
      </div>
    </>
  );
}
