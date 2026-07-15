/**
 * Capability-based permissions. Domain services check permissions, never
 * role names. Roles are predefined bundles of these (see roles.ts), so
 * custom roles can be added later without touching call sites.
 */
export type Permission =
  | "organization.manage"
  | "organization.security.manage"
  | "organization.export"
  | "integrations.manage"
  | "portal.create"
  | "portal.manage"
  | "portal.members.manage"
  | "project.create"
  | "project.edit"
  | "project.publish"
  | "project.health.update"
  | "project.history.view"
  | "update.draft"
  | "update.publish"
  | "deliverable.create"
  | "deliverable.edit"
  | "deliverable.publish"
  | "deliverable.approve"
  | "request.submit"
  | "request.triage"
  | "comment.create"
  | "comment.internal.create"
  | "meeting.create"
  | "meeting.drive"
  | "audit.view";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "organization.manage",
  "organization.security.manage",
  "organization.export",
  "integrations.manage",
  "portal.create",
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
  "deliverable.approve",
  "request.submit",
  "request.triage",
  "comment.create",
  "comment.internal.create",
  "meeting.create",
  "meeting.drive",
  "audit.view",
];

/**
 * Permissions that must never be granted to client-side roles. Used as a
 * static invariant (tested) so a future role edit cannot silently leak
 * internal capabilities to clients.
 */
export const INTERNAL_ONLY_PERMISSIONS: readonly Permission[] = [
  "organization.manage",
  "organization.security.manage",
  "organization.export",
  "integrations.manage",
  "portal.create",
  "portal.manage",
  "portal.members.manage",
  "project.create",
  "project.edit",
  "project.publish",
  "project.health.update",
  "update.draft",
  "update.publish",
  "deliverable.create",
  "deliverable.edit",
  "deliverable.publish",
  "request.triage",
  "comment.internal.create",
  "meeting.drive",
  "audit.view",
];
