# ADR 0003: Stage 8A design-token and UI-system foundation

Status: Accepted from Stage 8A; foundation executed in Stage 8B; repository record aligned in Stage 8C.

## Decision status

- **LOCKED:** Quiet Technical Workbench direction, Geist Sans/Mono, light-first neutral/cobalt system, and primitive → semantic → component token architecture.
- **LOCKED:** integrity dimensions remain visually independent; `CURRENT` is not `FRESH`, and Conflict is not Uncertainty.
- **LOCKED:** accessible, responsive, server-confirmed high-integrity patterns and the exact 59-screen traceability contract.
- **LOCKED:** use a deterministic repository-native Next.js `/foundation` workbench with axe and Playwright visual baselines for the current foundation.
- **PROVISIONAL:** exact breakpoints, icon library, optional dark theme, density controls, and later need for Storybook or another catalog.
- **Proof-gated:** production components must pass real-browser keyboard, accessibility, reflow, and visual regression checks; prototype mechanics are not production proof.
- **Implementation deferred:** the 59 Stage 7 screens are mapped but no product screens or flows are implemented here.

## Decision

Normalize the Stage 8A tokens into machine-readable JSON and CSS, preserve shared-pattern traceability, and test the foundation with Radix primitives, axe, and Playwright. Reconsider the workbench only if later component-state breadth materially exceeds it; changing the harness must not change the accepted visual or integrity semantics.
