import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPortalBySlug } from "@/server/clients";
import { getRequestThreadInternal } from "@/server/request-communication";
import { PRIORITY_LABELS, REQUEST_TYPE_LABELS } from "@/lib/request-labels";
import {
  addMessageAction,
  closeAsDuplicateAction,
  decideRequestAction,
  linkLinearIssueAction,
} from "./actions";

const KIND_LABELS: Record<string, string> = {
  PUBLIC_REPLY: "Public reply",
  INTERNAL_NOTE: "Internal note",
  CLARIFICATION_REQUEST: "Clarification requested",
  CLIENT_MESSAGE: "Client",
};

export default async function InternalRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; portalSlug: string; identifier: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, portalSlug, identifier } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();
  const portal = await getPortalBySlug(user, org.id, portalSlug);
  if (!portal) notFound();
  const data = await getRequestThreadInternal(user, org.id, portal.id, identifier);
  if (!data) notFound();
  const { request, otherRequests, statusLabel } = data;

  const open = request.status === "RECEIVED" || request.status === "IN_REVIEW";
  const hidden = (
    <>
      <input type="hidden" name="slug" value={org.slug} />
      <input type="hidden" name="portalSlug" value={portal.slug} />
      <input type="hidden" name="identifier" value={request.identifier} />
      <input type="hidden" name="requestId" value={request.id} />
    </>
  );

  return (
    <>
      <p className="muted" style={{ marginBottom: 0 }}>
        <Link href={`/o/${org.slug}/portals/${portal.slug}`}>← {portal.name}</Link> ·{" "}
        {request.identifier} · <span className="role-tag">{statusLabel}</span>
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{request.title}</h1>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {REQUEST_TYPE_LABELS[request.type] ?? request.type} · from{" "}
          {request.createdBy.name ?? request.createdBy.email} · client priority{" "}
          {PRIORITY_LABELS[request.clientPriority]} · internal priority{" "}
          {request.internalPriority ? PRIORITY_LABELS[request.internalPriority] : "not set"} ·
          Linear:{" "}
          {request.linearSyncState === "SYNCED"
            ? request.linearIssueIdentifier ?? "synced"
            : request.linearSyncState.toLowerCase()}
          {request.duplicateOf && ` · duplicate of ${request.duplicateOf.identifier}`}
        </p>
        <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{request.description}</p>
      </div>

      <div className="card">
        <h2>Conversation</h2>
        {request.messages.length === 0 ? (
          <p className="muted">No messages yet.</p>
        ) : (
          request.messages.map((m) => (
            <div
              key={m.id}
              style={{
                padding: "0.6rem 0.75rem",
                marginBottom: "0.5rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: m.kind === "INTERNAL_NOTE" ? "#fdf6ec" : "var(--surface)",
              }}
            >
              <div className="muted" style={{ fontSize: "0.78rem" }}>
                <span className="role-tag">{KIND_LABELS[m.kind] ?? m.kind}</span>{" "}
                {m.author.name ?? m.author.email} · {m.createdAt.toLocaleString()}
                {m.kind !== "INTERNAL_NOTE" && m.linearSyncState !== "SYNCED" && (
                  <> · Linear sync {m.linearSyncState.toLowerCase()}</>
                )}
                {m.kind === "INTERNAL_NOTE" && " · never visible to clients"}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
            </div>
          ))
        )}

        <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
          <form action={addMessageAction}>
            {hidden}
            <input type="hidden" name="kind" value="PUBLIC_REPLY" />
            <span className="muted">Public reply (client sees this; forwarded to Linear)</span>
            <div className="form-row">
              <textarea name="body" required rows={2} aria-label="Public reply" style={{ flex: 1, fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", borderRadius: 8 }} />
              <button type="submit">Reply</button>
            </div>
          </form>
          <form action={addMessageAction}>
            {hidden}
            <input type="hidden" name="kind" value="INTERNAL_NOTE" />
            <span className="muted">Internal note (never visible to clients)</span>
            <div className="form-row">
              <textarea name="body" required rows={2} aria-label="Internal note" style={{ flex: 1, fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px dashed #d9b47c", borderRadius: 8, background: "#fdf6ec" }} />
              <button type="submit" className="secondary">Add note</button>
            </div>
          </form>
          <form action={addMessageAction}>
            {hidden}
            <input type="hidden" name="kind" value="CLARIFICATION_REQUEST" />
            <span className="muted">Request clarification from the client</span>
            <div className="form-row">
              <textarea name="body" required rows={2} aria-label="Clarification request" style={{ flex: 1, fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", borderRadius: 8 }} />
              <button type="submit" className="secondary">Ask</button>
            </div>
          </form>
        </div>
      </div>

      {open && (
        <div className="card">
          <h2>Decision</h2>
          <p className="muted">
            Accepting or declining is a formal, client-visible outcome. It does not by itself
            change engineering priorities.
          </p>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <form action={decideRequestAction} className="form-row">
              {hidden}
              <input type="hidden" name="decision" value="ACCEPTED" />
              <input name="reason" placeholder="Optional note the client will see" aria-label="Acceptance note" style={{ flex: 1, minWidth: 240 }} />
              <button type="submit">Accept request</button>
            </form>
            <form action={decideRequestAction} className="form-row">
              {hidden}
              <input type="hidden" name="decision" value="DECLINED" />
              <input name="reason" placeholder="Reason (required, client will see it)" required minLength={3} aria-label="Decline reason" style={{ flex: 1, minWidth: 240 }} />
              <button type="submit" className="danger">Decline request</button>
            </form>
            {otherRequests.length > 0 && (
              <form action={closeAsDuplicateAction} className="form-row">
                {hidden}
                <select name="duplicateOfIdentifier" aria-label="Duplicate of" style={{ flex: 1, minWidth: 240 }}>
                  {otherRequests.map((r) => (
                    <option key={r.identifier} value={r.identifier}>
                      {r.identifier} — {r.title}
                    </option>
                  ))}
                </select>
                <button type="submit" className="secondary">Close as duplicate</button>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Linear link</h2>
        <p className="muted">
          Point this request at a different existing Linear issue (e.g. when work is already
          tracked elsewhere). Future thread messages forward there.
        </p>
        <form action={linkLinearIssueAction} className="form-row">
          {hidden}
          <input name="externalId" placeholder="Linear issue id" required aria-label="Linear issue id" style={{ flex: 2, minWidth: 200 }} />
          <input name="externalIdentifier" placeholder="Identifier (e.g. ENG-42)" aria-label="Linear identifier" style={{ flex: 1, minWidth: 140 }} />
          <button type="submit" className="secondary">Link issue</button>
        </form>
      </div>
    </>
  );
}
