import type {
  RoleImpactSyncV1,
  RoleNarrativeInputV1,
  RoleNarrativeOutputV1,
  RoleRuntimeStatusV1
} from "@ai-story/shared";

export type EnsureRoleWorkspaceInputV1 = {
  roomId: string;
  roleId: string;
  worldId: string;
  storyPackageVersion: string;
};

/**
 * Role-scoped prose runtime. Implementations may maintain POV canon, memory,
 * foreground and options, but are never allowed to return or mutate shared
 * world state.
 */
export interface RoleNarrativeRuntime {
  ensureRoleWorkspace(input: EnsureRoleWorkspaceInputV1): Promise<RoleRuntimeStatusV1>;
  generateOpening(input: RoleNarrativeInputV1): Promise<RoleNarrativeOutputV1>;
  generateResult(input: RoleNarrativeInputV1): Promise<RoleNarrativeOutputV1>;
  syncImpacts(input: RoleImpactSyncV1): Promise<RoleRuntimeStatusV1>;
  getRoleRun(roomId: string, roleId: string): Promise<RoleRuntimeStatusV1>;
}
