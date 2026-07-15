import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { completeLinearOAuth } from "@/server/integrations";
import { getMyOrganizationBySlug, listMyOrganizations } from "@/server/organizations";

/**
 * Linear OAuth callback. State was set as an HttpOnly cookie when the flow
 * started; it binds the callback to the org AND the browser session.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.redirect(`${appUrl}/login`);
  }
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("linear_oauth_state")?.value;
  cookieStore.delete("linear_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${appUrl}/orgs?error=${encodeURIComponent("Linear authorization failed (state mismatch).")}`);
  }

  const organizationId = state.split(".")[0] ?? "";
  const user = {
    id: session.user.id,
    email: session.user.email.toLowerCase(),
    name: session.user.name ?? null,
  };
  // Resolve the org slug for redirect + membership re-check.
  const orgs = await listMyOrganizations(user);
  const org = orgs.find((o) => o.id === organizationId);
  if (!org || !(await getMyOrganizationBySlug(user, org.slug))) {
    return NextResponse.redirect(`${appUrl}/orgs`);
  }

  try {
    await completeLinearOAuth(user, organizationId, code);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Linear connection failed.";
    return NextResponse.redirect(
      `${appUrl}/o/${org.slug}/integrations?error=${encodeURIComponent(message)}`,
    );
  }
  return NextResponse.redirect(`${appUrl}/o/${org.slug}/integrations?connected=1`);
}
