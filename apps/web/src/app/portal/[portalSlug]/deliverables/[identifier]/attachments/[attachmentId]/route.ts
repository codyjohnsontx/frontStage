import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getClientAttachmentUrl } from "@/server/deliverables";

/**
 * Client attachment download: 302 to a short-lived signed URL. Access
 * requires portal membership, the attachment being embedded in the latest
 * frozen version of a client-visible deliverable, and a CLEAN scan.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ portalSlug: string; identifier: string; attachmentId: string }> },
): Promise<NextResponse> {
  const { portalSlug, identifier, attachmentId } = await params;
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const user = {
    id: session.user.id,
    email: session.user.email.toLowerCase(),
    name: session.user.name ?? null,
  };
  const url = await getClientAttachmentUrl(user, portalSlug, identifier, attachmentId);
  if (!url) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
