import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: [
    "@memoid/adapters",
    "@memoid/application",
    "@memoid/auth",
    "@memoid/db",
    "@memoid/domain",
    "@memoid/security",
    "@memoid/ui",
  ],
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
};
export default config;
