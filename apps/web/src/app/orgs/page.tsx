import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { listMyOrganizations } from "@/server/organizations";
import { listMyClientPortals } from "@/server/client-portal";
import { signOut } from "@/auth";
import { createOrganizationAction } from "./actions";

export default async function OrgsPage() {
  const user = await requireUser();
  const orgs = await listMyOrganizations(user);
  const clientPortals = await listMyClientPortals(user);

  // Pure client users go straight to their portal.
  if (orgs.length === 0 && clientPortals.length === 1) {
    redirect(`/portal/${clientPortals[0]!.portalSlug}`);
  }

  return (
    <>
      <header className="topbar">
        <span className="brand">Frontstage</span>
        <span className="muted">
          {user.name ?? user.email}{" "}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
            style={{ display: "inline" }}
          >
            <button type="submit" className="secondary" style={{ marginLeft: "0.75rem" }}>
              Sign out
            </button>
          </form>
        </span>
      </header>
      <main className="container">
        {clientPortals.length > 0 && (
          <>
            <h1>Your client portals</h1>
            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Portal</th>
                    <th>Your role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clientPortals.map((p) => (
                    <tr key={p.portalId}>
                      <td>{p.portalName}</td>
                      <td>
                        <span className="role-tag">
                          {p.roleKey.toLowerCase().replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link className="button" href={`/portal/${p.portalSlug}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <h1>Your organizations</h1>
        {orgs.length === 0 ? (
          <div className="empty-state">
            <p>You are not a member of any organization yet.</p>
            <p className="muted">
              Create one below, or accept an invitation link if you received one.
            </p>
          </div>
        ) : (
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Organization</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr key={org.id}>
                    <td>{org.name}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="button" href={`/o/${org.slug}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card">
          <h2>Create an organization</h2>
          <form action={createOrganizationAction} className="form-row">
            <input name="name" placeholder="e.g. Northline Product Studio" required minLength={2} maxLength={80} style={{ flex: 1 }} />
            <button type="submit">Create</button>
          </form>
        </div>
      </main>
    </>
  );
}
