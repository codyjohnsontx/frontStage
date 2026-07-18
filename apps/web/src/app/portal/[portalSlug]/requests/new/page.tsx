import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { listClientRequests } from "@/server/client-requests";
import { REQUEST_TYPE_LABELS } from "@/lib/request-labels";
import { submitRequestAction } from "../actions";

export default async function NewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ portalSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { portalSlug } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const result = await listClientRequests(user, portalSlug);
  if (!result) notFound();

  if (!result.canSubmit) {
    return (
      <div className="empty-state">
        <p>Your role on this portal is view-only, so it cannot submit requests.</p>
        <p className="muted">Ask your administrator for contributor access if you need to.</p>
      </div>
    );
  }

  // Generated at render: resubmitting the same form (double-click, refresh
  // retry) reuses this key and returns the original request.
  const idempotencyKey = randomUUID().replace(/-/g, "");

  return (
    <>
      <h1>New request</h1>
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <form action={submitRequestAction}>
          <input type="hidden" name="portalSlug" value={portalSlug} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label>
              <span className="muted">Type</span>
              <br />
              <select name="type" defaultValue="FEATURE" aria-label="Request type">
                {Object.entries(REQUEST_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="muted">Title</span>
              <input name="title" required minLength={3} maxLength={140} style={{ width: "100%" }} />
            </label>
            <label>
              <span className="muted">What do you need, and why does it matter?</span>
              <textarea
                name="description"
                required
                rows={6}
                maxLength={5000}
                style={{ width: "100%", fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", borderRadius: "8px" }}
              />
            </label>
            <label>
              <span className="muted">How urgent is this for you?</span>
              <br />
              <select name="clientPriority" defaultValue="NORMAL" aria-label="Priority">
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
            <p className="muted" style={{ margin: 0 }}>
              Submitting a request records it with the delivery team. It does not by itself
              change scope, priorities, delivery dates, or contractual commitments — the team
              will review it and respond.
            </p>
            <div>
              <button type="submit">Submit request</button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
