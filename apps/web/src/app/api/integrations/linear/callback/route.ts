import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createLogger } from "@frontstage/observability";
import { auth } from "@/auth";
import { completeLinearOAuth } from "@/server/integrations";
import { getMyOrganizationBySlug, listMyOrganizations } from "@/server/organizations";

const log = createLogger({ component: "web.integrations.callback" });

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
    // Log the real exception server-side; never surface raw provider or
    // database error text through the redirect.
    log.error("linear_oauth_callback_failed", {
      organizationId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return NextResponse.redirect(
      `${appUrl}/o/${org.slug}/integrations?error=${encodeURIComponent("Linear connection failed. Check the server logs and try reconnecting.")}`,
    );
  }
  return NextResponse.redirect(`${appUrl}/o/${org.slug}/integrations?connected=1`);
}
