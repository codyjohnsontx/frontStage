"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { createOrganization } from "@/server/organizations";

export async function createOrganizationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "");
  const org = await createOrganization(user, name);
  redirect(`/o/${org.slug}`);
}
