# ADR 0001: TypeScript modular monolith and process model

Status: Accepted; repository record aligned in Stage 8C.

## Decision status

- **LOCKED:** one private pnpm/Turborepo TypeScript modular monolith with one Domain/Application Core.
- **LOCKED:** independently started web, external API/MCP, and background-worker process roles; these are not independent microservices.
- **PROVISIONAL:** exact deployment sizing and process counts.
- **Proof-gated:** any later service extraction requires measured isolation/scaling need, an ADR, and preservation of domain invariants.
- **Implementation deferred:** all product vertical behavior and product schema remain outside the repository foundation.

## Decision

Use `apps/web`, `apps/api`, and `apps/worker` around shared packages. Enforce dependency direction through package exports, TypeScript, and dependency-cruiser. `packages/domain` remains framework-free; `packages/application` depends only on domain and contracts; infrastructure stays behind adapters.

This keeps transactional and operational complexity low while preserving explicit seams for later extraction without creating premature distributed-system semantics.
