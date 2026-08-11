import type { Prisma } from "@prisma/client";
import { OPENOVEL_AUTHORITATIVE_RESULT_STATE_KEY } from "@ai-story/shared";
import type { PrismaService } from "../prisma.service";
import type { LegacyTerminalCommitInputV1 } from "./legacy-terminal-input-adapter";

/**
 * Authoritative terminal writer. It owns no Renderer, Provider, TruthGuard or
 * Publisher dependency. Ending, Canon, Result, run completion and Narrative
 * Outbox become visible in one database transaction.
 */
export class AuthoritativeLegacyTerminalCommitter {
  constructor(private readonly prisma: PrismaService) {}

  async commit(input: LegacyTerminalCommitInputV1) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.storyRun.findUnique({
        where: { id: input.runId },
        select: { status: true, stateJson: true },
      });
      if (!current) throw new Error("LEGACY_TERMINAL_RUN_MISSING");
      const existing = asRecord(current.stateJson)?.[OPENOVEL_AUTHORITATIVE_RESULT_STATE_KEY];
      if (asRecord(existing)?.schemaVersion === "openovel-result-v2") return existing;
      if (current.status === "completed") throw new Error("LEGACY_COMPLETED_RUN_READ_ONLY");

      const completedAt = new Date(input.authoritativeResult.completedAt);
      await tx.canonFact.upsert({
        where: { runId_factKey: { runId: input.runId, factKey: "legacy.terminal.authoritative-result" } },
        update: {},
        create: {
          runId: input.runId,
          sourceNodeId: input.nodeId,
          factKey: "legacy.terminal.authoritative-result",
          content: input.authoritativeResult.result.worldOutcome,
          status: "confirmed",
          visibility: "public",
          sourceEventIdsJson: ["legacy-terminal-adapter-v1"] as Prisma.InputJsonValue,
          sourceActionIdsJson: [input.actionIdempotencyKey] as Prisma.InputJsonValue,
          knownByRoleIdsJson: [input.roleId] as Prisma.InputJsonValue,
        },
      });

      const action = await tx.playerAction.upsert({
        where: { idempotencyKey: input.actionIdempotencyKey },
        update: {},
        create: {
          runId: input.runId,
          nodeId: input.nodeId,
          chapterIndex: input.chapterIndex,
          userId: input.userId,
          roleId: input.roleId,
          playerType: "human",
          actionType: "choose",
          method: input.action,
          intent: "Commit the unfinished legacy terminal choice authoritatively.",
          riskLevel: "normal",
          freeText: input.action,
          status: "resolved",
          actionSlot: "LEGACY_TERMINAL",
          actorKind: "HUMAN",
          controlEpoch: 0,
          policyVersion: "legacy-terminal-adapter-v1",
          idempotencyKey: input.actionIdempotencyKey,
          requestHash: input.requestHash,
          visibility: "private",
          resolvedAt: completedAt,
          resolvedJson: {
            turnId: "T20",
            turnNumber: 20,
            narration: input.authoritativeResult.result.summary,
            ending: input.authoritativeResult.ending,
            authoritativeResultStatus: "FINALIZED",
            structuredResultReady: true,
            sourceCommitHash: input.authoritativeResult.sourceCommitHash,
          } as Prisma.InputJsonValue,
        },
      });

      const state = asRecord(current.stateJson) ?? {};
      await tx.storyRun.update({
        where: { id: input.runId },
        data: {
          status: "completed",
          currentDay: 20,
          completedNodeCount: { increment: 1 },
          summary: input.authoritativeResult.result.summary,
          stateJson: {
            ...state,
            [OPENOVEL_AUTHORITATIVE_RESULT_STATE_KEY]: input.authoritativeResult,
            legacyTerminal: {
              schemaVersion: "legacy-terminal-state-v1",
              adaptedFromTurn: 19,
              terminalHeadCreated: false,
              completedAt: input.authoritativeResult.completedAt,
              sourceCommitHash: input.authoritativeResult.sourceCommitHash,
            },
          } as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });

      const fallbackLines = [
        input.authoritativeResult.ending.summary,
        input.authoritativeResult.ending.protagonistFate,
        ...input.authoritativeResult.ending.aftermath,
      ];
      await tx.storyTaskOutbox.upsert({
        where: { dedupeKey: `legacy-ending:${input.runId}:${input.roleId}:${input.authoritativeResult.sourceCommitHash}` },
        update: {},
        create: {
          runId: input.runId,
          nodeId: input.nodeId,
          windowId: null,
          roleId: input.roleId,
          dedupeKey: `legacy-ending:${input.runId}:${input.roleId}:${input.authoritativeResult.sourceCommitHash}`,
          taskType: "B0_NARRATIVE_GENERATION",
          status: "pending",
          inputRefId: input.authoritativeResult.sourceCommitHash,
          checkpointKey: "LEGACY_AUTHORITATIVE_RESULT_FINALIZED",
          resultJson: {
            schemaVersion: "openovel-narrative-task-result-v1",
            authoritativeResultStatus: "FINALIZED",
            structuredResultReady: true,
            narrativeStatus: "PENDING",
            sourceKind: "LEGACY_TERMINAL",
            sourceCommitHash: input.authoritativeResult.sourceCommitHash,
            sourcePayload: {
              runId: input.runId,
              nodeId: input.nodeId,
              windowId: null,
              roleId: input.roleId,
              entryType: "OPENOVEL_ENDING",
              visibility: "private",
              worldSequence: input.authoritativeResult.worldSequence,
              dedupeKey: `legacy-ending:${input.runId}:${input.roleId}`,
              providerInput: {
                authoritativeResult: input.authoritativeResult,
                recipientRoleId: input.roleId,
                guidance: {
                  schemaVersion: "openovel-ending-guidance-v1",
                  styleDirectives: [
                    "Render only the supplied authoritative ending.",
                    "Do not change the outcome, resources, winner, causes or role scope.",
                  ],
                },
              },
              fallbackLines,
              forbiddenPhrases: [],
              forbiddenClaims: [],
            },
          } as Prisma.InputJsonValue,
        },
      });

      return {
        ...input.authoritativeResult,
        terminalActionId: action.id,
      };
    }, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 30_000,
    });
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}
