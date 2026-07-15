import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug, listMyOrganizations } from "@/server/organizations";
import { OrgSwitcher } from "./org-switcher";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();
  const allOrgs = await listMyOrganizations(user);

  return (
    <>
      <header className="topbar">
        <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link href="/orgs" className="brand">
            Frontstage
          </Link>
          <span className="context-chip" title="Active organization">
            {org.name}
          </span>
          <OrgSwitcher current={org.slug} orgs={allOrgs} />
        </span>
        <nav style={{ display: "flex", gap: "1rem" }}>
          <Link href={`/o/${org.slug}`}>Home</Link>
          <Link href={`/o/${org.slug}/clients`}>Clients</Link>
          <Link href={`/o/${org.slug}/integrations`}>Integrations</Link>
          <Link href={`/o/${org.slug}/members`}>Members</Link>
        </nav>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
