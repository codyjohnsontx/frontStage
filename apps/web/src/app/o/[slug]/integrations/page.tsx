import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import {
  devFixtureEnabled,
  getLinearConnection,
  linearOAuthConfigured,
  listSourceIssues,
} from "@/server/integrations";
import {
  connectFixtureAction,
  simulateChangeAction,
  startOAuthAction,
  syncNowAction,
} from "./actions";

export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; connected?: string; synced?: string; simulated?: string }>;
}) {
  const { slug } = await params;
  const { error, connected, synced, simulated } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();

  const connection = await getLinearConnection(user, org.id);
  const issues = connection ? await listSourceIssues(user, org.id) : [];

  return (
    <>
      <h1>Integrations</h1>
      {error && <div className="error-banner">{error}</div>}
      {connected && <div className="success-banner">Linear connected. The first sync is running.</div>}
      {synced && <div className="success-banner">Sync requested — the worker will pick it up momentarily.</div>}
      {simulated && (
        <div className="success-banner">
          Simulated a Linear-side change. It flows through the webhook pipeline; affected
          projections will be flagged for review (never overwritten).
        </div>
      )}

      <div className="card">
        <h2>Linear</h2>
        {connection ? (
          <>
            <p>
              <strong>{connection.workspaceName}</strong>{" "}
              <span className="role-tag">{connection.mode}</span>{" "}
              <span className="role-tag">{connection.status.toLowerCase()}</span>
            </p>
            <p className="muted">
              {connection.projectCount} projects · {connection.issueCount} issues ·{" "}
              {connection.lastSyncAt
                ? `last synced ${connection.lastSyncAt.toLocaleString()}`
                : "first sync pending"}
            </p>
            {connection.lastError && <div className="error-banner">{connection.lastError}</div>}
            <form action={syncNowAction} style={{ display: "inline", marginRight: "0.5rem" }}>
              <input type="hidden" name="slug" value={org.slug} />
              <button type="submit" className="secondary">Sync now</button>
            </form>
            {linearOAuthConfigured() && connection.status !== "ACTIVE" && (
              <form action={startOAuthAction} style={{ display: "inline" }}>
                <input type="hidden" name="slug" value={org.slug} />
                <button type="submit">Reconnect Linear</button>
              </form>
            )}
          </>
        ) : (
          <>
            <p className="muted">
              Connect your Linear workspace so Frontstage can generate client-safe projections.
              Linear stays the system of record for internal execution.
            </p>
            {linearOAuthConfigured() && (
              <form action={startOAuthAction} style={{ display: "inline", marginRight: "0.5rem" }}>
                <input type="hidden" name="slug" value={org.slug} />
                <button type="submit">Connect Linear workspace</button>
              </form>
            )}
            {devFixtureEnabled && (
              <form action={connectFixtureAction} style={{ display: "inline" }}>
                <input type="hidden" name="slug" value={org.slug} />
                <button type="submit" className="secondary">
                  Connect demo workspace (dev only)
                </button>
              </form>
            )}
            {!linearOAuthConfigured() && !devFixtureEnabled && (
              <p className="muted">Set LINEAR_CLIENT_ID / LINEAR_CLIENT_SECRET to enable OAuth.</p>
            )}
          </>
        )}
      </div>

      {devFixtureEnabled && connection && issues.length > 0 && (
        <div className="card">
          <h2>Failure &amp; change simulation (dev only)</h2>
          <p className="muted">
            Pretend an engineer changed an issue in Linear. The update arrives through the
            webhook path and flags any curated projection for review.
          </p>
          <form action={simulateChangeAction} className="form-row">
            <input type="hidden" name="slug" value={org.slug} />
            <select name="sourceObjectId" aria-label="Source issue" style={{ flex: 1, minWidth: 260 }}>
              {issues.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} — {i.stateName}
                </option>
              ))}
            </select>
            <button type="submit" className="secondary">Simulate source change</button>
          </form>
        </div>
      )}
    </>
  );
}
