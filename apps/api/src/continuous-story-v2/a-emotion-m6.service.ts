import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  A_EMOTION_M6_BOUNDARY_SCHEMA_VERSION,
  A_EMOTION_M6_RECOVERY_RESULT_SCHEMA_VERSION,
  validateAEmotionM6BoundaryV1,
  validateAEmotionM6RecoveryResultV1,
  type AEmotionM6BoundaryV1,
  type AEmotionM6RecoveryPolicyV1,
  type AEmotionM6RecoveryResultV1
} from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import {
  isAEmotionM6EnabledForRun,
  readAEmotionM6Config
} from "../config/a-emotion-m6.config";
import {
  aEmotionViewerState,
  disabledAEmotionRoomPolicy,
  nextAEmotionPauseState,
  readAEmotionPauseState,
  readAEmotionRoomPolicy
} from "../config/a-emotion-room-flags";
import { PrismaService } from "../prisma.service";
import { A_EMOTION_M2_TASK_TYPE } from "./a-emotion-m2.service";
import { A_EMOTION_M3_TASK_TYPE } from "./a-emotion-m3.service";
import { A_EMOTION_M4_TASK_TYPE } from "./a-emotion-m4.service";
import { A_EMOTION_M5_TASK_TYPE } from "./a-emotion-m5.service";

export const A_EMOTION_M6_TASK_TYPES = [
  "INTERACTION_COMPILE_REQUESTED",
  A_EMOTION_M2_TASK_TYPE,
  A_EMOTION_M3_TASK_TYPE,
  A_EMOTION_M4_TASK_TYPE,
  A_EMOTION_M5_TASK_TYPE
] as const;

export const A_EMOTION_M6_PAUSED_CODE = "A_EMOTION_M6_ROOM_PAUSED" as const;

export const A_EMOTION_M6_SERIALIZABLE_MAX_ATTEMPTS = 4 as const;

export function isAEmotionM6RetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const directCode = typeof candidate.code === "string" ? candidate.code : "";
  const meta = candidate.meta && typeof candidate.meta === "object" ? candidate.meta as { code?: unknown; database_error?: unknown } : {};
  const cause = candidate.cause && typeof candidate.cause === "object" ? candidate.cause as { code?: unknown; message?: unknown } : {};
  const codes = [directCode, typeof meta.code === "string" ? meta.code : "", typeof cause.code === "string" ? cause.code : ""];
  if (codes.some((code) => ["P2034", "40001", "40P01"].includes(code))) return true;
  const message = [candidate.message, meta.database_error, cause.message].map((value) => String(value || "")).join(" ");
  return /(?:40P01|40001|deadlock detected|write conflict|serialization failure|could not serialize access)/iu.test(message);
}

export function aEmotionM6SerializableRetryDelayMs(attempt: number): number {
  return Math.min(1_000, 25 * 2 ** Math.max(0, Math.trunc(attempt)));
}

export async function withAEmotionM6SerializableRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { attempts?: number; sleep?: (milliseconds: number) => Promise<void> } = {}
): Promise<T> {
  const attempts = Math.max(1, Math.min(8, Math.trunc(options.attempts || A_EMOTION_M6_SERIALIZABLE_MAX_ATTEMPTS)));
  const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isAEmotionM6RetryableTransactionError(error) || attempt === attempts - 1) throw error;
      await sleep(aEmotionM6SerializableRetryDelayMs(attempt));
    }
  }
  throw new Error("unreachable A-Emotion M6 serializable retry state");
}

export type AEmotionM6RecoveryAction = "RECOVER" | "RECOVER_LEGACY" | "DEAD_LETTER" | "COMPLETED" | "IGNORE";

type RecoveryTaskLike = { status: string; attempt: number; maxAttempts: number; createdAt: Date; leaseExpiresAt: Date | null };

export function aEmotionM6RetryDelay(base: number, attempt: number) {
  return Math.min(60_000, Math.max(100, base) * 2 ** Math.min(6, Math.max(0, Math.trunc(attempt))));
}

