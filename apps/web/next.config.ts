import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma client must stay external to the server bundle.
  serverExternalPackages: ["@prisma/client"],
  transpilePackages: ["@frontstage/authorization", "@frontstage/database"],
};

export default nextConfig;
