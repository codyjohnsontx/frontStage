import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPortalBySlug } from "@/server/clients";
import { listAvailableProjectSources } from "@/server/projections";
import { listPortalClientAccess } from "@/server/portal-members";
import { PermissionDeniedError } from "@/server/authz";
import {
  createDraftAction,
  inviteClientAction,
  removeClientMemberAction,
  revokeClientInvitationAction,
} from "./actions";

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; portalSlug: string }>;
  searchParams: Promise<{ error?: string; invited?: string }>;
}) {
  const { slug, portalSlug } = await params;
  const { error, invited } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();
  const portal = await getPortalBySlug(user, org.id, portalSlug);
  if (!portal) notFound();

  const availableSources = await listAvailableProjectSources(user, org.id, portal.id);
  // The client-access card is only shown to members who may manage it.
  let clientAccess: Awaited<ReturnType<typeof listPortalClientAccess>> | null = null;
  try {
    clientAccess = await listPortalClientAccess(user, org.id, portal.id);
  } catch (err) {
    if (!(err instanceof PermissionDeniedError)) throw err;
  }

  return (
    <>
      <p className="muted" style={{ marginBottom: 0 }}>
        {portal.clientOrganization.name} · client portal
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{portal.name}</h1>
      {error && <div className="error-banner">{error}</div>}
      {invited && (
        <div className="success-banner">
          Invitation sent to {invited}. It is bound to that email, single-use, and expires in 7
          days. They will only ever see published content for this portal.
        </div>
      )}

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

      {clientAccess && (
      <div className="card">
        <h2>Client access</h2>
        <p className="muted">
          Client users sign in with their own identity and see only what this portal has
          published. They never join your organization.
        </p>
        {clientAccess.members.length > 0 && (
          <table style={{ marginBottom: "0.75rem" }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clientAccess.members.map((m) => (
                <tr key={m.membershipId}>
                  <td>{m.name ?? "—"}</td>
                  <td>{m.email}</td>
                  <td>
                    <span className="role-tag">{m.roleKey.toLowerCase().replace(/_/g, " ")}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <form action={removeClientMemberAction} style={{ display: "inline" }}>
                      <input type="hidden" name="slug" value={org.slug} />
                      <input type="hidden" name="portalSlug" value={portal.slug} />
                      <input type="hidden" name="membershipId" value={m.membershipId} />
                      <button type="submit" className="danger">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {clientAccess.invitations.length > 0 && (
          <table style={{ marginBottom: "0.75rem" }}>
            <thead>
              <tr>
                <th>Pending invitation</th>
                <th>Role</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clientAccess.invitations.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>
                    <span className="role-tag">{i.roleKey.toLowerCase().replace(/_/g, " ")}</span>
                  </td>
                  <td className="muted">{i.expiresAt.toLocaleDateString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <form action={revokeClientInvitationAction} style={{ display: "inline" }}>
                      <input type="hidden" name="slug" value={org.slug} />
                      <input type="hidden" name="portalSlug" value={portal.slug} />
                      <input type="hidden" name="invitationId" value={i.id} />
                      <button type="submit" className="danger">Revoke</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={inviteClientAction} className="form-row">
          <input type="hidden" name="slug" value={org.slug} />
          <input type="hidden" name="portalSlug" value={portal.slug} />
          <input
            name="email"
            type="email"
            placeholder="client@company.com"
            aria-label="Client email"
            required
            style={{ flex: 1, minWidth: 220 }}
          />
          <select name="roleKey" defaultValue="CLIENT_CONTRIBUTOR" aria-label="Client role">
            <option value="CLIENT_ADMIN">Client Admin</option>
            <option value="CLIENT_APPROVER">Client Approver</option>
            <option value="CLIENT_CONTRIBUTOR">Client Contributor</option>
            <option value="CLIENT_VIEWER">Client Viewer</option>
          </select>
          <button type="submit">Invite client</button>
        </form>
      </div>
      )}

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
