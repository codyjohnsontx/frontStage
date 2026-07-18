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
}

export function requestClientView(request: InternalRequestData): ClientRequestView {
  return {
    identifier: request.identifier,
    type: request.type,
    title: request.title,
    description: request.description,
    status: request.status,
    statusLabel: REQUEST_STATUS_LABELS[request.status] ?? request.status,
    clientPriority: request.clientPriority,
    createdAt: request.createdAt,
  };
}
