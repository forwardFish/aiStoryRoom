import type { GameProjectionV1, RoleControlProjectionV1 } from "./projection.schemas";

export type SlotCommandV1 = {
  idempotencyKey: string;
  windowId: string;
  controlEpoch: number;
  actionKey: string;
  targetRoleId?: string;
  leverageKey?: string;
};

export type LayoutCommandV1 = {
  idempotencyKey: string;
  windowId: string;
  controlEpoch: number;
};

export type HeartbeatCommandV1 = {
  sessionInstanceId: string;
  heartbeatSequence: number;
  lastAppliedDeliverySequence: number;
};

export type ControlCommandV1 = {
  idempotencyKey: string;
  expectedControlEpoch: number;
};

export type CommandResponseV1 = {
  accepted: boolean;
  guardDecision?: Record<string, unknown>;
  immediateFeedback?: Record<string, unknown>;
  gameProjection: GameProjectionV1;
};

export type HeartbeatResponseV1 = {
  accepted: boolean;
  serverNow: string;
  nextHeartbeatAt: string;
  rolePresence: RoleControlProjectionV1;
};

export type UnlockResponseV1 = {
  unlocked: boolean;
  alreadyUnlocked: boolean;
  creditsCharged: number;
  payerUserId: string | null;
  access: GameProjectionV1["access"];
  gameProjection: GameProjectionV1;
};

export const commandErrorCodes = [
  "ROLE_FORBIDDEN", "WINDOW_MOVED", "WINDOW_CLOSED", "SLOT_SEALED", "ROLE_CONTROL_CHANGED", "IDEMPOTENCY_KEY_REUSED", "REACTION_REQUIRED",
  "ACCESS_REQUIRES_UNLOCK", "INSUFFICIENT_CREDITS", "INVALID_COMMAND", "GUARD_REJECTED"
] as const;
export type CommandErrorCode = (typeof commandErrorCodes)[number];
