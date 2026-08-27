# Foundation compatibility matrix

| Boundary         | Locked line | Foundation pin            | Proof                          |
| ---------------- | ----------- | ------------------------- | ------------------------------ |
| Node.js          | 24 LTS      | 24.18.0                   | CI and runtime files           |
| pnpm             | 11          | 11.24.0                   | Corepack lock                  |
| TypeScript       | 6           | 6.0.3                     | strict typecheck               |
| Next.js / React  | 16 / 19     | 16.3.3 / 19.2.8           | build and browser test         |
| Fastify          | 5           | 5.12.1                    | API build                      |
| PostgreSQL       | 18          | 18.6-bookworm             | integration tests              |
| Kysely / pg-boss | 0.29 / 12   | 0.29.5 / 12.28.0          | synthetic DB/job proofs        |
| Zod              | 4           | 4.4.3                     | typed startup config           |
| MCP split SDK    | 2           | server/fastify 2.0.0      | protocol contract              |
| WorkOS / Octokit | 10 / 16+22  | 10.11.0 / 16.1.4+22.0.1   | adapter compile                |
| OTel / Pino      | 0.221 / 10  | 0.221.0 + 2.10.0 / 10.3.1 | compile, audit, redaction test |
| Playwright       | 1           | 1.62.1                    | visual and accessibility suite |

Pins were checked against official release, documentation, or registry sources on 2026-08-27. A major change requires an ADR and a new compatibility proof.
