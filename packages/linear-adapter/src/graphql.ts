import { z } from "zod";
import type {
  CanonicalProject,
  CanonicalStateType,
  CanonicalWorkItem,
} from "@frontstage/integration-core";

const GRAPHQL_URL = "https://api.linear.app/graphql";

async function gql<T>(accessToken: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) {
    throw new Error("Linear rate limit hit (429); job retry/backoff will reschedule");
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
          nodes {
            id identifier title description priority estimate url updatedAt archivedAt
            project { id }
            assignee { name }
            state { name type }
            labels { nodes { name } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      {
        after: cursor,
        filter: projectId ? { project: { id: { eq: projectId } } } : undefined,
      },
    );
    issues.push(...data.issues.nodes.map((n) => toCanonicalWorkItem(issueNode.parse(n))));
    const page = pageInfo.parse(data.issues.pageInfo);
    cursor = page.hasNextPage ? page.endCursor : null;
  } while (cursor);
  return issues;
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
