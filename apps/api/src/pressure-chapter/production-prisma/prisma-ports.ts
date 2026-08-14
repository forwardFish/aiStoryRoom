import type { ParticipantModeV1 } from "@ai-story/shared";
import type { PressureSerializableClient } from "../persistence/transaction";

export interface PressureProductionStoryRunRow {
  id: string;
  templateId: string;
  ownerUserId: string;
  title: string;
  mode: string;
  templateKey: string;
  status: string;
  totalDays: number;
  maxPlayers: number;
  activeHumanCount: number;
  aiPlayerCount: number;
  stateJson: unknown;
  visibility: string;
  inviteCode: string;
  engineVersion: string;
  strategyVersion: string;
  version: number;
}

export interface PressureProductionRoleRow {
  id: string;
  runId: string;
  roleKey: string;
  roleName: string;
  identity: string;
  publicInfo: string;
  hiddenSecret: string | null;
  personalGoal: string;
  currentState: string;
  abilityText: string | null;
  arcText: string | null;
  knownInfoJson: unknown;
  cannotDoJson: unknown;
  isAiControlled: boolean;
  status: string;
}

export interface PressureProductionPlayerRow {
  id: string;
  runId: string;
  userId: string | null;
  roleId: string | null;
  playerType: string;
  status: string;
}

export interface PressureRunLifecycleRow {
  runId: string;
  schemaVersion: string;
  participantMode: ParticipantModeV1;
  lifecycle: string;
  routeFreeze: string;
  requestFingerprint: string;
  idempotencyKey: string;
  shellHash: string;
  shellJson: unknown;
  lobbyJson: unknown;
  startJson: unknown;
  stateHash: string;
  startRequestFingerprint: string | null;
  startIdempotencyKey: string | null;
  startRunSeed: string | null;
  startMaterialHash: string | null;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PressureProductionTransaction {
  storyRun: {
    findUnique(input: Record<string, unknown>): Promise<PressureProductionStoryRunRow | null>;
    findFirst(input: Record<string, unknown>): Promise<PressureProductionStoryRunRow | null>;
    findMany(input: Record<string, unknown>): Promise<PressureProductionStoryRunRow[]>;
    create(input: { data: Record<string, unknown> }): Promise<PressureProductionStoryRunRow>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  storyRole: {
    findMany(input: Record<string, unknown>): Promise<PressureProductionRoleRow[]>;
    createMany(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  storyPlayer: {
    findMany(input: Record<string, unknown>): Promise<PressureProductionPlayerRow[]>;
    createMany(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  pressureRunLifecycle: {
    findUnique(input: Record<string, unknown>): Promise<PressureRunLifecycleRow | null>;
    findMany(input: Record<string, unknown>): Promise<PressureRunLifecycleRow[]>;
    create(input: { data: Record<string, unknown> }): Promise<PressureRunLifecycleRow>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type PressureProductionPrismaClient =
  PressureSerializableClient<PressureProductionTransaction>;

export interface GenesisOpenN1OutboxRow {
  id: string;
  runId: string;
  taskType: string;
  status: string;
  checkpoint: string;
  dedupeKey: string;
  sourceAuthority: string;
  sourceId: string;
  sourceCommitHash: string;
  payloadJson: unknown;
  payloadHash: string;
  attempt: number;
  maxAttempts: number;
  availableAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseVersion: number;
  lastError: string | null;
  completedAt: Date | null;
}

export interface GenesisOpenN1HandoffTransaction {
  pressureOutboxTask: {
    findUnique(input: Record<string, unknown>): Promise<GenesisOpenN1OutboxRow | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type GenesisOpenN1HandoffPrismaClient =
  PressureSerializableClient<GenesisOpenN1HandoffTransaction>;
