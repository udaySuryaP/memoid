# ADR 0001: TypeScript modular monolith

Status: accepted for Stage 8B.

Use a pnpm/Turborepo TypeScript modular monolith with web, API, and worker deployables. Enforce direction through package exports, TypeScript, and dependency-cruiser. This keeps transactional and operational complexity low while preserving explicit seams for later extraction.
