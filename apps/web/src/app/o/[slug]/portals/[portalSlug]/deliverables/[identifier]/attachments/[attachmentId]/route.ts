import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMyOrganizationBySlug } from "@/server/organizations";
import { getInternalAttachmentUrl } from "@/server/deliverables";

/** Internal attachment download: org membership + CLEAN scan → signed URL. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; attachmentId: string }> },
): Promise<NextResponse> {
  const { slug, attachmentId } = await params;
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
  const url = await getInternalAttachmentUrl(user, org.id, attachmentId);
  if (!url) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
