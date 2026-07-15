import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getClientPublishedProject } from "@/server/client-portal";

const HEALTH_LABELS: Record<string, string> = {
  NOT_SET: "Not set",
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  OFF_TRACK: "Off track",
  PAUSED: "Paused",
  COMPLETE: "Complete",
};

export default async function ClientProjectPage({
  params,
}: {
  params: Promise<{ portalSlug: string; identifier: string }>;
}) {
  const { portalSlug, identifier } = await params;
  const user = await requireUser();
  const project = await getClientPublishedProject(user, portalSlug, identifier);
  if (!project) notFound();

  const { snapshot } = project;

  return (
    <>
      <p className="muted" style={{ marginBottom: 0 }}>
        <Link href={`/portal/${portalSlug}`}>← Overview</Link> · {snapshot.identifier}
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{snapshot.name}</h1>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          {snapshot.summary || <span className="muted">No summary provided.</span>}
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Health: <strong>{HEALTH_LABELS[snapshot.health] ?? snapshot.health}</strong> · published{" "}
          {project.publishedAt.toLocaleString()} (v{project.version})
        </p>
      </div>

      <div className="card">
        <h2>Work in this project</h2>
        {snapshot.workItems.length === 0 ? (
          <p className="muted">No work items are shared yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.workItems.map((w) => (
                <tr key={w.id}>
                  <td>
                    {w.title}
                    {w.description && (
                      <div className="muted" style={{ fontSize: "0.82rem" }}>{w.description}</div>
                    )}
                    {w.archivedNote && (
                      <div className="muted" style={{ fontSize: "0.78rem" }}>{w.archivedNote}</div>
                    )}
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

      {project.history.length > 1 && (
        <div className="card">
          <h2>Publication history</h2>
          <ul className="muted" style={{ marginBottom: 0 }}>
            {project.history.map((h) => (
              <li key={h.version}>
                Version {h.version} — published {h.publishedAt.toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
