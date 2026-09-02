import { parseUuidV7, type CausationId, type CorrelationId } from "./identifiers.js";

export interface TraceContext {
  readonly correlationId: CorrelationId;
  readonly causationId: CausationId | null;
}

export function traceContext(
  correlationId: string,
  causationId?: string | null,
): Readonly<TraceContext> {
  return Object.freeze({
    correlationId: parseUuidV7(correlationId, "CorrelationId"),
    causationId: causationId ? parseUuidV7(causationId, "CausationId") : null,
  });
}
