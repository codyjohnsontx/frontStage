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

export type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface RlsContext {
  /** Verified authenticated user id (sets app.current_user_id). */
  userId?: string;
  /** Verified authenticated user email (sets app.current_user_email). */
  userEmail?: string;
  /** Active organization (sets app.current_organization_id). */
  organizationId?: string;
}

/**
 * Apply RLS context GUCs on an open transaction. Values must come from the
 * verified session / trusted resolution — never from client-supplied input.
 * set_config(..., true) scopes each setting to the transaction.
 */
export async function setRlsContext(tx: TransactionClient, ctx: RlsContext): Promise<void> {
  if (ctx.userId !== undefined) {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`;
  }
  if (ctx.userEmail !== undefined) {
    await tx.$executeRaw`SELECT set_config('app.current_user_email', ${ctx.userEmail}, true)`;
  }
  if (ctx.organizationId !== undefined) {
    await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${ctx.organizationId}, true)`;
  }
}

/**
 * Run `fn` in a transaction with the given RLS context. All tenant- or
 * identity-scoped queries in the app go through this helper.
 */
export async function withRlsContext<T>(
  prisma: PrismaClient,
  ctx: RlsContext,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, ctx);
    return fn(tx);
  });
}

/** Back-compat convenience: organization-only context. */
export async function withOrganizationContext<T>(
  prisma: PrismaClient,
  organizationId: string,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return withRlsContext(prisma, { organizationId }, fn);
}
