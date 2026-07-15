import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

let client: PrismaClient | undefined;

/**
 * Singleton Prisma client for the application.
 *
 * Tenant scoping strategy (see docs/adr/0002): every query against
 * tenant-owned tables must run inside `withOrganizationContext`, which sets
 * the `app.current_organization_id` GUC that row-level-security policies
 * check. Application code additionally filters by organizationId — RLS is
 * the backstop, not the only line of defense.
 */
export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

/**
 * Run `fn` in a transaction with the RLS organization context set.
 * All tenant-scoped queries in the app go through this helper.
 */
export async function withOrganizationContext<T>(
  prisma: PrismaClient,
  organizationId: string,
  fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // set_config with is_local=true scopes the setting to this transaction.
    await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
    return fn(tx);
  });
}
