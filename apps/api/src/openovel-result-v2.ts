import { createHash } from "node:crypto";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  NARRATIVE_PENDING_MESSAGE_ZH,
  OPENOVEL_AUTHORITATIVE_RESULT_STATE_KEY,
  OPENOVEL_RESULT_SCHEMA_V2,
  isNarrativeProjectionStatus,
  parseStoredOpenNovelResultV2,
  projectOpenNovelResultV2,
  type NarrativeProjectionStatus,
  type OpenNovelResultV2,
} from "@ai-story/shared";
import type { AuthenticatedUser } from "./auth/current-user.decorator";
import type { PrismaService } from "./prisma.service";
import type { OpenNovelPublicRun } from "./openovel-adapter/openovel-runtime.client";

const FINAL_CHECKPOINTS = [
  "B0_AUTHORITATIVE_RESULT_FINALIZED",
  "LEGACY_AUTHORITATIVE_RESULT_FINALIZED",
] as const;

/** Read-only projection. GET Result must never invoke Settlement, Provider or a writer. */
export async function readOpenNovelResultV2(
  prisma: PrismaService,
  user: AuthenticatedUser,
  runId: string,
): Promise<OpenNovelResultV2 | null> {
  const run = await prisma.storyRun.findUnique({
    where: { id: runId },
    include: {
      players: { where: { userId: user.id }, include: { role: true } },
      roles: { orderBy: { id: "asc" } },
    },
  });
  if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
  if (run.ownerUserId !== user.id && !run.players.length) {
    throw new ForbiddenException({ code: "ROOM_ACCESS_DENIED", message: "You are not a member of this room." });
  }

  const state = asRecord(run.stateJson);
  const stored = parseStoredOpenNovelResultV2(state?.[OPENOVEL_AUTHORITATIVE_RESULT_STATE_KEY]);
  if (!stored) return null;

  const membershipRole = run.players[0]?.role
    ?? run.roles.find((role) => role.roleKey === run.selectedRoleKey)
    ?? null;
  const roleId = membershipRole?.id ?? null;
  const [entry, task] = roleId
    ? await Promise.all([
        prisma.narrativeEntry.findFirst({
          where: {
            runId,
            roleId,
            sourceCommitHash: stored.sourceCommitHash,
            entryType: { in: ["B0_ENDING", "OPENOVEL_ENDING"] },
          },
          select: {
            content: true,
            presentationHash: true,
            projectionStatus: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.storyTaskOutbox.findFirst({
          where: {
            runId,
            roleId,
            taskType: "B0_NARRATIVE_GENERATION",
            checkpointKey: { in: [...FINAL_CHECKPOINTS] },
          },
          select: {
            status: true,
            resultJson: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        }),
      ])
    : [null, null];

  const taskResult = asRecord(task?.resultJson);
  const status = resolveNarrativeStatusV2({
    entryStatus: entry?.projectionStatus,
    taskProjectionStatus: taskResult?.narrativeStatus,
    taskStatus: task?.status,
    fallback: stored.narrativeStatus,
  });
  return projectOpenNovelResultV2(stored, roleId, {
    status,
    content: entry?.content ?? null,
    presentationHash: entry?.presentationHash
      ?? (typeof taskResult?.presentationHash === "string" ? taskResult.presentationHash : null),
    updatedAt: entry?.updatedAt?.toISOString() ?? task?.updatedAt?.toISOString() ?? null,
  });
}

export function resolveNarrativeStatusV2(input: {
  entryStatus?: unknown;
  taskProjectionStatus?: unknown;
  taskStatus?: unknown;
  fallback?: NarrativeProjectionStatus;
}): NarrativeProjectionStatus {
  if (isNarrativeProjectionStatus(input.entryStatus)) return input.entryStatus;
  const taskStatus = String(input.taskStatus ?? "").toLowerCase();
  if (["failed", "dead_letter", "failed_retryable"].includes(taskStatus)) return "FAILED_RETRYABLE";
  if (isNarrativeProjectionStatus(input.taskProjectionStatus)) return input.taskProjectionStatus;
  if (taskStatus === "running") return "GENERATING";
  if (taskStatus === "pending") return "PENDING";
  return input.fallback ?? "PENDING";
}

/** Completed historical OpenNovel runs remain read-only but use the same result contract. */
export function projectHistoricalOpenNovelResultV2(input: {
  run: any;
  runtimeRun: OpenNovelPublicRun;
  role: any | null;
}): OpenNovelResultV2 {
  const ending = input.runtimeRun.ending;
  if (!ending) throw new Error("HISTORICAL_ENDING_REQUIRED");
  const content = [
    ending.finalSceneNarrative,
    `主角命运：${ending.protagonistFate}`,
    ...ending.aftermath,
  ].filter(Boolean).join("\n\n");
  const sourceCommitHash = createHash("sha256").update(JSON.stringify({
    runId: input.run.id,
    ending,
    turnNumber: input.runtimeRun.turnNumber,
  })).digest("hex");
  return Object.freeze({
    schemaVersion: OPENOVEL_RESULT_SCHEMA_V2,
    authoritativeResultStatus: "FINALIZED",
    structuredResultReady: true,
    sourceKind: "HISTORICAL_READ_ONLY",
    sourceCommitHash,
    decisionHash: sourceCommitHash,
    worldSequence: Number(input.run.worldSequence ?? input.runtimeRun.turnNumber ?? 0),
    completedAt: String(input.runtimeRun.updatedAt),
    room: Object.freeze({
      id: input.run.id,
      title: input.run.title,
      worldId: input.run.templateKey,
    }),
    ending: Object.freeze({
      scope: ending.scope,
      endingKey: ending.endingKey,
      title: ending.title,
      summary: ending.finalSceneNarrative,
      protagonistFate: ending.protagonistFate,
      aftermath: ending.aftermath,
    }),
    canon: Object.freeze([]),
    result: Object.freeze({
      title: ending.title,
      summary: ending.protagonistFate,
      worldOutcome: ending.aftermath.join(" "),
    }),
    player: input.role ? Object.freeze({
      roleId: input.role.id,
      roleKey: input.role.roleKey,
      roleName: input.role.roleName,
      outcome: "RESOLVED",
      title: ending.title,
      summary: ending.protagonistFate,
      causes: ending.aftermath,
    }) : null,
    narrativeStatus: "PUBLISHED",
    narrative: Object.freeze({
      status: "PUBLISHED",
      content,
      presentationHash: createHash("sha256").update(`${sourceCommitHash}\0${content}`).digest("hex"),
      updatedAt: input.runtimeRun.updatedAt,
      message: null,
    }),
  });
}

export const OPENOVEL_RESULT_PENDING_MESSAGE = NARRATIVE_PENDING_MESSAGE_ZH;

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}