export function evaluateAEmotionM6RecoveryAction(input: { task: RecoveryTaskLike; enabledForRun: boolean; now: Date; policy: AEmotionM6RecoveryPolicyV1 }): AEmotionM6RecoveryAction {
  const { task, now, policy } = input;
  if (["COMPLETED", "completed"].includes(task.status)) return "COMPLETED";
  if (task.status !== "RUNNING" || !task.leaseExpiresAt || task.leaseExpiresAt > now) return "IGNORE";
  if (!input.enabledForRun) return "RECOVER_LEGACY";
  const exceededAttempts = task.attempt >= Math.max(task.maxAttempts, policy.deadLetterAfterAttempts);
  const exceededDeadline = now.getTime() - task.createdAt.getTime() >= policy.deadlineMs;
  return exceededAttempts || exceededDeadline ? "DEAD_LETTER" : "RECOVER";
}

export function aEmotionM6Boundary(input: Omit<AEmotionM6BoundaryV1, "schemaVersion">): AEmotionM6BoundaryV1 {
  const value = { schemaVersion: A_EMOTION_M6_BOUNDARY_SCHEMA_VERSION, ...input };
  const validated = validateAEmotionM6BoundaryV1(value);
  if (!validated.ok) throw new Error(`A_EMOTION_M6_BOUNDARY_INVALID:${validated.errors.join("|")}`);
  return validated.value;
}

export function assertAEmotionM6Boundary(value: unknown, expected: Omit<AEmotionM6BoundaryV1, "schemaVersion">): AEmotionM6BoundaryV1 {
  const validated = validateAEmotionM6BoundaryV1(value);
  if (!validated.ok) throw new ConflictException({ code: "A_EMOTION_M6_BOUNDARY_MISMATCH", message: "Interaction boundary is stale or belongs to another viewer" });
  const target = aEmotionM6Boundary(expected);
  for (const key of ["roomId", "runId", "userId", "roleId", "runVersion", "projectionVersion", "stateVersion"] as const) {
    if (validated.value[key] !== target[key]) throw new ConflictException({ code: "A_EMOTION_M6_BOUNDARY_MISMATCH", message: "Interaction boundary is stale or belongs to another viewer" });
  }
  return validated.value;
}

type Tx = Prisma.TransactionClient;
type RunGate = {
  templateKey: string;
  mode: string;
  maxPlayers: number;
  engineVersion: string;
  stateJson: unknown;
};

