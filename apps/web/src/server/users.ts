import type { AuthProvider, PrismaClient } from "@frontstage/database";

interface SignInInput {
  email: string;
  name: string | null;
  provider: AuthProvider | null;
  providerAccountId: string | null;
}

/**
 * Create or update the user row at sign-in time and link the OAuth account.
 * users/auth_accounts are identity-level tables (not org-RLS'd), so this runs
 * without tenant context.
 */
export async function upsertUserFromSignIn(prisma: PrismaClient, input: SignInInput) {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: { email: input.email, name: input.name },
    update: input.name ? { name: input.name } : {},
  });

  if (input.provider && input.providerAccountId) {
    await prisma.authAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
      create: {
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
      update: {},
    });
  }

  return user;
}
