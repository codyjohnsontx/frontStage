"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";
import {
  connectFixtureWorkspace,
  requestSync,
  simulateSourceChange,
  startLinearOAuth,
} from "@/server/integrations";
import { actionErrorMessage } from "@/server/errors";

function pagePath(slug: string): string {
  return `/o/${slug}/integrations`;
}

function errorMessage(err: unknown, fallback: string): string {
  return actionErrorMessage(err, fallback, "You do not have permission to manage integrations.");
}

export async function connectFixtureAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  try {
    await connectFixtureWorkspace(user, org.id);
  } catch (err) {
    redirect(`${pagePath(slug)}?error=${encodeURIComponent(errorMessage(err, "Could not connect."))}`);
  }
  revalidatePath(pagePath(slug));
  redirect(`${pagePath(slug)}?connected=1`);
}

export async function startOAuthAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  let authorizeUrl: string;
  try {
    const result = await startLinearOAuth(user, org.id);
    authorizeUrl = result.authorizeUrl;
    const cookieStore = await cookies();
    cookieStore.set("linear_oauth_state", result.state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
  } catch (err) {
    redirect(`${pagePath(slug)}?error=${encodeURIComponent(errorMessage(err, "Could not start OAuth."))}`);
  }
  redirect(authorizeUrl);
}

export async function syncNowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  try {
    await requestSync(user, org.id);
  } catch (err) {
    redirect(`${pagePath(slug)}?error=${encodeURIComponent(errorMessage(err, "Could not request sync."))}`);
  }
  revalidatePath(pagePath(slug));
  redirect(`${pagePath(slug)}?synced=1`);
}

export async function simulateChangeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const sourceObjectId = String(formData.get("sourceObjectId") ?? "");
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) redirect("/orgs");
  try {
    await simulateSourceChange(user, org.id, sourceObjectId);
  } catch (err) {
    redirect(`${pagePath(slug)}?error=${encodeURIComponent(errorMessage(err, "Could not simulate."))}`);
  }
  revalidatePath(pagePath(slug));
  redirect(`${pagePath(slug)}?simulated=1`);
}
