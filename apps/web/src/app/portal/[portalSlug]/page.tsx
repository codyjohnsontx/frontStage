import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getClientPortalOverview } from "@/server/client-portal";

const HEALTH_LABELS: Record<string, string> = {
  NOT_SET: "Not set",
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  OFF_TRACK: "Off track",
  PAUSED: "Paused",
  COMPLETE: "Complete",
};

export default async function ClientPortalOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ portalSlug: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  const { portalSlug } = await params;
  const { joined } = await searchParams;
  const user = await requireUser();
  const overview = await getClientPortalOverview(user, portalSlug);
  if (!overview) notFound();

  return (
    <>
      {joined && (
        <div className="success-banner">
          Welcome — you now have access to the {overview.portalName} portal.
        </div>
      )}
      <h1>{overview.portalName}</h1>
      <p className="muted">
        Your window into delivery by {overview.hostOrganizationName}. You are
        signed in as a {overview.roleKey.toLowerCase().replace(/_/g, " ")}.
      </p>

      {overview.projects.length === 0 ? (
        <div className="empty-state">
          <p>Nothing has been published to this portal yet.</p>
          <p className="muted">
            You will see projects here as soon as {overview.hostOrganizationName} publishes them.
          </p>
        </div>
      ) : (
        <div className="card">
          <h2>Active projects</h2>
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Health</th>
                <th>Last update</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {overview.projects.map((p) => (
                <tr key={p.identifier}>
                  <td>
                    <span className="muted">{p.identifier}</span> {p.name}
                    {p.summary && (
                      <div className="muted" style={{ fontSize: "0.82rem" }}>
                        {p.summary.length > 140 ? `${p.summary.slice(0, 140)}…` : p.summary}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="role-tag">{HEALTH_LABELS[p.health] ?? p.health}</span>
                  </td>
                  <td className="muted">
                    v{p.version} · {p.publishedAt.toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link className="button" href={`/portal/${portalSlug}/projects/${p.identifier}`}>
                      View
                    </Link>
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
