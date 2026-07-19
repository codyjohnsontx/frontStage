"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPortalBySlug } from "@/server/clients";
import {
  addInternalMessage,
  closeAsDuplicate,
  decideRequest,
  getRequestThreadInternal,
  linkLinearIssue,
} from "@/server/request-communication";
import { actionErrorMessage } from "@/server/errors";

function detailPath(slug: string, portalSlug: string, identifier: string): string {
  return `/o/${slug}/portals/${portalSlug}/requests/${identifier}`;
}

const PERMISSION_MESSAGE = "You do not have permission for that request action.";

/**
 * Resolve the target request SERVER-SIDE from the route identity
 * (org slug + portal slug + identifier). The submitted requestId is never
 * trusted; it only has to agree with what we resolved.
 */
async function resolve(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const submittedRequestId = String(formData.get("requestId") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  const path = detailPath(slug, portalSlug, identifier);

  const portal = await getPortalBySlug(user, org.id, portalSlug);
  if (!portal) redirect("/orgs");
  const thread = await getRequestThreadInternal(user, org.id, portal.id, identifier);
  if (!thread) notFound();
  if (submittedRequestId && submittedRequestId !== thread.request.id) {
    redirect(`${path}?error=${encodeURIComponent("That request no longer matches this page. Reload and try again.")}`);
  }
  return { user, org, slug, portalSlug, identifier, requestId: thread.request.id, path };
}

export async function addMessageAction(formData: FormData): Promise<void> {
  const { user, org, requestId, path } = await resolve(formData);
  const kind = String(formData.get("kind") ?? "");
  const body = String(formData.get("body") ?? "");
  if (kind !== "PUBLIC_REPLY" && kind !== "INTERNAL_NOTE" && kind !== "CLARIFICATION_REQUEST") {
    redirect(`${path}?error=${encodeURIComponent("Unknown message kind.")}`);
  }
  try {
    await addInternalMessage(user, org.id, requestId, kind, body);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not add the message.", PERMISSION_MESSAGE))}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function decideRequestAction(formData: FormData): Promise<void> {
  const { user, org, requestId, path } = await resolve(formData);
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (decision !== "ACCEPTED" && decision !== "DECLINED") {
    redirect(`${path}?error=${encodeURIComponent("Unknown decision.")}`);
  }
  try {
    await decideRequest(user, org.id, requestId, decision, reason);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not record the decision.", PERMISSION_MESSAGE))}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function closeAsDuplicateAction(formData: FormData): Promise<void> {
  const { user, org, requestId, path } = await resolve(formData);
  const duplicateOf = String(formData.get("duplicateOfIdentifier") ?? "");
  try {
    await closeAsDuplicate(user, org.id, requestId, duplicateOf);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not close as duplicate.", PERMISSION_MESSAGE))}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function linkLinearIssueAction(formData: FormData): Promise<void> {
  const { user, org, requestId, path } = await resolve(formData);
  const externalId = String(formData.get("externalId") ?? "");
  const externalIdentifier = String(formData.get("externalIdentifier") ?? "");
  try {
    await linkLinearIssue(user, org.id, requestId, externalId, externalIdentifier);
  } catch (err) {
    redirect(`${path}?error=${encodeURIComponent(actionErrorMessage(err, "Could not link the Linear issue.", PERMISSION_MESSAGE))}`);
  }
  revalidatePath(path);
  redirect(path);
}
