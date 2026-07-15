import type { Permission } from "./permissions";
import { ALL_PERMISSIONS } from "./permissions";

/** Mirrors the RoleKey enum in @frontstage/database. */
export type RoleKey =
  | "ORGANIZATION_OWNER"
  | "ORGANIZATION_ADMIN"
  | "PORTAL_ADMIN"
  | "PROJECT_LEAD"
  | "CONTRIBUTOR"
  | "INTERNAL_VIEWER"
  | "CLIENT_ADMIN"
  | "CLIENT_APPROVER"
  | "CLIENT_CONTRIBUTOR"
  | "CLIENT_VIEWER";

export const INTERNAL_ROLES: readonly RoleKey[] = [
  "ORGANIZATION_OWNER",
  "ORGANIZATION_ADMIN",
  "PORTAL_ADMIN",
  "PROJECT_LEAD",
  "CONTRIBUTOR",
  "INTERNAL_VIEWER",
];

export const CLIENT_ROLES: readonly RoleKey[] = [
  "CLIENT_ADMIN",
  "CLIENT_APPROVER",
  "CLIENT_CONTRIBUTOR",
  "CLIENT_VIEWER",
];

export function isClientRole(role: RoleKey): boolean {
  return (CLIENT_ROLES as readonly string[]).includes(role);
}

/**
 * Predefined permission bundles. ORGANIZATION_OWNER is a superset of
 * ORGANIZATION_ADMIN today; it exists as a distinct role because ownership
 * transfer, billing, and organization deletion (future capabilities) will
 * belong only to the owner.
 *
 * Read access for viewer roles is governed by the visibility layer, not by
 * write capabilities — CLIENT_VIEWER intentionally has an empty bundle.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  ORGANIZATION_OWNER: ALL_PERMISSIONS,
  ORGANIZATION_ADMIN: ALL_PERMISSIONS,
  PORTAL_ADMIN: [
    "portal.manage",
    "portal.members.manage",
    "project.create",
    "project.edit",
    "project.publish",
    "project.health.update",
    "project.history.view",
    "update.draft",
    "update.publish",
    "deliverable.create",
    "deliverable.edit",
    "deliverable.publish",
    "request.triage",
    "comment.create",
    "comment.internal.create",
    "meeting.create",
    "meeting.drive",
    "audit.view",
  ],
  PROJECT_LEAD: [
    "project.edit",
    "project.publish",
    "project.health.update",
    "project.history.view",
    "update.draft",
    "update.publish",
    "deliverable.create",
    "deliverable.edit",
    "deliverable.publish",
    "request.triage",
    "comment.create",
    "comment.internal.create",
    "meeting.create",
    "meeting.drive",
  ],
  CONTRIBUTOR: [
    "update.draft",
    "request.triage",
    "comment.create",
    "comment.internal.create",
    "project.history.view",
  ],
  INTERNAL_VIEWER: ["project.history.view"],
  CLIENT_ADMIN: ["request.submit", "comment.create"],
  CLIENT_APPROVER: ["deliverable.approve", "request.submit", "comment.create"],
  CLIENT_CONTRIBUTOR: ["request.submit", "comment.create"],
  CLIENT_VIEWER: [],
};
