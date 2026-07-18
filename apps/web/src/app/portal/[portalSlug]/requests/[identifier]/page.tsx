import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getClientRequest } from "@/server/client-requests";
import { PRIORITY_LABELS, REQUEST_TYPE_LABELS } from "@/lib/request-labels";

export default async function ClientRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ portalSlug: string; identifier: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { portalSlug, identifier } = await params;
  const { submitted } = await searchParams;
  const user = await requireUser();
  const request = await getClientRequest(user, portalSlug, identifier);
  if (!request) notFound();

  return (
    <>
      {submitted && (
        <div className="success-banner">
          Request {request.identifier} recorded. The delivery team has it — you will see
          status changes here.
        </div>
      )}
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
      </div>
    </>
  );
}
