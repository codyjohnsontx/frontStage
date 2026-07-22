import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getClientDeliverable } from "@/server/deliverables";
import { DELIVERABLE_STATUS_LABELS } from "@/server/deliverable-view";

export default async function ClientDeliverableDetailPage({
  params,
}: {
  params: Promise<{ portalSlug: string; identifier: string }>;
}) {
  const { portalSlug, identifier } = await params;
  const user = await requireUser();
  const found = await getClientDeliverable(user, portalSlug, identifier);
  if (!found) notFound();
  const { content, status, version, frozenAt } = found;

  return (
    <>
      <p className="muted" style={{ marginBottom: 0 }}>
        <Link href={`/portal/${portalSlug}/deliverables`}>← Deliverables</Link> ·{" "}
        {content.identifier}
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{content.title}</h1>

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          <span className="role-tag">{DELIVERABLE_STATUS_LABELS[status] ?? status}</span> · version{" "}
          {version}, shared {frozenAt.toLocaleString()}
          {content.targetDate && ` · target ${content.targetDate}`}
        </p>
        {content.description && <p style={{ whiteSpace: "pre-wrap" }}>{content.description}</p>}
      </div>

      {content.scope && (
        <div className="card">
          <h2>Scope</h2>
          <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{content.scope}</p>
        </div>
      )}

      {content.acceptanceCriteria && (
        <div className="card">
          <h2>Acceptance criteria</h2>
          <p className="muted">This is what this version is measured against.</p>
          <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{content.acceptanceCriteria}</p>
        </div>
      )}

      {status === "READY_FOR_REVIEW" && (
        <div className="card">
          <h2>Your review</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            Approving this exact version is coming next — the approval will record which
            version you accepted.
          </p>
        </div>
      )}
    </>
  );
}
