"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { createClientOrganization, createPortal } from "@/server/clients";
import { PermissionDeniedError } from "@/server/authz";

function pagePath(slug: string): string {
  return `/o/${slug}/clients`;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to manage clients and portals.";
  return err instanceof Error ? err.message : fallback;
}

export async function createClientAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const name = String(formData.get("name") ?? "");
  const prefix = String(formData.get("prefix") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  try {
    await createClientOrganization(user, org.id, name, prefix);
  } catch (err) {
    redirect(`${pagePath(slug)}?error=${encodeURIComponent(errorMessage(err, "Could not create client."))}`);
  }
  revalidatePath(pagePath(slug));
  redirect(pagePath(slug));
}

export async function createPortalAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const clientOrganizationId = String(formData.get("clientOrganizationId") ?? "");
  const name = String(formData.get("name") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  try {
    await createPortal(user, org.id, clientOrganizationId, name);
  } catch (err) {
    redirect(`${pagePath(slug)}?error=${encodeURIComponent(errorMessage(err, "Could not create portal."))}`);
  }
  revalidatePath(pagePath(slug));
  redirect(pagePath(slug));
}
