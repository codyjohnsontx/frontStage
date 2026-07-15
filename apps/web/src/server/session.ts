import { redirect } from "next/navigation";
import { auth } from "@/auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/** Resolve the authenticated user or redirect to login. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) {
    redirect("/login");
  }
  return { id: user.id, email: user.email.toLowerCase(), name: user.name ?? null };
}
