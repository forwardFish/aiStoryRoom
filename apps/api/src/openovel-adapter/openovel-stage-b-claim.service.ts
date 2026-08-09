import { ConflictException } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { OPENOVEL_ENGINE_VERSION, type OpenNovelPublicRun, type OpenNovelTurnEvent } from "./openovel-runtime.client";
import { OpenNovelStageBCommitService } from "./openovel-stage-b-commit.service";
import { ACTION_SLOT, CHAPTER_INDEX, type ActionContext, type BoundOption, type ClaimResult } from "./openovel-stage-b-types";
import {
  actionMetadata,
  asRecord,
  isUniqueConstraint,
  openNovelPlayerActionId,
  openNovelRevisionNodeId,
  openNovelRevisionNodeIndex,
  publicTurnResult,
  revisionConflict,
  sleep,
} from "./openovel-stage-b-utils";

export abstract class OpenNovelStageBClaimService extends OpenNovelStageBCommitService {
  protected async claimRevision(input: {
    user: AuthenticatedUser;
    run: any;
    role: any;
    runtimeBefore: OpenNovelPublicRun;
    actionText: string;
    boundOption: BoundOption | null;
    requestHash: string;
    actionKey: string;
    expectedRevision: number;
    requestedTurnId: string;
  }): Promise<ClaimResult> {
    const nextTurn = input.expectedRevision + 1;
    const nodeId = openNovelRevisionNodeId(input.run.id, nextTurn);
    const actionId = openNovelPlayerActionId(input.actionKey);
    try {
      return await (this.stageBPrisma as any).$transaction(async (tx: any) => {
        const node = await tx.sceneNode.create({
          data: {
            id: nodeId,
            runId: input.run.id,
            chapterIndex: CHAPTER_INDEX,
            nodeIndex: openNovelRevisionNodeIndex(nextTurn),
            title: `OpenNovel Turn ${nextTurn}`,
            publicNarration: input.runtimeBefore.recentCanon,
            nodeGoal: input.actionText,
            status: "resolving",
            actionOptionsJson: input.runtimeBefore.options,
          },
        });
        const action = await tx.playerAction.create({
          data: {
            id: actionId,
            runId: input.run.id,
            nodeId: node.id,
            chapterIndex: CHAPTER_INDEX,
            userId: input.user.id,
            roleId: input.role.id,
            playerType: "human",
            actionType: input.boundOption ? "openovel_option" : "openovel_free_text",
            method: input.actionText,
            intent: input.actionText,
            freeText: input.boundOption ? null : input.actionText,
            riskLevel: "normal",
            guardStatus: "shadow",
            auditStatus: "shadow",
            status: "generating",
            actionSlot: ACTION_SLOT,
            actorKind: "HUMAN",
            provider: OPENOVEL_ENGINE_VERSION,
            actionKey: input.boundOption?.id || null,
            idempotencyKey: input.actionKey,
            requestHash: input.requestHash,
            immediateJson: {
              boundOption: input.boundOption,
              expectedStateRevision: input.expectedRevision,
              requestedTurnId: input.requestedTurnId,
              chargeAttempt: 1,
            },
          },
        });
        return { created: true, action, nodeId: node.id };
      }, { maxWait: 10_000, timeout: 30_000 });
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      // The conflicting transaction is only the small DB claim transaction,
      // never the model call. Give PostgreSQL enough time to make the winning
      // row visible before declaring a revision conflict.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const existing = await (this.stageBPrisma as any).playerAction.findUnique({
          where: { idempotencyKey: input.actionKey },
        });
        if (existing) return { created: false, action: existing, nodeId: existing.nodeId };
        const blocker = await (this.stageBPrisma as any).playerAction.findFirst({
          where: {
            runId: input.run.id,
            nodeId,
            roleId: input.role.id,
            actionSlot: ACTION_SLOT,
          },
        });
        if (blocker) throw revisionConflict(input.expectedRevision, input.expectedRevision + 1);
        await sleep(Math.min(10 * (attempt + 1), 100));
      }
      throw revisionConflict(input.expectedRevision, input.expectedRevision + 1);
    }
  }

  protected async reconcileExistingAction(input: {
    user: AuthenticatedUser;
    run: any;
    action: any;
    onProgress: (event: OpenNovelTurnEvent) => void | Promise<void>;
  }): Promise<any> {
    const action = await this.refreshAction(input.action.id) || input.action;
    const metadata = actionMetadata(action);
    const role = await this.roleForAction(input.run.id, action.roleId);
    const context: ActionContext = {
      user: input.user,
      run: input.run,
      role,
      action,
      nodeId: action.nodeId,
      actionText: String(action.method || action.freeText || ""),
      boundOption: metadata.boundOption,
      requestHash: String(action.requestHash || ""),
      expectedRevision: metadata.expectedStateRevision,
      requestedTurnId: metadata.requestedTurnId,
    };

    if (action.status === "resolved" && action.resolvedJson) {
      const result = publicTurnResult(asRecord(action.resolvedJson));
      await this.settleCharge(context, await this.ensureCharge(context));
      await input.onProgress({ type: "turn.committed", data: result });
      return result;
    }

    if (["failed", "rejected"].includes(String(action.status))) {
      const reclaimed = await this.reclaimFailedAction(context);
      if (!reclaimed) {
        const refreshed = await this.refreshAction(action.id);
        if (!refreshed) throw new Error("OPENOVEL_ACTION_DISAPPEARED");
        return this.reconcileExistingAction({ ...input, action: refreshed });
      }
      context.action = reclaimed;
      const refreshedMetadata = actionMetadata(reclaimed);
      context.expectedRevision = refreshedMetadata.expectedStateRevision;
      context.requestedTurnId = refreshedMetadata.requestedTurnId;
      return this.executeOrJoin(context, input.onProgress, false);
    }

    if (action.status !== "generating") {
      throw new ConflictException({
        code: "OPENOVEL_ACTION_NOT_RECOVERABLE",
        message: "That action is not in a recoverable state.",
      });
    }
    return this.executeOrJoin(context, input.onProgress, true);
  }
}
