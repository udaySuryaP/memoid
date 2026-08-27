/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "domain-is-pure",
      severity: "error",
      from: { path: "^packages/domain" },
      to: { pathNot: "^packages/domain", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "application-does-not-depend-on-infrastructure",
      severity: "error",
      from: { path: "^packages/application" },
      to: { path: "^(packages/(adapters|auth|db|jobs|observability|ui)|apps/)" },
    },
    {
      name: "web-does-not-import-database-or-jobs",
      severity: "error",
      from: { path: "^apps/web" },
      to: { path: "^packages/(db|jobs)" },
    },
    {
      name: "no-app-cross-imports",
      severity: "error",
      from: { path: "^apps/([^/]+)" },
      to: { path: "^apps/([^/]+)", pathNot: "$1" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
  },
};
