/** Framework- and provider-free identity primitives for future domain work. */
export type OpaqueId<Kind extends string> = string & { readonly __kind: Kind };
export type AccountId = OpaqueId<"AccountId">;
export type WorkspaceId = OpaqueId<"WorkspaceId">;
export type ProjectId = OpaqueId<"ProjectId">;

export interface RequestActor {
  readonly accountId: AccountId;
  readonly workspaceId: WorkspaceId;
  readonly projectId?: ProjectId;
}
