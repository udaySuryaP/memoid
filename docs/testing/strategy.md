# Test strategy

Unit and contract tests cover typed configuration, redirect safety, log redaction, package boundaries, MCP v2 compatibility, and the exact screen manifest. PostgreSQL integration tests prove migration behavior, transaction-local RLS isolation under pool reuse, and one synthetic pg-boss job. Playwright covers Chromium desktop/mobile, keyboard behavior, axe checks, and committed screenshot baselines.

`pnpm test:security` isolates the existing redirect/return-intent and log-redaction foundation security tests. `pnpm sast` is a separate, fail-closed JavaScript/TypeScript static-security pass. The Security workflow also runs Secretlint, dependency audit, and gitleaks; dependency review remains capability-gated as documented in `docs/governance/repository.md`.

Windows and Linux keep explicit platform-specific golden images so operating-system font rasterization cannot mask product regressions. New platforms establish baselines intentionally; later changes fail at a strict 1% pixel-difference threshold. CI artifacts retain reports and diffs.
