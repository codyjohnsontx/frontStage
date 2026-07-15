import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { listMembersAndInvitations } from "@/server/invitations";
import { inviteMemberAction, revokeInvitationAction } from "./actions";

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; invited?: string }>;
}) {
  const { slug } = await params;
  const { error, invited } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();

  const { members, invitations } = await listMembersAndInvitations(user, org.id);

  return (
    <>
      <h1>Members</h1>
      {error && <div className="error-banner">{error}</div>}
      {invited && (
        <div className="success-banner">
          Invitation sent to {invited}. It expires in 7 days and can only be
          accepted by that email address.
        </div>
      )}

      <div className="card">
        <h2>Internal members</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Roles</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>{m.name ?? "—"}</td>
                <td>{m.email}</td>
                <td>
                  {m.roles.map((r) => (
                    <span key={r} className="role-tag">
                      {r.toLowerCase().replace(/_/g, " ")}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Invite a teammate</h2>
        <p className="muted">
          Invitations are bound to the email address, single-use, and expire
          after 7 days. Client users are invited through portals (Phase 2).
        </p>
        <form action={inviteMemberAction} className="form-row">
          <input type="hidden" name="slug" value={org.slug} />
          <input
            name="email"
            type="email"
            placeholder="teammate@company.com"
            required
            style={{ flex: 1, minWidth: 220 }}
          />
          <select name="roleKey" defaultValue="CONTRIBUTOR" aria-label="Role">
            <option value="ORGANIZATION_ADMIN">Organization Admin</option>
            <option value="CONTRIBUTOR">Contributor</option>
            <option value="INTERNAL_VIEWER">Internal Viewer</option>
          </select>
          <button type="submit">Send invitation</button>
        </form>
      </div>

      <div className="card">
        <h2>Pending invitations</h2>
        {invitations.length === 0 ? (
          <p className="muted">No pending invitations.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>
                    <span className="role-tag">
                      {i.roleKey.toLowerCase().replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="muted">{i.expiresAt.toLocaleDateString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <form action={revokeInvitationAction} style={{ display: "inline" }}>
                      <input type="hidden" name="slug" value={org.slug} />
                      <input type="hidden" name="invitationId" value={i.id} />
                      <button type="submit" className="danger">
                        Revoke
                      </button>
                    </form>
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
