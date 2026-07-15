import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getMyOrganizationBySlug } from "@/server/organizations";

export default async function OrgHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const org = await getMyOrganizationBySlug(user, slug);
  if (!org) notFound();

  return (
    <>
      <h1>{org.name}</h1>
      <div className="card">
        <h2>Getting started</h2>
        <p className="muted">
          Phase 0 foundation. Next up: connect a Linear workspace, create a
          client organization, and set up a portal (Phase 1).
        </p>
        <ul className="muted">
          <li>Invite teammates from the Members page.</li>
          <li>Integrations, clients, and portals arrive with the next phases.</li>
        </ul>
      </div>
    </>
  );
}
