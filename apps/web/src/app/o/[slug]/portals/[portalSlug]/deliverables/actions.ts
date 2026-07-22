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

/** Run a domain op; on failure redirect to `path` with the safe message. */
async function attempt<T>(path: string, fallback: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, fallback, PERMISSION_MESSAGE))}`);
  }
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
  const found = await attempt(path, "Could not load that deliverable.", () =>
    getDeliverableInternal(base.user, base.org.id, base.portal.id, identifier),
  );
  if (!found) notFound();
  return { ...base, identifier, path, deliverableId: found.deliverable.id };
}

export async function createDeliverableAction(formData: FormData): Promise<void> {
  const { user, org, slug, portalSlug, portal } = await resolvePortal(formData);
  const path = listPath(slug, portalSlug);
  const identifier = await attempt(path, "Could not create the deliverable.", () =>
    createDeliverable(user, org.id, portal.id, contentFrom(formData)),
  );
  revalidatePath(path);
  redirect(detailPath(slug, portalSlug, identifier));
}

export async function updateDeliverableAction(formData: FormData): Promise<void> {
  const { user, org, path, deliverableId } = await resolveDeliverable(formData);
  await attempt(path, "Could not save the deliverable.", () =>
    updateDeliverableDraft(user, org.id, deliverableId, contentFrom(formData)),
  );
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function transitionDeliverableAction(formData: FormData): Promise<void> {
  const { user, org, path, deliverableId } = await resolveDeliverable(formData);
  const target = String(formData.get("target") ?? "") as DeliverableStatus;
  await attempt(path, "Could not update the status.", () =>
    transitionDeliverable(user, org.id, deliverableId, target),
  );
  revalidatePath(path);
  redirect(path);
}

export async function toggleSourceLinkAction(formData: FormData): Promise<void> {
  const { user, org, path, deliverableId } = await resolveDeliverable(formData);
  const sourceObjectId = String(formData.get("sourceObjectId") ?? "");
  const relationship = String(formData.get("relationship") ?? "");
  await attempt(path, "Could not update source links.", () =>
    setDeliverableSourceLink(user, org.id, deliverableId, sourceObjectId, relationship),
  );
  revalidatePath(path);
  redirect(path);
}
