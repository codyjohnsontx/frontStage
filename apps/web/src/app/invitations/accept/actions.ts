"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { acceptInvitation } from "@/server/invitations";

export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get("token") ?? "");
  const result = await acceptInvitation(user, token);
  if (result.ok) {
    redirect(`/o/${result.organizationSlug}?joined=1`);
  }
  redirect(`/invitations/accept?token=${encodeURIComponent(token)}&error=${encodeURIComponent(result.reason)}`);
}
