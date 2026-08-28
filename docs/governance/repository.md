# Repository governance

Repository: private, personal-account-owned `udaySuryaP/memoid`.

## Durable contract versus execution authorization

This repository's implementation contract is synchronized through the **HQ-reconciled Stage 9C** baseline. The repository owns durable engineering boundaries, branch/PR controls, implementation ordering, proof gates, and contract tests. It does **not independently authorize a current workstream**.

Current execution authorization is owned by `00 - MEMOID HQ` / canonical project state. Before starting or merging any vertical, verify explicit current HQ authorization. A later HQ transition from 10A to 10B or any other workstream must not require a repository status-only patch merely to keep this governance document true.

## Current limitation

The live GitHub repository rulesets API previously returned HTTP 403 with: `Upgrade to GitHub Pro or make this repository public to enable this feature.` The repository remains private and personal-account-owned unless current HQ/project state records a later change.

GitHub availability creates three distinct boundaries that must be freshly reverified if plan/ownership changes:

- GitHub Pro can make branch protection, repository rulesets, and private-repository CODEOWNERS behavior available for a personal repository.
- CodeQL/code scanning for a private repository requires an eligible organization/licensing configuration; the repository retains a compatible SAST fallback while unavailable.
- Dependency review for a private repository likewise depends on eligible GitHub security capability. The workflow remains capability-gated so an unavailable API cannot make every PR fail.

References:

- [GitHub branch protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
- [GitHub ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [GitHub private-repository CodeQL limitation](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/private-repository-enablement)
- [GitHub dependency-review availability](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [GitHub CODEOWNERS behavior](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

## Practical enforcement

`.github/CODEOWNERS` documents ownership, but repository-native approval/protection may not be enforceable on the current plan. Until enforceable controls are available, the mandatory founder-only control is:

**feature branch → CI/security → pull request → HQ review → merge**

The PR must remain unmerged until required CI/security checks are green and HQ explicitly authorizes merge. Direct pushes to `main` are prohibited by governance even where GitHub cannot technically enforce that rule. A dependent workstream must not start from an unmerged predecessor head unless HQ explicitly defines a different bounded recovery procedure.

Repository contract synchronization stages may modify only the scope their workstream authorizes. Product schema, migrations, authentication, GitHub ingestion runtime, Candidate Submission or Working Context runtime behavior, reconciliation, model adapters, MCP product tools, Manual/Automatic runtime behavior, and product UI require their owning implementation vertical plus explicit current HQ authorization.

Before broader collaboration or public-production operations, enable enforceable branch protection/rulesets with required CI/security checks and an independent review model. Re-evaluate CodeQL and dependency review if repository ownership or licensed capabilities change. Do not weaken the repository-compatible SAST fallback while CodeQL is unavailable.

## Security-analysis rule

**SAST REQUIRED. CodeQL preferred where repository/plan supports it.**

The current compatible layer is the pinned `eslint-plugin-security` scanner exposed through `pnpm sast`. It runs a curated error-level JavaScript/TypeScript ruleset separately from ordinary lint, avoids high-noise generic object-injection and dynamic-filename hotspot rules, and fails the Security workflow on findings or scanner errors. CodeQL should replace or complement this fallback when private-repository code scanning becomes available.
