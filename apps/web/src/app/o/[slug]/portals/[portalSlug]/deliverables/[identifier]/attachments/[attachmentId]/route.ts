import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getPortalBySlug } from "@/server/clients";
import { getInternalAttachmentUrl } from "@/server/deliverables";

/**
 * Internal attachment download → 302 to a short-lived signed URL. Every
 * route segment participates in authorization: the attachment must belong
 * to this portal's deliverable and the caller must hold deliverable.edit
 * on that portal.
 */
export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ slug: string; portalSlug: string; identifier: string; attachmentId: string }>;
  },
): Promise<NextResponse> {
  const { slug, portalSlug, identifier, attachmentId } = await params;
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const user = {
    id: session.user.id,
    email: session.user.email.toLowerCase(),
    name: session.user.name ?? null,
  };
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const portal = await getPortalBySlug(user, org.id, portalSlug);
  if (!portal) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const url = await getInternalAttachmentUrl(user, org.id, portal.id, identifier, attachmentId);
  if (!url) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
