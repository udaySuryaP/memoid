import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@memoid/ui"],
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
};
export default config;
