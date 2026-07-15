import { createHash } from "node:crypto";

/**
 * Stable content hash for divergence detection. Only fields that matter to
 * client-facing curation participate — noisy fields (updatedAt, ordering)
 * are excluded so routine churn does not flag every projection.
 */
export function contentHashForWorkItem(item: {
  title: string;
  description?: string | undefined;
  stateType: string;
  stateName: string;
  archived?: boolean | undefined;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: item.title,
        description: item.description ?? "",
        stateType: item.stateType,
        stateName: item.stateName,
        archived: item.archived ?? false,
      }),
    )
    .digest("hex");
}

export function contentHashForProject(project: {
  name: string;
  description: string;
  state?: string | undefined;
  targetDate?: string | undefined;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: project.name,
        description: project.description,
        state: project.state ?? "",
        targetDate: project.targetDate ?? "",
      }),
    )
    .digest("hex");
}
