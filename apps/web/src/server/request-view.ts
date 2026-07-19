import { REQUEST_STATUS_LABELS } from "@/lib/request-labels";

/**
 * Pure projection from a request row to the client-safe view — the leak
 * boundary for requests, mirroring projectClientView(). Internal-only
 * fields (internal priority, Linear ids/identifiers, sync state/errors)
 * exist on the INPUT type so tests can prove they never reach the output.
 */

export interface InternalRequestData {
  identifier: string;
  type: string;
  title: string;
  description: string;
  status: string;
  clientPriority: string;
  createdAt: Date;
  // Internal-only — deliberately absent from ClientRequestView.
  internalPriority?: string | null;
  linearIssueId?: string | null;
  linearIssueIdentifier?: string | null;
  linearSyncState?: string | null;
  linearSyncError?: string | null;
}

export interface ClientRequestView {
  identifier: string;
  type: string;
  title: string;
  description: string;
  status: string;
  statusLabel: string;
  clientPriority: string;
  createdAt: Date;
  /** Formal decision reason — client-visible ONLY once decided (§27). */
  decisionReason: string | null;
  /** Set when closed as a duplicate of another request on this portal. */
  duplicateOfIdentifier: string | null;
}

export function requestClientView(
  request: InternalRequestData & { decisionReason?: string | null },
  duplicateOfIdentifier: string | null = null,
): ClientRequestView {
  const decided = request.status === "ACCEPTED" || request.status === "DECLINED";
  return {
    identifier: request.identifier,
    type: request.type,
    title: request.title,
    description: request.description,
    status: request.status,
    statusLabel: REQUEST_STATUS_LABELS[request.status] ?? request.status,
    clientPriority: request.clientPriority,
    createdAt: request.createdAt,
    decisionReason: decided ? (request.decisionReason ?? null) : null,
    duplicateOfIdentifier,
  };
}

/**
 * Message leak boundary: INTERNAL_NOTE rows never survive into client
 * output, and Linear sync fields are stripped from everything else.
 */
export interface InternalMessageData {
  id: string;
  kind: string;
  body: string;
  authorName: string;
  createdAt: Date;
  // Internal-only — deliberately absent from ClientMessageView.
  linearSyncState?: string | null;
  linearCommentId?: string | null;
}

export interface ClientMessageView {
  id: string;
  kind: string;
  body: string;
  authorName: string;
  createdAt: Date;
}

export function messagesClientView(messages: InternalMessageData[]): ClientMessageView[] {
  return messages
    .filter((m) => m.kind !== "INTERNAL_NOTE")
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      authorName: m.authorName,
      createdAt: m.createdAt,
    }));
}
