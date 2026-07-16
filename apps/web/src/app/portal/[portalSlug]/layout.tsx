import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getClientPortalOverview } from "@/server/client-portal";
import { signOut } from "@/auth";

/**
 * Client-facing shell: deliberately simpler than the internal console.
 * Everything rendered under /portal comes from published snapshots.
 */
export default async function ClientPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ portalSlug: string }>;
}) {
  const { portalSlug } = await params;
  const user = await requireUser();
  const overview = await getClientPortalOverview(user, portalSlug);
  if (!overview) notFound();

  return (
    <>
      <header className="topbar">
        <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link href={`/portal/${portalSlug}`} className="brand">
            Frontstage
          </Link>
          <span className="context-chip" title="Client portal">
            {overview.portalName}
          </span>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            {overview.clientOrganizationName} · delivered by {overview.hostOrganizationName}
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <nav style={{ display: "flex", gap: "1rem" }}>
            <Link href={`/portal/${portalSlug}`}>Overview</Link>
            <Link href={`/portal/${portalSlug}/requests`}>Requests</Link>
          </nav>
          <span className="muted">
          {user.name ?? user.email}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
            style={{ display: "inline" }}
          >
            <button type="submit" className="secondary" style={{ marginLeft: "0.75rem" }}>
              Sign out
            </button>
          </form>
          </span>
        </span>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
