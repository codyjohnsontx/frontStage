import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma client must stay external to the server bundle.
  serverExternalPackages: ["@prisma/client"],
  transpilePackages: [
    "@frontstage/authorization",
    "@frontstage/database",
    "@frontstage/integration-core",
    "@frontstage/linear-adapter",
    "@frontstage/observability",
    "@frontstage/storage",
  ],
  experimental: {
    serverActions: {
      // GLOBAL limit for every Server Action, not just uploads: raised to
      // accommodate the 10 MB attachment cap (§33) plus form overhead.
      // Any action can therefore receive payloads up to this size — size
      // limits that matter to a specific action must be enforced in that
      // action's own validation (see uploadDeliverableAttachment).
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
