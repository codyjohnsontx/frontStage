"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { inviteMember, isInvitableRole, revokeInvitation } from "@/server/invitations";
import { PermissionDeniedError } from "@/server/authz";

function membersPath(slug: string): string {
  return `/o/${slug}/members`;
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const email = String(formData.get("email") ?? "");
  const roleKey = String(formData.get("roleKey") ?? "");

  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  if (!isInvitableRole(roleKey)) {
    redirect(`${membersPath(slug)}?error=${encodeURIComponent("Unknown role.")}`);
  }

  try {
    await inviteMember(user, org.id, org.name, email, roleKey);
  } catch (err) {
    const message =
      err instanceof PermissionDeniedError
        ? "You do not have permission to invite members."
        : err instanceof Error
          ? err.message
          : "Could not create the invitation.";
    redirect(`${membersPath(slug)}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(membersPath(slug));
  redirect(`${membersPath(slug)}?invited=${encodeURIComponent(email)}`);
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const invitationId = String(formData.get("invitationId") ?? "");

  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");

  try {
    await revokeInvitation(user, org.id, invitationId);
  } catch (err) {
    const message =
      err instanceof PermissionDeniedError
        ? "You do not have permission to revoke invitations."
        : err instanceof Error
          ? err.message
          : "Could not revoke the invitation.";
    redirect(`${membersPath(slug)}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(membersPath(slug));
  redirect(membersPath(slug));
}
