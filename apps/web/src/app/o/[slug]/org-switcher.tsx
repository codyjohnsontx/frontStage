"use client";

import { useRouter } from "next/navigation";

export function OrgSwitcher({
  current,
  orgs,
}: {
  current: string;
  orgs: { id: string; name: string; slug: string }[];
}) {
  const router = useRouter();
  if (orgs.length < 2) return null;
  return (
    <select
      aria-label="Switch organization"
      value={current}
      onChange={(e) => router.push(`/o/${e.target.value}`)}
      style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem" }}
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.slug}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
