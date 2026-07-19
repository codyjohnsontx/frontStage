import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getClientRequest } from "@/server/client-requests";
import { PRIORITY_LABELS, REQUEST_TYPE_LABELS } from "@/lib/request-labels";
import { replyToRequestAction } from "../actions";

const KIND_LABELS: Record<string, string> = {
  PUBLIC_REPLY: "Delivery team",
  CLARIFICATION_REQUEST: "Delivery team — needs your input",
  CLIENT_MESSAGE: "You",
};

export default async function ClientRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ portalSlug: string; identifier: string }>;
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const { portalSlug, identifier } = await params;
  const { submitted, error } = await searchParams;
  const user = await requireUser();
  const detail = await getClientRequest(user, portalSlug, identifier);
  if (!detail) notFound();
  const { request, messages, canReply } = detail;

  return (
    <>
      {submitted && (
        <div className="success-banner">
          Request {request.identifier} recorded. The delivery team has it — you will see
          status changes here.
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      <p className="muted" style={{ marginBottom: 0 }}>
        <Link href={`/portal/${portalSlug}/requests`}>← Requests</Link> · {request.identifier}
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{request.title}</h1>

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {REQUEST_TYPE_LABELS[request.type] ?? request.type} · your priority:{" "}
          {PRIORITY_LABELS[request.clientPriority] ?? request.clientPriority} · submitted{" "}
          {request.createdAt.toLocaleString()}
        </p>
        <p style={{ whiteSpace: "pre-wrap" }}>{request.description}</p>
        <p style={{ marginBottom: 0 }}>
          Status: <span className="role-tag">{request.statusLabel}</span>
        </p>
        {request.decisionReason && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Note from the team: {request.decisionReason}
          </p>
        )}
        {request.duplicateOfIdentifier && (
          <p className="muted" style={{ marginBottom: 0 }}>
            This request was merged into{" "}
            <Link href={`/portal/${portalSlug}/requests/${request.duplicateOfIdentifier}`}>
              {request.duplicateOfIdentifier}
            </Link>
            ; updates continue there.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Conversation</h2>
        {messages.length === 0 ? (
          <p className="muted">No replies yet — the delivery team will respond here.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              style={{
                padding: "0.6rem 0.75rem",
                marginBottom: "0.5rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div className="muted" style={{ fontSize: "0.78rem" }}>
                <span className="role-tag">{KIND_LABELS[m.kind] ?? m.kind}</span>{" "}
                {m.authorName} · {m.createdAt.toLocaleString()}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
            </div>
          ))
        )}
        {canReply && (
          <form action={replyToRequestAction} style={{ marginTop: "0.75rem" }}>
            <input type="hidden" name="portalSlug" value={portalSlug} />
            <input type="hidden" name="identifier" value={request.identifier} />
            <div className="form-row">
              <textarea
                name="body"
                required
                rows={2}
                aria-label="Your reply"
                placeholder="Reply to the delivery team…"
                style={{ flex: 1, fontFamily: "inherit", fontSize: "0.9rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", borderRadius: 8 }}
              />
              <button type="submit">Send</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