@Injectable()
export class AEmotionM6Service {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Recover only A-Emotion tasks. Old/unfrozen rooms keep legacy lease requeue semantics. */
  async recoverStaleTasks(runId?: string, now = new Date()): Promise<AEmotionM6RecoveryResultV1> {
    const policy = readAEmotionM6Config().policy;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.storyTaskOutbox.findMany({
        where: { ...(runId ? { runId } : {}), taskType: { in: [...A_EMOTION_M6_TASK_TYPES] } },
        include: { run: { select: { templateKey: true, mode: true, maxPlayers: true, engineVersion: true, stateJson: true } } },
        orderBy: { createdAt: "asc" },
        take: 500
      });
      let recovered = 0;
      let legacy = 0;
      let dead = 0;
      let completed = 0;
      for (const task of rows) {
        const enabledForRun = isAEmotionM6EnabledForRun(task.run as RunGate);
        if (enabledForRun && readAEmotionPauseState(task.run.stateJson).paused) continue;
        const action = evaluateAEmotionM6RecoveryAction({ task, enabledForRun, now, policy });
        if (action === "COMPLETED") { completed += 1; continue; }
        if (action === "IGNORE") continue;
        if (action === "DEAD_LETTER") {
          const exceededDeadline = now.getTime() - task.createdAt.getTime() >= policy.deadlineMs;
          const changed = await tx.storyTaskOutbox.updateMany({
            where: { id: task.id, status: "RUNNING", leaseOwner: task.leaseOwner, leaseVersion: task.leaseVersion, leaseExpiresAt: { lte: now } },
            data: { status: "FAILED", outcome: "DEAD_LETTER", leaseOwner: null, leaseExpiresAt: null, completedAt: now, lastError: exceededDeadline ? "A_EMOTION_M6_TASK_DEADLINE_EXCEEDED" : "A_EMOTION_M6_TASK_RETRY_EXHAUSTED", leaseVersion: { increment: 1 } }
          });
          dead += changed.count;
          continue;
        }
        const legacyRecovery = action === "RECOVER_LEGACY";
        const changed = await tx.storyTaskOutbox.updateMany({
          where: { id: task.id, status: "RUNNING", leaseOwner: task.leaseOwner, leaseVersion: task.leaseVersion, leaseExpiresAt: { lte: now } },
          data: { status: "PENDING", leaseOwner: null, leaseExpiresAt: null, startedAt: null, nextRetryAt: legacyRecovery ? now : new Date(now.getTime() + aEmotionM6RetryDelay(policy.retryBaseMs, task.attempt)), leaseVersion: { increment: 1 }, lastError: legacyRecovery ? "A_EMOTION_M6_LEGACY_LEASE_RECOVERED" : "A_EMOTION_M6_EXPIRED_LEASE_RECOVERED" }
        });
        if (legacyRecovery) legacy += changed.count; else recovered += changed.count;
      }
      return recoveryResult(recovered, legacy, dead, completed, now);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async roomViewerState(user: AuthenticatedUser, roomId: string) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        mode: true,
        stateJson: true,
        players: { where: { userId: user.id, status: "active" }, select: { id: true, roleId: true } }
      }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (!run.players.some((player) => player.roleId)) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership required" });
    return aEmotionViewerState(run.stateJson);
  }

  async setRoomPaused(user: AuthenticatedUser, input: {
    roomId: string;
    expectedVersion: number;
    paused: boolean;
    reason: string;
  }) {
    if (!input.roomId || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("A_EMOTION_M6_PAUSE_INPUT_INVALID");
    }
    if (input.paused && !input.reason.trim()) throw new Error("A_EMOTION_M6_PAUSE_REASON_REQUIRED");
    return withAEmotionM6SerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const run = await tx.storyRun.findUnique({
        where: { id: input.roomId },
        select: {
          id: true,
          ownerUserId: true,
          templateKey: true,
          mode: true,
          maxPlayers: true,
          engineVersion: true,
          version: true,
          stateJson: true
        }
      });
      if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      if (run.ownerUserId !== user.id) throw new ForbiddenException({ code: "ROOM_OWNER_REQUIRED", message: "Only the room owner may pause A-Emotion processing" });
      if (!isAEmotionM6EnabledForRun(run)) throw new NotFoundException({ code: "A_EMOTION_M6_DISABLED", message: "A-Emotion recovery is not enabled for this room" });
      if (run.version !== input.expectedVersion) throw new ConflictException({ code: "A_EMOTION_M6_RUN_VERSION_MISMATCH", message: "Run version changed" });
      const root = record(run.stateJson);
      const nextPause = nextAEmotionPauseState({
        previous: readAEmotionPauseState(run.stateJson),
        paused: input.paused,
        reason: input.reason
      });
      const changed = await tx.storyRun.updateMany({
        where: { id: input.roomId, version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          stateJson: { ...root, aEmotionM6Recovery: nextPause } as Prisma.InputJsonValue
        }
      });
      if (changed.count !== 1) throw new ConflictException({ code: "A_EMOTION_M6_RUN_VERSION_MISMATCH", message: "Run version changed" });
      if (!input.paused) {
        await tx.storyTaskOutbox.updateMany({
          where: {
            runId: input.roomId,
            taskType: { in: [...A_EMOTION_M6_TASK_TYPES] },
            status: "PENDING"
          },
          data: { nextRetryAt: new Date() }
        });
      }
      return {
        roomId: input.roomId,
        paused: input.paused,
        pauseVersion: nextPause.version,
        runVersion: input.expectedVersion + 1
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000
    }));
  }

  async rollbackRoomFeatures(input: { roomId: string; expectedVersion: number; reason: string }) {
    if (!input.roomId || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || !input.reason.trim()) throw new Error("A_EMOTION_M6_ROLLBACK_INPUT_INVALID");
    return withAEmotionM6SerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const run = await tx.storyRun.findUnique({ where: { id: input.roomId }, select: { version: true, stateJson: true } });
      if (!run || run.version !== input.expectedVersion) throw new ConflictException({ code: "A_EMOTION_M6_RUN_VERSION_MISMATCH", message: "Run version changed" });
      const root = record(run.stateJson);
      const previousPolicy = readAEmotionRoomPolicy(run.stateJson);
      const flags = record(root.featureFlags);
      const changedAt = new Date().toISOString();
      const changed = await tx.storyRun.updateMany({
        where: { id: input.roomId, version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          stateJson: {
            ...root,
            aEmotionRuleset: disabledAEmotionRoomPolicy(previousPolicy),
            featureFlags: { ...flags, aEmotionM1: false, aEmotionM2: false, aEmotionM3: false, aEmotionKeyModals: false, aEmotionM4: false, aEmotionSimplePromise: false, aEmotionM5: false, aEmotionStageMilestones: false, aEmotionInteractionHistory: false, aEmotionM6: false, aEmotionRecovery: false },
            aEmotionM6Rollback: { schemaVersion: "a_emotion_m6_rollback_v1", reason: input.reason.trim(), changedAt }
          } as Prisma.InputJsonValue
        }
      });
      if (changed.count !== 1) throw new ConflictException({ code: "A_EMOTION_M6_RUN_VERSION_MISMATCH", message: "Run version changed" });
      return { schemaVersion: "a_emotion_m6_rollback_result_v1", roomId: input.roomId, version: input.expectedVersion + 1, changedAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async isRunPaused(runId: string) {
    const run = await this.prisma.storyRun.findUnique({ where: { id: runId }, select: { stateJson: true } });
    return run ? readAEmotionPauseState(run.stateJson).paused : true;
  }

  async assertRecoveryAllowed(tx: Tx, runId: string) {
    const run = await tx.storyRun.findUnique({
      where: { id: runId },
      select: { templateKey: true, mode: true, maxPlayers: true, engineVersion: true, stateJson: true }
    });
    if (!run) throw new ServiceUnavailableException({ code: "A_EMOTION_M6_RUN_MISSING", message: "Run is missing" });
    if (!isAEmotionM6EnabledForRun(run)) return;
    if (readAEmotionPauseState(run.stateJson).paused) {
      throw new ServiceUnavailableException({ code: A_EMOTION_M6_PAUSED_CODE, message: "A-Emotion processing is paused for this room" });
    }
  }
}

export function isAEmotionM6PausedError(error: unknown) {
  if (!error || typeof error !== "object" || !("getResponse" in error) || typeof error.getResponse !== "function") return false;
  const response = error.getResponse();
  return Boolean(response && typeof response === "object" && (response as { code?: unknown }).code === A_EMOTION_M6_PAUSED_CODE);
}

export function isAEmotionM6TaskType(taskType: string) {
  return (A_EMOTION_M6_TASK_TYPES as readonly string[]).includes(taskType);
}

function recoveryResult(
  recoveredExpiredLeases: number,
  recoveredLegacyLeases: number,
  deadLetteredTasks: number,
  leftCompletedUntouched: number,
  now: Date
): AEmotionM6RecoveryResultV1 {
  const candidate = { schemaVersion: A_EMOTION_M6_RECOVERY_RESULT_SCHEMA_VERSION, recoveredExpiredLeases, recoveredLegacyLeases, deadLetteredTasks, leftCompletedUntouched, recoveredAt: now.toISOString() };
  const validated = validateAEmotionM6RecoveryResultV1(candidate);
  if (!validated.ok) throw new Error(`A_EMOTION_M6_RECOVERY_RESULT_INVALID:${validated.errors.join("|")}`);
  return validated.value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
