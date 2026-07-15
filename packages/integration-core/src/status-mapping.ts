import type { CanonicalStateType } from "./canonical";

/**
 * Client-facing simplified statuses (§21 of the brief). Several internal
 * states map to one client status; mappings are configurable per portal.
 */
export type ClientStatus =
  | "Under Review"
  | "Planned"
  | "In Progress"
  | "Validation"
  | "At Risk"
  | "Needs Your Review"
  | "Complete"
  | "Closed";

export const CLIENT_STATUSES: readonly ClientStatus[] = [
  "Under Review",
  "Planned",
  "In Progress",
  "Validation",
  "At Risk",
  "Needs Your Review",
  "Complete",
  "Closed",
];

export type StatusMapping = Record<CanonicalStateType, ClientStatus>;

export const DEFAULT_STATUS_MAPPING: StatusMapping = {
  triage: "Under Review",
  backlog: "Planned",
  unstarted: "Planned",
  started: "In Progress",
  completed: "Complete",
  canceled: "Closed",
};

/**
 * Resolve the client status for an internal state type, applying an
 * optional per-portal override on top of the defaults. Unknown/invalid
 * override values fall back to the default rather than leaking raw state.
 */
export function mapStatus(
  stateType: CanonicalStateType,
  override?: Partial<Record<string, string>> | null,
): ClientStatus {
  const candidate = override?.[stateType];
  if (candidate && (CLIENT_STATUSES as readonly string[]).includes(candidate)) {
    return candidate as ClientStatus;
  }
  return DEFAULT_STATUS_MAPPING[stateType];
}
