"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import {
  publishProjection,
  resolveSourceChange,
  setWorkItemCuration,
  updateProjectionDraft,
} from "@/server/projections";
import { PermissionDeniedError } from "@/server/authz";

function editorPath(slug: string, portalSlug: string, identifier: string): string {
  return `/o/${slug}/portals/${portalSlug}/projects/${identifier}`;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission for that action.";
  return err instanceof Error ? err.message : fallback;
}

async function resolveOrg(slug: string) {
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  return { user, org };
}

export async function updateDraftAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const { user, org } = await resolveOrg(slug);
  const path = editorPath(slug, portalSlug, identifier);
  try {
    await updateProjectionDraft(user, org.id, identifier, {
      name: String(formData.get("name") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      health: String(formData.get("health") ?? "NOT_SET"),
    });
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(errorMessage(err, "Could not save the draft."))}`);
  }
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function setVisibilityAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const workItemId = String(formData.get("workItemId") ?? "");
  const visibility = String(formData.get("visibility") ?? "");
  const { user, org } = await resolveOrg(slug);
  const path = editorPath(slug, portalSlug, identifier);
  if (visibility !== "INTERNAL" && visibility !== "CLIENT_VISIBLE") redirect(path);
  try {
    await setWorkItemCuration(user, org.id, workItemId, { visibility });
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(errorMessage(err, "Could not update visibility."))}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function updateClientTitleAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const workItemId = String(formData.get("workItemId") ?? "");
  const clientTitle = String(formData.get("clientTitle") ?? "");
  const { user, org } = await resolveOrg(slug);
  const path = editorPath(slug, portalSlug, identifier);
  if (!clientTitle.trim()) redirect(path);
  try {
    await setWorkItemCuration(user, org.id, workItemId, { clientTitle });
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(errorMessage(err, "Could not update the title."))}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function resolveChangeAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const workItemId = String(formData.get("workItemId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const { user, org } = await resolveOrg(slug);
  const path = editorPath(slug, portalSlug, identifier);
  if (decision !== "apply" && decision !== "ignore") redirect(path);
  try {
    await resolveSourceChange(user, org.id, workItemId, decision);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(errorMessage(err, "Could not resolve the change."))}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function publishAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const { user, org } = await resolveOrg(slug);
  const path = editorPath(slug, portalSlug, identifier);
  let version: number;
  try {
    version = await publishProjection(user, org.id, identifier);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(errorMessage(err, "Could not publish."))}`);
  }
  revalidatePath(path);
  redirect(`${path}?published=${version}`);
}
