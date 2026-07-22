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
      // Attachment uploads (§33): 10 MB file limit + form overhead.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
