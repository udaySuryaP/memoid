import type { ProjectId, WorkspaceId } from "@memoid/domain/identifiers";
import type { ReviewPolicy } from "@memoid/domain/values";

export const PROJECT_LIFECYCLE_STATES = ["ACTIVE", "ARCHIVED"] as const;
export type ProjectLifecycleState = (typeof PROJECT_LIFECYCLE_STATES)[number];

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function parseProjectLifecycleState(value: string): ProjectLifecycleState {
  if (!(PROJECT_LIFECYCLE_STATES as readonly string[]).includes(value))
    throw new Error(`Unsupported Project lifecycle state: ${value}`);
  return value as ProjectLifecycleState;
}

export function projectDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 120 || containsControlCharacter(normalized))
    throw new Error("Project name must contain 1 to 120 visible characters");
  return normalized;
}

export function projectDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim().length === 0) return null;
  const normalized = value.trim();
  if (normalized.length > 2_000 || containsControlCharacter(normalized))
    throw new Error("Project description must contain at most 2000 visible characters");
  return normalized;
}

export interface PersonalWorkspace {
  readonly id: WorkspaceId;
  readonly createdAt: string;
}

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly workspaceId: WorkspaceId;
  readonly displayName: string;
  readonly description: string | null;
  readonly lifecycleState: ProjectLifecycleState;
  readonly reviewPolicy: ReviewPolicy;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
