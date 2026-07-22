import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { listClientDeliverables } from "@/server/deliverables";
import { DELIVERABLE_STATUS_LABELS } from "@/server/deliverable-view";

export default async function ClientDeliverablesPage({
  params,
}: {
  params: Promise<{ portalSlug: string }>;
}) {
  const { portalSlug } = await params;
  const user = await requireUser();
  const deliverables = await listClientDeliverables(user, portalSlug);
  if (!deliverables) notFound();

  return (
    <>
      <h1>Deliverables</h1>
      <p className="muted">
        What the team is delivering to you, with the acceptance criteria each one is measured
        against.
      </p>
      {deliverables.length === 0 ? (
        <div className="empty-state">
          <p>Nothing has been shared for review yet.</p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Deliverable</th>
                <th>Status</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {deliverables.map((d) => (
                <tr key={d.identifier}>
                  <td className="muted">{d.identifier}</td>
                  <td>
                    <Link href={`/portal/${portalSlug}/deliverables/${d.identifier}`}>{d.title}</Link>
                  </td>
                  <td>
                    <span className="role-tag">{DELIVERABLE_STATUS_LABELS[d.status] ?? d.status}</span>
                  </td>
                  <td className="muted">{d.targetDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
