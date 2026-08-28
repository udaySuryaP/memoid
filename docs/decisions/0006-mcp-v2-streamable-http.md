# ADR 0006: MCP v2 split SDK and Streamable HTTP adapter

Status: Accepted by Stages 5 and 8; repository record added in Stage 8C.

## Decision status

- **LOCKED:** MCP is a V1-required external AI-client adapter, not Memoid's domain model, authorization model, or differentiation.
- **LOCKED:** use the official stable v2 split packages, including `@modelcontextprotocol/server` and the Node/Fastify adapter; do not substitute the v1 monolithic package identity.
- **LOCKED:** hosted transport is remote Streamable HTTP with isolated request/connection server state and structured schemas.
- **LOCKED:** the adapter delegates to the same Application layer as first-party web/API and cannot expand caller capability.
- **PROVISIONAL:** exact tool/resource names, optional extension mappings, host setup, and secure compatible v2 patch.
- **Proof-gated:** transport lifecycle, OAuth discovery/issuer/audience/PKCE, Integration resolution, Project grants, idempotency, and multiple-host compatibility require contract/integration proof.
- **Proof-gated:** the application/gateway must reject Streamable HTTP requests that omit or provide an unsupported `MCP-Protocol-Version`. The pinned `@modelcontextprotocol/server@2.0.0` accepts a request without the required header, so package behavior cannot be treated as the enforcement boundary. Before the MCP/API vertical is complete, add an explicit validation layer and a conformance test, or verify that a secure compatible patch provides equivalent behavior.
- **Implementation deferred:** product MCP tools and real credential/grant flows are not implemented in the foundation.

## Decision

Keep a small MCP surface over a protocol-independent Application contract. Self-reported `clientInfo` is attribution metadata only. Ordinary external clients may read/search and submit candidate evidence or request reconciliation where authorized; they cannot trigger Source synchronization, approve Change Proposals, or perform first-party high-integrity actions.
