# Stage 8A token normalization

The checked-in JSON is the normalized source of truth: primitive values feed semantic aliases, which feed component variables. Components consume semantic tokens only.

The required named subtle text token is `semantic.text.subtle = #6B7280`. Status tokens keep freshness, conflict, uncertainty, and operation state independent; color is never the only signal. Geist Sans and Geist Mono load through the Next.js font pipeline. Motion respects `prefers-reduced-motion`.
