# Test strategy

Unit and contract tests cover typed configuration, redirect safety, log redaction, package boundaries, MCP v2 compatibility, and the exact screen manifest. PostgreSQL integration tests prove migration behavior, transaction-local RLS isolation under pool reuse, and one synthetic pg-boss job. Playwright covers Chromium desktop/mobile, keyboard behavior, axe checks, and committed screenshot baselines.

API contract tests prove that `/health` remains liveness-only when PostgreSQL fails and that `/ready` returns sanitized ready/not-ready responses. Integration tests exercise the real bounded PostgreSQL `SELECT 1` probe against both available and unavailable endpoints. A repository contract assertion preserves the V1 prohibition on ordinary external MCP/API clients triggering Source refresh/synchronization.

Stage 9D adds a machine-readable implementation-contract fixture and drift tests. They preserve the four integrity planes, checkpoint-versus-confirmation boundary, Manual/Automatic review-policy rules and transitions, protected automatic-decision classes, Source-frontier distinctions, contiguous/gap-preserving Candidate Reconciled Frontier, desired/processed lost-wakeup behavior, GitHub signal/refetch/coalescing rules, provider-outage pending continuity, branch semantics, provider-neutral model boundary, separate reconciliation/Resume pipelines, large-repository filtering direction, and corrected pre-10A versus vertical-specific gate taxonomy.

These tests validate implementation semantics and ownership without choosing product tables, enum/type names, cursor representation, lease/lock primitives, MCP schemas, provider SDKs, or UI routes. Later vertical tests must turn the fixture scenarios into runtime proof at their named gates; editing prose alone must not weaken or bypass the machine-readable contract.

`pnpm test:security` isolates the existing redirect/return-intent and log-redaction foundation security tests. `pnpm sast` is a separate, fail-closed JavaScript/TypeScript static-security pass. The Security workflow also runs Secretlint, dependency audit, and gitleaks; dependency review remains capability-gated as documented in `docs/governance/repository.md`.

Windows and Linux keep explicit platform-specific golden images so operating-system font rasterization cannot mask product regressions. New platforms establish baselines intentionally; later changes fail at a strict 1% pixel-difference threshold. CI artifacts retain reports and diffs.
