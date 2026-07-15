"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { createDraftFromSource } from "@/server/projections";
import { PermissionDeniedError } from "@/server/authz";

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
    const message =
      err instanceof PermissionDeniedError
        ? "You do not have permission to create projections."
        : err instanceof Error
          ? err.message
          : "Could not create the draft.";
    redirect(`/o/${slug}/portals/${portalSlug}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/o/${slug}/portals/${portalSlug}`);
  redirect(`/o/${slug}/portals/${portalSlug}/projects/${identifier}`);
}
