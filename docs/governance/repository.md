# Repository governance

Status checked: 2026-08-28. Repository: private, personal-account-owned `udaySuryaP/memoid`.

Stage state: Stage 8B **COMPLETE — HQ RECONCILED AFTER CORRECTION**; Stage 8C **COMPLETE — HQ RECONCILED**; Stage 9 **COMPLETE — PASS AFTER STAGE 9A CORRECTIONS**; Stage 9A **COMPLETE — HQ RECONCILED**; Stage 9B **COMPLETE — HQ RECONCILED**; Stage 9C **COMPLETE — HQ RECONCILED WITH CLARIFICATIONS**; Stage 9D **ACTIVE — REPOSITORY IMPLEMENTATION-CONTRACT SYNCHRONIZATION**; Stage 10/10A **BLOCKED UNTIL STAGE 9D HQ RECONCILIATION AND EXPLICIT HQ RE-AUTHORIZATION**.

## Current limitation

The live GitHub repository rulesets API returned HTTP 403 with: `Upgrade to GitHub Pro or make this repository public to enable this feature.` The repository remains private, and Stage 9A does not change its owner or plan.

GitHub's current availability rules create three distinct boundaries:

- GitHub Pro would make branch protection, repository rulesets, and private-repository CODEOWNERS behavior available for this personal repository.
- CodeQL/code scanning for a private repository requires an organization on GitHub Team or GitHub Enterprise with GitHub Code Security enabled. GitHub Free or Pro for a personal private repository is not sufficient.
- Dependency review for a private repository likewise requires an eligible organization-owned repository with GitHub Code Security (or the legacy GitHub Advanced Security entitlement). The workflow remains gated by `ENABLE_DEPENDENCY_REVIEW` so an unavailable API cannot make every PR fail.

References:

- [GitHub branch protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
- [GitHub ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [GitHub private-repository CodeQL limitation](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/private-repository-enablement)
- [GitHub dependency-review availability](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [GitHub CODEOWNERS behavior](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

## Practical enforcement

`.github/CODEOWNERS` documents ownership, but the current plan cannot enforce code-owner approval or required reviews on this private repository. The sole PR author also cannot approve their own PR, so CODEOWNERS cannot provide independent founder-only approval by itself.

Until repository-native enforcement is available, the mandatory founder-only control is:

**feature branch → CI/security → pull request → HQ review → merge**

The PR must remain unmerged until CI and Security are green and HQ explicitly authorizes merge. Direct work on `main` is prohibited by governance even where GitHub cannot enforce it. Stage 9D uses exactly one bounded branch and one pull request to `main`; no Stage 10/10A branch may begin from its unmerged head.

For Stage 9D the only authorized mutations are repository documentation, ADRs, governance/design/testing guidance, machine-readable implementation-contract fixtures, and tests whose sole purpose is preventing contract drift. Product schema, migrations, authentication, GitHub ingestion, Candidate Submission or Working Context runtime behavior, reconciliation, model adapters, MCP product tools, Manual/Automatic runtime behavior, and new UI screens are forbidden.

Before broader collaboration or public-production operations, enable enforceable branch protection/rulesets with required CI/security checks and an independent review model. Re-evaluate CodeQL and dependency review if repository ownership or licensed capabilities change. Do not weaken the repository-compatible SAST fallback while CodeQL is unavailable.

## Security-analysis rule

**SAST REQUIRED. CodeQL preferred where repository/plan supports it.**

The current compatible layer is the pinned `eslint-plugin-security` scanner exposed through `pnpm sast`. It runs a curated error-level JavaScript/TypeScript ruleset separately from ordinary lint, avoids high-noise generic object-injection and dynamic-filename hotspot rules, and fails the Security workflow on findings or scanner errors. CodeQL should replace or complement this fallback when private-repository code scanning becomes available.
