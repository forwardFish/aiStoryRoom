import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { TurnDecisionCommandV2 } from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { creditRequestHash } from "../credits/credit-policy";
import { CreditConsumptionService } from "../credits/credit-consumption.service";
import { PrismaService } from "../prisma.service";
import { StoryService } from "../story.service";
import type { OpenNovelMirrorEvent } from "./openovel-adapter.service";
import { OpenNovelStageBClaimService } from "./openovel-stage-b-claim.service";
import {
  OpenNovelRuntimeClient,
  type OpenNovelTurnEvent,
} from "./openovel-runtime.client";
import { OpenNovelTurnReplayClient } from "./openovel-turn-replay.client";
import type { ActionContext, SubmitActionInput } from "./openovel-stage-b-types";
import {
  actionMetadata,
  asRecord,
  decisionResponse,
  idempotencyConflict,
  normalizeBoundOption,
  openNovelActionIdempotencyKey,
  publicTurnResult,
  requiredIdempotency,
  revisionConflict,
  turnIdForRevision,
} from "./openovel-stage-b-utils";

/**
 * Stage B production implementation. Run creation, projections and ending
 * adjudication stay with the existing adapter; only the turn commit boundary
 * is replaced with a database claim + authoritative Runtime-Head replay.
 */
@Injectable()
export class ReconciledOpenNovelAdapterService extends OpenNovelStageBClaimService {
  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(StoryService) story: StoryService,
    @Inject(CreditConsumptionService) credits: CreditConsumptionService,
    @Inject(OpenNovelRuntimeClient) runtime: OpenNovelRuntimeClient,
    @Inject(OpenNovelTurnReplayClient) replayRuntime: OpenNovelTurnReplayClient,
  ) {
    super(prisma, story, credits, runtime, replayRuntime);
  }

  override async submitDecision(
    user: AuthenticatedUser,
    runId: string,
    turnId: string,
    command: TurnDecisionCommandV2,
  ) {
    const idempotencyKey = requiredIdempotency(command.idempotencyKey);
    const replayKey = openNovelActionIdempotencyKey(runId, user.id, idempotencyKey);
    const replay = await (this.stageBPrisma as any).playerAction.findUnique({
      where: { idempotencyKey: replayKey },
    });
    if (replay) {
      const run = await this.stageBAuthorizedRun(user, runId);
      const customAction = String(command.customAction || "").trim();
      const stored = actionMetadata(replay);
      const matchesOriginalRequest = replay.runId === runId
        && replay.userId === user.id
        && stored.requestedTurnId === turnId
        && stored.expectedStateRevision === command.turnRevision
        && (customAction
          ? !stored.boundOption && String(replay.freeText || replay.method || "") === customAction
          : Boolean(stored.boundOption)
            && stored.boundOption!.id === String(command.candidateId || ""));
      if (!matchesOriginalRequest) throw idempotencyConflict();
      const result = await this.reconcileExistingAction({
        user,
        run,
        action: replay,
        onProgress: () => undefined,
      });
      return decisionResponse(result, turnId, command.turnRevision + 1, await super.game(user, runId));
    }

    const runtimeBefore = await this.stageBRuntime.getRun(runId);
    const expectedTurnId = turnIdForRevision(runtimeBefore.turnNumber + 1);
    if (turnId !== expectedTurnId || command.turnRevision !== runtimeBefore.turnNumber) {
      throw revisionConflict(command.turnRevision, runtimeBefore.turnNumber);
    }
    const customAction = String(command.customAction || "").trim();
    const selected = customAction
      ? null
      : runtimeBefore.options.find((option: { id: string }) => option.id === command.candidateId) || null;
    if (!customAction && !selected) {
      throw new BadRequestException({
        code: "OPENOVEL_OPTION_INVALID",
        message: "Choose one of the current story actions.",
      });
    }
    const action = customAction || selected!.label;
    const result = await this.submitAction(user, runId, {
      action,
      idempotencyKey,
      expectedStateRevision: command.turnRevision,
      boundOption: selected ? { id: selected.id, label: selected.label } : null,
    }, () => undefined);
    return decisionResponse(result, expectedTurnId, runtimeBefore.turnNumber + 1, await super.game(user, runId));
  }

  override async submitAction(
    user: AuthenticatedUser,
    runId: string,
    input: SubmitActionInput,
    onEvent: (event: OpenNovelTurnEvent) => void | Promise<void>,
  ) {
    this.stageBAssertEnabled();
    const run = await this.stageBAuthorizedRun(user, runId);
    const actionText = String(input.action || "").trim();
    if (!actionText) {
      throw new BadRequestException({
        code: "OPENOVEL_ACTION_REQUIRED",
        message: "Choose or enter an action.",
      });
    }
    if (actionText.length > 2_000) {
      throw new BadRequestException({
        code: "OPENOVEL_ACTION_TOO_LONG",
        message: "The action is too long.",
      });
    }
    const idempotencyKey = requiredIdempotency(input.idempotencyKey);
    const boundOption = normalizeBoundOption(input.boundOption);
    const requestHash = creditRequestHash({ runId, action: actionText, boundOption });
    const actionKey = openNovelActionIdempotencyKey(runId, user.id, idempotencyKey);

    const replay = await (this.stageBPrisma as any).playerAction.findUnique({
      where: { idempotencyKey: actionKey },
    });
    if (replay) {
      this.assertReplayRequest(replay, {
        runId,
        userId: user.id,
        requestHash,
        expectedRevision: input.expectedStateRevision,
      });
      return this.reconcileExistingAction({ user, run, action: replay, onProgress: onEvent });
    }

    const runtimeBefore = await this.stageBRuntime.getRun(runId);
    const role = run.players[0]?.role;
    if (!role || role.roleKey !== run.selectedRoleKey || runtimeBefore.roleId !== role.roleKey) {
      throw new ForbiddenException({
        code: "OPENOVEL_ROLE_REQUIRED",
        message: "The player must control the role selected for this story run.",
      });
    }
    const expectedRevision = Number.isInteger(input.expectedStateRevision)
      ? Number(input.expectedStateRevision)
      : runtimeBefore.turnNumber;
    if (expectedRevision !== runtimeBefore.turnNumber) {
      throw revisionConflict(expectedRevision, runtimeBefore.turnNumber);
    }
    const nextTurn = expectedRevision + 1;
    const requestedTurnId = turnIdForRevision(nextTurn);
    const claim = await this.claimRevision({
      user,
      run,
      role,
      runtimeBefore,
      actionText,
      boundOption,
      requestHash,
      actionKey,
      expectedRevision,
      requestedTurnId,
    });
    if (!claim.created) {
      this.assertReplayRequest(claim.action, {
        runId,
        userId: user.id,
        requestHash,
        expectedRevision,
      });
      return this.reconcileExistingAction({ user, run, action: claim.action, onProgress: onEvent });
    }
    return this.executeOrJoin({
      user,
      run,
      role,
      action: claim.action,
      nodeId: claim.nodeId,
      actionText,
      boundOption,
      requestHash,
      expectedRevision,
      requestedTurnId,
    }, onEvent, false);
  }

  override async applyMirrorEvent(input: OpenNovelMirrorEvent) {
    const kind = String(input.kind || "").trim();
    const runId = String(input.runId || "").trim();
    if (!runId || !/^solo_ovl_[a-f0-9]{32}$/.test(runId)) {
      throw new BadRequestException({
        code: "OPENOVEL_MIRROR_RUN_INVALID",
        message: "The mirror event has an invalid run id.",
      });
    }
    if (kind === "run.created" || kind === "runtime.warning") {
      return { accepted: true, applied: false, kind };
    }
    if (kind !== "turn.committed") {
      throw new BadRequestException({
        code: "OPENOVEL_MIRROR_KIND_INVALID",
        message: "The mirror event kind is not supported.",
      });
    }

    const payload = asRecord(input.payload);
    const submissionId = String(payload.submissionId || "").trim();
    const result = publicTurnResult(asRecord(payload.result));
    if (
      !submissionId
      || String(result.runId || "") !== runId
      || !/^T\d{2,}$/.test(String(result.turnId || ""))
      || !Number.isInteger(Number(result.turnNumber))
    ) {
      throw new BadRequestException({
        code: "OPENOVEL_MIRROR_PAYLOAD_INVALID",
        message: "The committed turn mirror payload is incomplete.",
      });
    }

    const [run, action, runtimeAfter] = await Promise.all([
      (this.stageBPrisma as any).storyRun.findUnique({ where: { id: runId } }),
      (this.stageBPrisma as any).playerAction.findUnique({ where: { id: submissionId } }),
      this.stageBRuntime.getRun(runId),
    ]);
    if (!run) {
      throw new NotFoundException({
        code: "OPENOVEL_MIRROR_RUN_NOT_FOUND",
        message: "The mirrored run is not yet available.",
      });
    }
    if (!action || action.runId !== runId) {
      throw new NotFoundException({
        code: "OPENOVEL_MIRROR_ACTION_NOT_FOUND",
        message: "The mirrored player action is not yet available.",
      });
    }
    if (runtimeAfter.turnNumber < Number(result.turnNumber)) {
      throw new ConflictException({
        code: "OPENOVEL_MIRROR_RUNTIME_BEHIND",
        message: "The runtime has not exposed the committed turn yet.",
      });
    }
    const metadata = actionMetadata(action);
    const role = await this.roleForAction(runId, action.roleId);
    const context: ActionContext = {
      user: { id: run.ownerUserId } as AuthenticatedUser,
      run,
      role,
      action,
      nodeId: action.nodeId,
      actionText: String(action.method || action.freeText || ""),
      boundOption: metadata.boundOption,
      requestHash: String(action.requestHash || ""),
      expectedRevision: metadata.expectedStateRevision,
      requestedTurnId: metadata.requestedTurnId,
    };
    const applied = await this.persistStageBCommittedTurn(context, runtimeAfter, result);
    await this.settleCharge(context, await this.ensureCharge(context));
    return {
      accepted: true,
      applied,
      kind,
      runId,
      turnId: result.turnId,
    };
  }
}

export {
  canonicalHash,
  openNovelActionIdempotencyKey,
  openNovelChargeIdempotencyKey,
  openNovelCommitEventId,
  openNovelPlayerActionId,
  openNovelRevisionNodeId,
  openNovelRevisionNodeIndex,
} from "./openovel-stage-b-utils";
