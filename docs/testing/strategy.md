# Test strategy

Unit and contract tests cover typed configuration, redirect safety, log redaction, package boundaries, MCP v2 compatibility, and the exact screen manifest. PostgreSQL integration tests prove migration behavior, transaction-local RLS isolation under pool reuse, and one synthetic pg-boss job. Playwright covers Chromium desktop/mobile, keyboard behavior, axe checks, and committed screenshot baselines.

Windows and Linux keep explicit platform-specific golden images so operating-system font rasterization cannot mask product regressions. New platforms establish baselines intentionally; later changes fail at a strict 1% pixel-difference threshold. CI artifacts retain reports and diffs.
