"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { DeliverableStatus } from "@frontstage/database";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPortalBySlug } from "@/server/clients";
import {
  createDeliverable,
  getDeliverableInternal,
  setDeliverableSourceLink,
  transitionDeliverable,
  updateDeliverableDraft,
} from "@/server/deliverables";
import { actionErrorMessage } from "@/server/errors";

const PERMISSION_MESSAGE = "You do not have permission for that deliverable action.";

function listPath(slug: string, portalSlug: string): string {
  return `/o/${slug}/portals/${portalSlug}/deliverables`;
}
function detailPath(slug: string, portalSlug: string, identifier: string): string {
  return `${listPath(slug, portalSlug)}/${identifier}`;
}

function contentFrom(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    scope: String(formData.get("scope") ?? ""),
    acceptanceCriteria: String(formData.get("acceptanceCriteria") ?? ""),
    targetDate: String(formData.get("targetDate") ?? ""),
  };
}

async function resolvePortal(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  const portal = await getPortalBySlug(user, org.id, portalSlug);
  if (!portal) redirect("/orgs");
  return { user, org, slug, portalSlug, portal };
}

/** Resolve the deliverable server-side from the route identity. */
async function resolveDeliverable(formData: FormData) {
  const base = await resolvePortal(formData);
  const identifier = String(formData.get("identifier") ?? "");
  const path = detailPath(base.slug, base.portalSlug, identifier);
  let found: Awaited<ReturnType<typeof getDeliverableInternal>>;
  try {
    found = await getDeliverableInternal(base.user, base.org.id, base.portal.id, identifier);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not load that deliverable.", PERMISSION_MESSAGE))}`);
  }
  if (!found) notFound();
  return { ...base, identifier, path, deliverableId: found.deliverable.id };
}

export async function createDeliverableAction(formData: FormData): Promise<void> {
  const { user, org, slug, portalSlug, portal } = await resolvePortal(formData);
  const path = listPath(slug, portalSlug);
  let identifier: string;
  try {
    identifier = await createDeliverable(user, org.id, portal.id, contentFrom(formData));
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not create the deliverable.", PERMISSION_MESSAGE))}`);
  }
  revalidatePath(path);
  redirect(detailPath(slug, portalSlug, identifier));
}

export async function updateDeliverableAction(formData: FormData): Promise<void> {
  const { user, org, path, deliverableId } = await resolveDeliverable(formData);
  try {
    await updateDeliverableDraft(user, org.id, deliverableId, contentFrom(formData));
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not save the deliverable.", PERMISSION_MESSAGE))}`);
  }
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function transitionDeliverableAction(formData: FormData): Promise<void> {
  const { user, org, path, deliverableId } = await resolveDeliverable(formData);
  const target = String(formData.get("target") ?? "") as DeliverableStatus;
  try {
    await transitionDeliverable(user, org.id, deliverableId, target);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not update the status.", PERMISSION_MESSAGE))}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function toggleSourceLinkAction(formData: FormData): Promise<void> {
  const { user, org, path, deliverableId } = await resolveDeliverable(formData);
  const sourceObjectId = String(formData.get("sourceObjectId") ?? "");
  const relationship = String(formData.get("relationship") ?? "");
  try {
    await setDeliverableSourceLink(user, org.id, deliverableId, sourceObjectId, relationship);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not update source links.", PERMISSION_MESSAGE))}`);
  }
  revalidatePath(path);
  redirect(path);
}
