"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/session";
import { submitClientRequest } from "@/server/client-requests";
import { addClientMessage } from "@/server/request-communication";
import { actionErrorMessage } from "@/server/errors";

export async function replyToRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const body = String(formData.get("body") ?? "");
  const path = `/portal/${portalSlug}/requests/${identifier}`;
  try {
    await addClientMessage(user, portalSlug, identifier, body);
  } catch (err) {
    const message = actionErrorMessage(
      err,
      "Could not send your reply.",
      "Your role cannot reply on this portal.",
    );
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(path);
  redirect(path);
}

export async function submitRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const portalSlug = String(formData.get("portalSlug") ?? "");
  const base = `/portal/${portalSlug}/requests`;

  let identifier: string;
  try {
    identifier = await submitClientRequest(user, portalSlug, {
      type: String(formData.get("type") ?? ""),
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      clientPriority: String(formData.get("clientPriority") ?? "NORMAL"),
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
  } catch (err) {
    const message = actionErrorMessage(
      err,
      "Could not submit the request.",
      "Your role cannot submit requests on this portal.",
    );
    redirect(`${base}/new?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(base);
  redirect(`${base}/${identifier}?submitted=1`);
}
