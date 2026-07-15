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

/**
 * Map a caught exception to a message safe to show in a redirect. Only
 * intentional error types pass through; anything unexpected is logged
 * server-side and replaced with the generic fallback so internal details
 * (Prisma errors, stack fragments) never reach the URL bar.
 */
export function actionErrorMessage(err: unknown, fallback: string, permissionMessage: string): string {
  if (err instanceof PermissionDeniedError) return permissionMessage;
  if (err instanceof ValidationError) return err.message;
  log.error("unexpected_action_error", {
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  });
  return fallback;
}
