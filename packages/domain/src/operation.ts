import { controlledKey } from "./audit.js";

export const OPERATION_STATES = [
  "PENDING",
  "RUNNING",
  "RETRY_WAIT",
  "CANCELLATION_REQUESTED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export type OperationState = (typeof OPERATION_STATES)[number];

export const TERMINAL_OPERATION_STATES = ["SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type TerminalOperationState = (typeof TERMINAL_OPERATION_STATES)[number];

const legalTransitions: Readonly<Record<OperationState, readonly OperationState[]>> = {
  PENDING: ["RUNNING", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "RETRY_WAIT", "FAILED", "CANCELLATION_REQUESTED"],
  RETRY_WAIT: ["RUNNING", "CANCELLED"],
  CANCELLATION_REQUESTED: ["CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTerminalOperationState(state: OperationState): state is TerminalOperationState {
  return (TERMINAL_OPERATION_STATES as readonly string[]).includes(state);
}

export function assertOperationTransition(from: OperationState, to: OperationState): void {
  if (!legalTransitions[from].includes(to))
    throw new Error(`Illegal Operation transition: ${from} -> ${to}`);
}

export const operationKind = (value: string): string => controlledKey(value, "Operation kind");
export const operationStage = (value: string): string => controlledKey(value, "Operation stage");
