import Link from "next/link";
import { notFound } from "next/navigation";
import { mapStatus, type CanonicalStateType } from "@frontstage/integration-core";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getProjectionDetail, HEALTH_VALUES } from "@/server/projections";
import {
  publishAction,
  resolveChangeAction,
  setVisibilityAction,
  updateClientTitleAction,
  updateDraftAction,
} from "./actions";

const HEALTH_LABELS: Record<string, string> = {
  NOT_SET: "Not Set",
  ON_TRACK: "On Track",
  AT_RISK: "At Risk",
  OFF_TRACK: "Off Track",
  PAUSED: "Paused",
  COMPLETE: "Complete",
};

export default async function ProjectionEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; portalSlug: string; identifier: string }>;
  searchParams: Promise<{ error?: string; saved?: string; published?: string }>;
}) {
  const { slug, portalSlug, identifier } = await params;
  const { error, saved, published } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();
  const project = await getProjectionDetail(user, org.id, identifier);
  if (!project || project.portal.slug !== portalSlug) notFound();

  const mapping = (project.portal.statusMapping as Record<string, string> | null) ?? null;
  const changedItems = project.workItems.filter((w) => w.sourceChanged);
  const visibleCount = project.workItems.filter((w) => w.visibility === "CLIENT_VISIBLE").length;

  return (
    <>
      <p className="muted" style={{ marginBottom: 0 }}>
        {project.portal.clientOrganization.name} · {project.portal.name} ·{" "}
        <span className="role-tag">{project.identifier}</span>{" "}
        <span className="role-tag">{project.status.toLowerCase()}</span>
        {project.currentVersion > 0 && <span className="role-tag">published v{project.currentVersion}</span>}
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{project.name}</h1>

      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">Draft saved.</div>}
      {published && (
        <div className="success-banner">
          Published version {published}. An immutable snapshot of exactly what the client sees
          has been recorded.
        </div>
      )}
      {changedItems.length > 0 && (
        <div className="error-banner">
          {changedItems.length} work item{changedItems.length > 1 ? "s have" : " has"} changed in
          Linear since curation. Review the comparisons below — nothing is overwritten
          automatically.
        </div>
      )}

      <div className="card">
        <h2>Client-facing details</h2>
        <form action={updateDraftAction}>
          <input type="hidden" name="slug" value={org.slug} />
          <input type="hidden" name="portalSlug" value={portalSlug} />
          <input type="hidden" name="identifier" value={project.identifier} />
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label>
              <span className="muted">Client-facing name</span>
              <input name="name" defaultValue={project.name} required style={{ width: "100%" }} />
            </label>
            <label>
              <span className="muted">Client-safe summary (written for the client, not copied from Linear)</span>
              <textarea
                name="summary"
                defaultValue={project.summary}
                rows={3}
                style={{ width: "100%", fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", borderRadius: "8px" }}
              />
            </label>
            <label>
              <span className="muted">Project health (a human decision, never derived from counts)</span>{" "}
              <select name="health" defaultValue={project.health}>
                {HEALTH_VALUES.map((h) => (
                  <option key={h} value={h}>
                    {HEALTH_LABELS[h]}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button type="submit">Save draft</button>
            </div>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Work items</h2>
        <p className="muted">
          Everything starts <strong>internal</strong>. Only items you mark client-visible appear in
          the portal, with your client-safe title and a simplified status — estimates, assignees,
          labels, and internal descriptions never leave the kitchen.
        </p>
        <table>
          <thead>
            <tr>
              <th>Internal source (Linear)</th>
              <th>Client title</th>
              <th>Client status</th>
              <th>Visibility</th>
            </tr>
          </thead>
          <tbody>
            {project.workItems.map((w) => {
              const stateType = (w.sourceObject.stateType ?? "backlog") as CanonicalStateType;
              const src = w.sourceObject.data as { identifier?: string; labels?: string[] };
              return (
                <tr key={w.id} style={w.sourceChanged ? { background: "#fdf6ec" } : undefined}>
                  <td>
                    <span className="muted">{src.identifier ?? w.sourceObject.externalId}</span>{" "}
                    {w.sourceObject.title}
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      {w.sourceObject.stateName}
                      {w.archivedFromSource && " · archived in Linear"}
                    </div>
                    {w.sourceChanged && (
                      <div style={{ marginTop: "0.4rem", padding: "0.5rem", border: "1px dashed #d9b47c", borderRadius: 6, fontSize: "0.82rem" }}>
                        <strong>Source changed.</strong>
                        <div className="muted">Curated title: “{w.clientTitle}”</div>
                        <div className="muted">Source now: “{w.sourceObject.title}” ({w.sourceObject.stateName})</div>
                        <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.4rem" }}>
                          <form action={resolveChangeAction} style={{ display: "inline" }}>
                            <input type="hidden" name="slug" value={org.slug} />
                            <input type="hidden" name="portalSlug" value={portalSlug} />
                            <input type="hidden" name="identifier" value={project.identifier} />
                            <input type="hidden" name="workItemId" value={w.id} />
                            <input type="hidden" name="decision" value="apply" />
                            <button type="submit" className="secondary">Update draft from source</button>
                          </form>
                          <form action={resolveChangeAction} style={{ display: "inline" }}>
                            <input type="hidden" name="slug" value={org.slug} />
                            <input type="hidden" name="portalSlug" value={portalSlug} />
                            <input type="hidden" name="identifier" value={project.identifier} />
                            <input type="hidden" name="workItemId" value={w.id} />
                            <input type="hidden" name="decision" value="ignore" />
                            <button type="submit" className="secondary">Keep curated version</button>
                          </form>
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    <form action={updateClientTitleAction} className="form-row" style={{ flexWrap: "nowrap" }}>
                      <input type="hidden" name="slug" value={org.slug} />
                      <input type="hidden" name="portalSlug" value={portalSlug} />
                      <input type="hidden" name="identifier" value={project.identifier} />
                      <input type="hidden" name="workItemId" value={w.id} />
                      <input name="clientTitle" defaultValue={w.clientTitle} aria-label="Client title" style={{ minWidth: 180 }} />
                      <button type="submit" className="secondary">Save</button>
                    </form>
                  </td>
                  <td>
                    <span className="role-tag">{mapStatus(stateType, mapping)}</span>
                  </td>
                  <td>
                    <form action={setVisibilityAction}>
                      <input type="hidden" name="slug" value={org.slug} />
                      <input type="hidden" name="portalSlug" value={portalSlug} />
                      <input type="hidden" name="identifier" value={project.identifier} />
                      <input type="hidden" name="workItemId" value={w.id} />
                      <input
                        type="hidden"
                        name="visibility"
                        value={w.visibility === "INTERNAL" ? "CLIENT_VISIBLE" : "INTERNAL"}
                      />
                      <button type="submit" className={w.visibility === "INTERNAL" ? "secondary" : undefined}>
                        {w.visibility === "INTERNAL" ? "Internal" : "Client visible"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Preview &amp; publish</h2>
        <p className="muted">
          {visibleCount} of {project.workItems.length} work items are client-visible. Publishing
          freezes exactly this view as an immutable version the client sees.
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <Link className="button" href={`/o/${org.slug}/portals/${portalSlug}/projects/${project.identifier}/preview`} style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>
            Preview as client
          </Link>
          <form action={publishAction}>
            <input type="hidden" name="slug" value={org.slug} />
            <input type="hidden" name="portalSlug" value={portalSlug} />
            <input type="hidden" name="identifier" value={project.identifier} />
            <button type="submit">
              {project.currentVersion === 0 ? "Approve & publish v1" : `Publish v${project.currentVersion + 1}`}
            </button>
          </form>
        </div>
        {project.versions.length > 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            History:{" "}
            {project.versions
              .map((v) => `v${v.version} (${v.publishedAt.toLocaleString()})`)
              .join(" · ")}
          </p>
        )}
      </div>
    </>
  );
}
