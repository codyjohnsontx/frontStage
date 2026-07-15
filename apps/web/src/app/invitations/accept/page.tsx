import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireUser } from "@/server/session";
import { previewInvitation } from "@/server/invitations";
import { acceptInvitationAction } from "./actions";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  // Send unauthenticated users to login, then back here.
  const session = await auth();
  if (!session?.user?.id) {
    const callback = token
      ? `/invitations/accept?token=${encodeURIComponent(token)}`
      : "/invitations/accept";
    redirect(`/login?callbackUrl=${encodeURIComponent(callback)}`);
  }

  if (!token) {
    return (
      <main className="container" style={{ maxWidth: 480 }}>
        <div className="card">
          <h1>Invitation</h1>
          <div className="error-banner">This invitation link is missing its token.</div>
          <Link href="/orgs">Go to your organizations</Link>
        </div>
      </main>
    );
  }

  const user = await requireUser();
  const preview = await previewInvitation(user, token);

  return (
    <main className="container" style={{ maxWidth: 480 }}>
      <div className="card">
        <h1>Invitation</h1>
        {error && <div className="error-banner">{error}</div>}
        {preview.ok ? (
          <>
            <p>
              You have been invited to join <strong>{preview.organizationName}</strong> as{" "}
              <span className="role-tag">
                {preview.roleKey.toLowerCase().replace(/_/g, " ")}
              </span>
            </p>
            <p className="muted">Signed in as {user.email}.</p>
            <form action={acceptInvitationAction}>
              <input type="hidden" name="token" value={token} />
              <button type="submit">Accept invitation</button>
            </form>
          </>
        ) : (
          <>
            <div className="error-banner">{preview.reason}</div>
            <p className="muted">
              Signed in as {user.email}. If the invitation was sent to a
              different address, sign in with that account instead.
            </p>
            <Link href="/orgs">Go to your organizations</Link>
          </>
        )}
      </div>
    </main>
  );
}
