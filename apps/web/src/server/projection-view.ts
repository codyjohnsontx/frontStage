import { mapStatus, type CanonicalStateType, type ClientStatus } from "@frontstage/integration-core";

/**
 * Pure projection from internal data to the client-safe view. This function
 * is the leak boundary: everything a client-facing page or snapshot renders
 * goes through here, and ONLY the fields returned here may reach a client.
 *
 * Deliberately excluded: internal source titles/descriptions, engineering
 * state names, estimates, assignees, labels, priorities, source URLs/ids.
 */

export interface InternalWorkItemData {
  id: string;
  clientTitle: string;
  clientDescription: string | null;
  visibility: "INTERNAL" | "CLIENT_VISIBLE";
  archivedFromSource: boolean;
  source: {
    stateType: string;
    // Internal-only fields intentionally present in the INPUT so tests can
    // prove they never survive into the output.
    title?: string;
    description?: string | null;
    stateName?: string | null;
    labels?: string[];
    estimate?: number | null;
    assigneeName?: string | null;
    url?: string | null;
  };
}

export interface ClientWorkItemView {
  id: string;
  title: string;
  description: string | null;
  status: ClientStatus;
  archivedNote: string | null;
}

export interface ClientProjectView {
  identifier: string;
  name: string;
  summary: string;
  health: string;
  workItems: ClientWorkItemView[];
}

const STATE_TYPES: readonly CanonicalStateType[] = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

export function projectClientView(
  project: { identifier: string; name: string; summary: string; health: string },
  workItems: InternalWorkItemData[],
  statusMapping?: Partial<Record<string, string>> | null,
): ClientProjectView {
  return {
    identifier: project.identifier,
    name: project.name,
    summary: project.summary,
    health: project.health,
    workItems: workItems
      .filter((w) => w.visibility === "CLIENT_VISIBLE")
      .map((w) => {
        const stateType = (STATE_TYPES as readonly string[]).includes(w.source.stateType)
          ? (w.source.stateType as CanonicalStateType)
          : "backlog";
        return {
          id: w.id,
          title: w.clientTitle,
          description: w.clientDescription,
          status: mapStatus(stateType, statusMapping),
          archivedNote: w.archivedFromSource
            ? "This work item was archived internally. Its published history remains available for reference."
            : null,
        };
      }),
  };
}
