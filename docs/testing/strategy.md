# Test strategy

Unit and contract tests cover typed configuration, redirect safety, log redaction, package boundaries, MCP v2 compatibility, and the exact screen manifest. PostgreSQL integration tests prove migration behavior, transaction-local RLS isolation under pool reuse, and one synthetic pg-boss job. Playwright covers Chromium desktop/mobile, keyboard behavior, axe checks, and committed screenshot baselines.

The first successful visual run establishes baselines intentionally; later changes fail on diffs. CI artifacts retain reports and diffs.
