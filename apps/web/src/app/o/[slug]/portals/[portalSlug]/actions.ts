"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { createDraftFromSource } from "@/server/projections";
import { getPortalBySlug } from "@/server/clients";
import {
  invitePortalMember,
  isClientInvitableRole,
  removePortalMember,
} from "@/server/portal-members";
import { revokeInvitation } from "@/server/invitations";
import { actionErrorMessage } from "@/server/errors";

function portalPath(slug: string, portalSlug: string): string {
  return `/o/${slug}/portals/${portalSlug}`;
}

export async function createDraftAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const portalId = String(formData.get("portalId") ?? "");
  const sourceObjectId = String(formData.get("sourceObjectId") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");

  let identifier: string;
  try {
    identifier = await createDraftFromSource(user, org.id, portalId, sourceObjectId);
  } catch (err) {
    const message = actionErrorMessage(
      err,
      "Could not create the draft.",
      "You do not have permission to create projections.",
    );
    redirect(`/o/${slug}/portals/${portalSlug}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/o/${slug}/portals/${portalSlug}`);
  redirect(`/o/${slug}/portals/${portalSlug}/projects/${identifier}`);
}

export async function inviteClientAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const email = String(formData.get("email") ?? "");
  const roleKey = String(formData.get("roleKey") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  const path = portalPath(slug, portalSlug);
  if (!isClientInvitableRole(roleKey)) {
    redirect(`${path}?error=${encodeURIComponent("Unknown client role.")}`);
  }
  // Resolve the portal outside the try so redirect() control flow is never
  // intercepted by the error handling below.
  const portal = await getPortalBySlug(user, org.id, portalSlug);
  if (!portal) redirect("/orgs");
  try {
    await invitePortalMember(
      user,
      org.id,
      { id: portal.id, name: portal.name },
      org.name,
      email,
      roleKey,
    );
  } catch (err) {
    const message = actionErrorMessage(
      err,
      "Could not create the invitation.",
      "You do not have permission to manage this portal's members.",
    );
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(path);
  redirect(`${path}?invited=${encodeURIComponent(email)}`);
}

export async function removeClientMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  const path = portalPath(slug, portalSlug);
  try {
    await removePortalMember(user, org.id, membershipId);
  } catch (err) {
    const message = actionErrorMessage(
      err,
      "Could not remove the member.",
      "You do not have permission to manage this portal's members.",
    );
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function revokeClientInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const invitationId = String(formData.get("invitationId") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  const path = portalPath(slug, portalSlug);
  try {
    await revokeInvitation(user, org.id, invitationId);
  } catch (err) {
    const message = actionErrorMessage(
      err,
      "Could not revoke the invitation.",
      "You do not have permission to manage this portal's members.",
    );
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(path);
  redirect(path);
}
