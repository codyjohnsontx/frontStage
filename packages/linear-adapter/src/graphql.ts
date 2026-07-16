import { z } from "zod";
import type {
  CanonicalProject,
  CanonicalStateType,
  CanonicalWorkItem,
} from "@frontstage/integration-core";

const GRAPHQL_URL = "https://api.linear.app/graphql";

/** Hung provider requests abort instead of blocking a worker slot forever. */
export const LINEAR_REQUEST_TIMEOUT_MS = 15_000;

export function linearRequestSignal(): AbortSignal {
  return AbortSignal.timeout(LINEAR_REQUEST_TIMEOUT_MS);
}

async function gql<T>(accessToken: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: linearRequestSignal(),
  });
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    throw new Error(
      `Linear rate limit hit (429${retryAfter ? `, retry-after: ${retryAfter}s` : ""}); job retry/backoff will reschedule`,
    );
  }
  if (!res.ok) {
    throw new Error(`Linear GraphQL error: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new Error(`Linear GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Linear GraphQL returned no data");
  return body.data;
}

const projectNode = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  state: z.string().optional(),
  targetDate: z.string().nullable().optional(),
  url: z.string().optional(),
  updatedAt: z.string(),
});

const issueNode = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  priority: z.number().optional(),
  estimate: z.number().nullable().optional(),
  url: z.string().optional(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable().optional(),
  project: z.object({ id: z.string() }).nullable().optional(),
  assignee: z.object({ name: z.string() }).nullable().optional(),
  state: z.object({ name: z.string(), type: z.string() }),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }).optional(),
});

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });

function toCanonicalProject(node: z.infer<typeof projectNode>): CanonicalProject {
  const project: CanonicalProject = {
    id: node.id,
    name: node.name,
    description: node.description,
    updatedAt: node.updatedAt,
  };
  if (node.state !== undefined) project.state = node.state;
  if (node.targetDate) project.targetDate = node.targetDate;
  if (node.url !== undefined) project.url = node.url;
  return project;
}

const STATE_TYPES: readonly CanonicalStateType[] = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

function toCanonicalWorkItem(node: z.infer<typeof issueNode>): CanonicalWorkItem {
  const stateType = (STATE_TYPES as readonly string[]).includes(node.state.type)
    ? (node.state.type as CanonicalStateType)
    : "backlog";
  const item: CanonicalWorkItem = {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    stateType,
    stateName: node.state.name,
    labels: node.labels?.nodes.map((l) => l.name) ?? [],
    updatedAt: node.updatedAt,
  };
  if (node.project?.id) item.projectId = node.project.id;
  if (node.description) item.description = node.description;
  if (node.priority !== undefined) item.priority = node.priority;
  if (node.assignee?.name) item.assigneeName = node.assignee.name;
  if (node.estimate != null) item.estimate = node.estimate;
  if (node.url !== undefined) item.url = node.url;
  if (node.archivedAt) item.archived = true;
  return item;
}

export async function fetchAllProjects(accessToken: string): Promise<CanonicalProject[]> {
  const projects: CanonicalProject[] = [];
  let cursor: string | null = null;
  do {
    const data = await gql<{ projects: { nodes: unknown[]; pageInfo: unknown } }>(
      accessToken,
      `query Projects($after: String) {
        projects(first: 50, after: $after) {
          nodes { id name description state targetDate url updatedAt }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after: cursor },
    );
    projects.push(...data.projects.nodes.map((n) => toCanonicalProject(projectNode.parse(n))));
    const page = pageInfo.parse(data.projects.pageInfo);
    cursor = page.hasNextPage ? page.endCursor : null;
  } while (cursor);
  return projects;
}

const ISSUE_FIELDS = `
  id identifier title description priority estimate url updatedAt archivedAt
  project { id }
  assignee { name }
  state { name type }
  labels { nodes { name } }
`;

export async function fetchAllIssues(
  accessToken: string,
  projectId?: string,
): Promise<CanonicalWorkItem[]> {
  const issues: CanonicalWorkItem[] = [];
  let cursor: string | null = null;
  do {
    const data = await gql<{ issues: { nodes: unknown[]; pageInfo: unknown } }>(
      accessToken,
      `query Issues($after: String, $filter: IssueFilter) {
        issues(first: 50, after: $after, filter: $filter, includeArchived: true) {
          nodes { ${ISSUE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      {
        after: cursor,
        filter: projectId ? { project: { id: { eq: projectId } } } : null,
      },
    );
    issues.push(...data.issues.nodes.map((n) => toCanonicalWorkItem(issueNode.parse(n))));
    const page = pageInfo.parse(data.issues.pageInfo);
    cursor = page.hasNextPage ? page.endCursor : null;
  } while (cursor);
  return issues;
}

/** Single-entity fetches for webhook processing — no full-collection scans. */
export async function fetchProjectById(
  accessToken: string,
  id: string,
): Promise<CanonicalProject | null> {
  const data = await gql<{ project: unknown | null }>(
    accessToken,
    `query Project($id: String!) {
      project(id: $id) { id name description state targetDate url updatedAt }
    }`,
    { id },
  );
  return data.project ? toCanonicalProject(projectNode.parse(data.project)) : null;
}

export async function fetchIssueById(
  accessToken: string,
  id: string,
): Promise<CanonicalWorkItem | null> {
  const data = await gql<{ issue: unknown | null }>(
    accessToken,
    `query Issue($id: String!) {
      issue(id: $id) { ${ISSUE_FIELDS} }
    }`,
    { id },
  );
  return data.issue ? toCanonicalWorkItem(issueNode.parse(data.issue)) : null;
}

/**
 * Create an issue (client-request intake -> Triage). Linear routes new
 * issues to the team's triage/default intake state when none is specified.
 */
export async function createIssue(
  accessToken: string,
  input: { teamId: string; title: string; description?: string },
): Promise<{ id: string; identifier?: string; url?: string }> {
  const data = await gql<{
    issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } | null };
  }>(
    accessToken,
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    {
      input: {
        teamId: input.teamId,
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
      },
    },
  );
  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error("Linear issueCreate did not succeed");
  }
  return data.issueCreate.issue;
}

export async function fetchViewerWorkspace(
  accessToken: string,
): Promise<{ id: string; name: string }> {
  const data = await gql<{ organization: { id: string; name: string } }>(
    accessToken,
    `query { organization { id name } }`,
    {},
  );
  return data.organization;
}
