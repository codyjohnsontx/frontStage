/**
 * Canonical work-system types. The Frontstage domain only ever sees these —
 * provider payloads (Linear, later Jira/GitHub) are mapped at the adapter
 * boundary and never leak inward.
 */

export type Provider = "linear";

export interface ExternalReference {
  provider: Provider;
  id: string;
  url?: string;
}

/** Provider-agnostic workflow state category (Linear's six state types). */
export type CanonicalStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export interface CanonicalProject {
  id: string;
  name: string;
  description: string;
  state?: string;
  targetDate?: string;
  url?: string;
  updatedAt: string;
}

export interface CanonicalWorkItem {
  id: string;
  projectId?: string;
  identifier?: string;
  title: string;
  description?: string;
  stateType: CanonicalStateType;
  stateName: string;
  priority?: number;
  assigneeName?: string;
  labels: string[];
  estimate?: number;
  url?: string;
  updatedAt: string;
  archived?: boolean;
}

export interface AdapterCapabilities {
  projects: { read: boolean; write: boolean };
  workItems: { read: boolean; create: boolean; update: boolean };
  comments: { read: boolean; create: boolean; edit: boolean };
  webhooks: boolean;
  attachments: boolean;
}

/**
 * Decrypted credentials handed to an adapter call. Adapters never touch the
 * DB. Discriminated union: an oauth auth without a token cannot compile.
 */
export type ConnectionAuth =
  | { mode: "fixture" }
  | { mode: "oauth"; accessToken: string };

/** Discriminated union: a successful verification always carries a payload. */
export type VerifiedWebhookEvent =
  | { ok: true; payload: unknown; eventType?: string; deliveryId?: string }
  | { ok: false; reason: string };

export interface WorkSystemAdapter {
  provider: Provider;
  capabilities(): AdapterCapabilities;

  listProjects(auth: ConnectionAuth): Promise<CanonicalProject[]>;
  listWorkItems(auth: ConnectionAuth, projectId?: string): Promise<CanonicalWorkItem[]>;
  getProject(auth: ConnectionAuth, id: string): Promise<CanonicalProject | null>;
  getWorkItem(auth: ConnectionAuth, id: string): Promise<CanonicalWorkItem | null>;

  /** Verify a webhook delivery from raw body + headers. */
  verifyWebhook(rawBody: string, headers: Record<string, string | null>): VerifiedWebhookEvent;
}
