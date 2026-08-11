import { ConflictException } from "@nestjs/common";
import type { OpenNovelPublicRun } from "../openovel-adapter/openovel-runtime.client";
import {
  buildOpenNovelAuthoritativeResultV2,
  sha256CanonicalValue,
} from "./authoritative-result-builder";
import { LEGACY_TERMINAL_PREDECESSOR_TURN } from "./legacy-t20-head-guard";

export type LegacyTerminalCommitInputV1 = Readonly<{
  schemaVersion: "legacy-terminal-input-v1";
  runId: string;
  nodeId: string;
  chapterIndex: number;
  userId: string;
  roleId: string;
  roleKey: string;
  action: string;
  actionIdempotencyKey: string;
  requestHash: string;
  authoritativeResult: ReturnType<typeof buildOpenNovelAuthoritativeResultV2>;
}>;

export class LegacyTerminalInputAdapter {
  adapt(input: {
    run: any;
    runtimeRun: OpenNovelPublicRun;
    role: any;
    userId: string;
    action: string;
    actionIdempotencyKey: string;
    requestHash: string;
  }): LegacyTerminalCommitInputV1 {
    if (input.runtimeRun.turnNumber !== LEGACY_TERMINAL_PREDECESSOR_TURN) {
      throw new ConflictException({
        code: "LEGACY_TERMINAL_INPUT_NOT_READY",
        message: "Only an unfinished T19 run can be adapted to the authoritative terminal input.",
        recoverable: false,
      });
    }
    const nodeId = String(input.run.currentNodeId ?? "").trim();
    if (!nodeId) {
      throw new ConflictException({
        code: "LEGACY_TERMINAL_NODE_REQUIRED",
        message: "The unfinished legacy run has no authoritative predecessor node.",
        recoverable: false,
      });
    }
    const roleId = String(input.role?.id ?? "").trim();
    const roleKey = String(input.role?.roleKey ?? input.runtimeRun.roleId ?? "").trim();
    if (!roleId || !roleKey) {
      throw new ConflictException({
        code: "LEGACY_TERMINAL_ROLE_REQUIRED",
        message: "The unfinished legacy run has no authoritative role binding.",
        recoverable: false,
      });
    }

    const action = String(input.action || "").trim();
    const canonLine = String(input.runtimeRun.recentCanon || input.runtimeRun.canon || "").trim()
      || "The nineteenth turn is the last confirmed legacy canon.";
    const decisionHash = sha256CanonicalValue({
      runId: input.run.id,
      predecessorTurn: input.runtimeRun.turnNumber,
      action,
      canonLine,
      roleId,
    });
    const endingTitle = "The Last Confirmed Choice";
    const protagonistFate = `${input.role.roleName || roleKey} reaches a final authoritative decision without creating a new legacy T20 head.`;
    const aftermath = [
      canonLine,
      `Terminal choice: ${action}`,
      "The literary last scene is projected asynchronously from this immutable result.",
    ];
    const completedAt = new Date().toISOString();
    const authoritativeResult = buildOpenNovelAuthoritativeResultV2({
      sourceKind: "LEGACY_TERMINAL",
      runId: input.run.id,
      title: input.run.title,
      worldId: input.run.templateKey,
      decisionHash,
      worldSequence: Number(input.run.worldSequence ?? input.runtimeRun.turnNumber),
      completedAt,
      ending: Object.freeze({
        scope: "STORY",
        endingKey: "legacy_t19_authoritative_terminal",
        title: endingTitle,
        summary: `The legacy story closes from its confirmed T19 state: ${action}`,
        protagonistFate,
        aftermath,
      }),
      canon: Object.freeze([
        Object.freeze({ factKey: "legacy.terminal.t19", content: canonLine }),
        Object.freeze({ factKey: "legacy.terminal.choice", content: action }),
      ]),
      result: Object.freeze({
        title: endingTitle,
        summary: protagonistFate,
        worldOutcome: aftermath.join(" "),
      }),
      seatResults: Object.freeze([
        Object.freeze({
          roleId,
          roleKey,
          roleName: input.role.roleName || roleKey,
          outcome: "RESOLVED",
          title: endingTitle,
          summary: protagonistFate,
          causes: aftermath,
        }),
      ]),
    });

    return Object.freeze({
      schemaVersion: "legacy-terminal-input-v1",
      runId: input.run.id,
      nodeId,
      chapterIndex: Number(input.run.currentChapter ?? 1),
      userId: input.userId,
      roleId,
      roleKey,
      action,
      actionIdempotencyKey: input.actionIdempotencyKey,
      requestHash: input.requestHash,
      authoritativeResult,
    });
  }
}
