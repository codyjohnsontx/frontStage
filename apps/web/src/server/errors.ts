import { createLogger } from "@frontstage/observability";
import { PermissionDeniedError } from "@/server/authz";

const log = createLogger({ component: "web.actions" });

/** A deliberate, user-facing message (validation / state conflicts). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Next.js control-flow "errors" (redirect/notFound) must never be handled. */
function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/**
 * Map a caught exception to a message safe to show in a redirect. Only
 * intentional error types pass through; anything unexpected is logged
 * server-side and replaced with the generic fallback so internal details
 * (Prisma errors, stack fragments) never reach the URL bar.
 */
export function actionErrorMessage(err: unknown, fallback: string, permissionMessage: string): string {
  if (isNextControlFlow(err)) throw err;
  if (err instanceof PermissionDeniedError) return permissionMessage;
  if (err instanceof ValidationError) return err.message;
  log.error("unexpected_action_error", {
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  });
  return fallback;
}
