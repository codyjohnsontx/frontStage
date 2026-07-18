import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { listClientRequests } from "@/server/client-requests";
import { PRIORITY_LABELS, REQUEST_TYPE_LABELS } from "@/lib/request-labels";

export default async function ClientRequestsPage({
  params,
}: {
  params: Promise<{ portalSlug: string }>;
}) {
  const { portalSlug } = await params;
  const user = await requireUser();
  const result = await listClientRequests(user, portalSlug);
  if (!result) notFound();

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Requests</h1>
        {result.canSubmit && (
          <Link className="button" href={`/portal/${portalSlug}/requests/new`}>
            New request
          </Link>
        )}
      </div>
      <p className="muted">
        Requests are structured intake — submitting one never changes scope, priority,
        delivery dates, or contractual commitments by itself.
      </p>

      {result.requests.length === 0 ? (
        <div className="empty-state">
          <p>No requests yet.</p>
          {result.canSubmit && (
            <p className="muted">Submit the first one and the delivery team will pick it up.</p>
          )}
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Request</th>
                <th>Type</th>
                <th>Your priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.requests.map((r) => (
                <tr key={r.identifier}>
                  <td className="muted">{r.identifier}</td>
                  <td>
                    <Link href={`/portal/${portalSlug}/requests/${r.identifier}`}>{r.title}</Link>
                  </td>
                  <td className="muted">{REQUEST_TYPE_LABELS[r.type] ?? r.type}</td>
                  <td className="muted">{PRIORITY_LABELS[r.clientPriority] ?? r.clientPriority}</td>
                  <td>
                    <span className="role-tag">{r.statusLabel}</span>
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
