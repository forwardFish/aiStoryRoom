import type { PressureProductionBridgeV1 } from "../production";

export interface PressureRoomsEntryStoryRunLikeV1 {
  id: string;
  title: string;
  templateId: string;
  templateKey: string;
  status: string;
  visibility: string;
  inviteCode: string | null;
  ownerUserId: string;
  engineVersion: string;
  strategyVersion: string;
  accessLevel?: string | null;
  freeDecisionsUsed?: number | null;
  updatedAt: Date;
  createdAt?: Date;
  players?: unknown[];
  roles?: unknown[];
}

export interface PressureRoomsEntryHttpDelegateV1 {
  game(
    user: { id: string },
    roomId: string,
    feedCursor?: string,
    feedLimit?: string | number,
  ): Promise<unknown> | unknown;
  narrativeUpdate(
    user: { id: string },
    roomId: string,
    chapterRuntimeId: string,
    updateKey?: string,
  ): Promise<unknown> | unknown;
  result(user: { id: string }, roomId: string): Promise<unknown> | unknown;
  action(user: { id: string }, roomId: string, body: unknown): Promise<unknown> | unknown;
  chat(user: { id: string }, roomId: string, body: unknown): Promise<unknown> | unknown;
  replay(user: { id: string }, roomId: string, body: unknown): Promise<unknown> | unknown;
  legacySlot(
    user: { id: string },
    roomId: string,
    endpoint: "MAIN" | "MANEUVER" | "REACTION",
  ): Promise<unknown> | unknown;
}

export interface PressureRoomsEntryProjectionDepsV1 {
  gateway: PressureProductionBridgeV1;
}
