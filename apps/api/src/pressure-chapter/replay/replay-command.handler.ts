import {
  validatePressureReplayCommandV1,
  validateReplayCreationReceiptV1,
  type PressureReplayCommandV1,
  type ReplayCreationReceiptV1,
} from "@ai-story/shared";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "../result/errors";
import {
  toReplayPolicySourceV1,
  validateAuthoritativePressureResultSnapshotV1,
  validateResultViewerContextV1,
  type AuthoritativeResultReaderPort,
  type ResultViewerAuthorizerPort,
} from "../result/ports";
import { ResultContractRegistryV1 } from "../result/registry";
import {
  validateReplayResolvedTargetV1,
  validateStoredReplayExecutionV1,
  type ReplayCreationTransactionPort,
  type ReplayExecutionReaderPort,
  type ReplayResolvedTargetV1,
  type ReplayTargetRouteResolverPort,
} from "./ports";
import { PressureReplayPolicyEvaluatorV1 } from "./replay-policy";

/** Separate command boundary. It can create only a new target/receipt. */
export class PressureReplayCommandHandlerV1 {
  constructor(
    private readonly resultReader: AuthoritativeResultReaderPort,
    private readonly viewerAuthorizer: ResultViewerAuthorizerPort,
    private readonly replayPolicy: PressureReplayPolicyEvaluatorV1,
    private readonly executionReader: ReplayExecutionReaderPort,
    private readonly routeResolver: ReplayTargetRouteResolverPort,
    private readonly creator: ReplayCreationTransactionPort,
    private readonly registry = new ResultContractRegistryV1(),
  ) {}

  async execute(
    viewerIdValue: string,
    commandValue: unknown,
  ): Promise<ReplayCreationReceiptV1> {
    const viewerId = required(viewerIdValue, "viewerId");
    const command = validatePressureReplayCommandV1(commandValue);

    const rawViewer = await this.viewerAuthorizer.readViewerContext(
      command.sourceRunId,
      viewerId,
    );
    if (rawViewer === null) {
      failPressureResultRead(ERROR.RESULT_ACCESS_DENIED, "viewerId");
    }
    const viewer = validateResultViewerContextV1(
      rawViewer,
      command.sourceRunId,
      viewerId,
    );

    const rawSource = await this.resultReader.readFinalized(command.sourceRunId);
    if (rawSource === null) {
      failPressureResultRead(ERROR.RESULT_NOT_READY, "replayCommand.sourceRunId");
    }
    const source = validateAuthoritativePressureResultSnapshotV1(
      rawSource,
      command.sourceRunId,
    );
    this.registry.resolvePressure({
      resultContractRegistryVersion: source.resultContractRegistryVersion,
      frozenRoute: source.frozenRoute,
      payloadSchemaVersion: source.payloadSchemaVersion,
      presentationSchemaVersion: source.presentationSchemaVersion,
      rendererKey: source.rendererKey,
    });
    const policySource = toReplayPolicySourceV1(source);
    const authorized = await this.replayPolicy.authorizeCommand(
      policySource,
      viewer,
      command,
    );

    const previousValue = await this.executionReader.readExecution(
      command.sourceRunId,
      command.idempotencyKey,
    );
    if (previousValue !== null) {
      const previous = validateStoredReplayExecutionV1(
        previousValue,
        command.sourceRunId,
        command.idempotencyKey,
      );
      if (previous.requestFingerprint !== command.requestFingerprint) {
        failPressureResultRead(
          ERROR.IDEMPOTENCY_KEY_REUSED,
          "replayCommand.idempotencyKey",
        );
      }
      this.assertReceiptMatches(
        previous.receipt,
        command,
        authorized.action.launchKind,
        null,
        authorized.action.href,
        false,
      );
      return structuredClone(previous.receipt);
    }

    const target = await this.resolveTarget(authorized.action.targetExperience, source);
    const rawReceipt = await this.creator.createOnce({
      sourceRunId: command.sourceRunId,
      viewerId,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: command.requestFingerprint,
      action: structuredClone(authorized.action),
      requestedRoleId: authorized.requestedRoleId,
      participantMode: source.participantMode,
      target,
    });
    const receipt = validateReplayCreationReceiptV1(rawReceipt);
    this.assertReceiptMatches(
      receipt,
      command,
      authorized.action.launchKind,
      target,
      authorized.action.href,
      true,
    );
    return structuredClone(receipt);
  }

  private async resolveTarget(
    targetExperience: "SAME_FROZEN_ROUTE" | "LATEST_REGISTERED_ROUTE" | null,
    source: ReturnType<typeof validateAuthoritativePressureResultSnapshotV1>,
  ): Promise<ReplayResolvedTargetV1 | null> {
    if (targetExperience === null) return null;
    if (targetExperience === "SAME_FROZEN_ROUTE") {
      if (!this.routeResolver.resolveSamePressureRoute) {
        failPressureResultRead(
          ERROR.REPLAY_TARGET_UNAVAILABLE,
          "replayTarget",
          "SAME_RESOLVER_NOT_BOUND",
        );
      }
      const resolved = await this.routeResolver.resolveSamePressureRoute(
        source.runId,
        source.participantMode,
        source.frozenRouteHash,
      );
      if (resolved === null) {
        failPressureResultRead(
          ERROR.REPLAY_TARGET_UNAVAILABLE,
          "replayTarget",
          "SAME_NOT_FOUND",
        );
      }
      return validateReplayResolvedTargetV1(resolved);
    }
    const resolved = await this.routeResolver.resolveLatestPressureRoute(
      source.runId,
      source.participantMode,
    );
    if (resolved === null) {
      failPressureResultRead(ERROR.REPLAY_TARGET_UNAVAILABLE, "replayTarget", "LATEST_NOT_FOUND");
    }
    return validateReplayResolvedTargetV1(resolved);
  }

  private assertReceiptMatches(
    receipt: ReplayCreationReceiptV1,
    command: PressureReplayCommandV1,
    launchKind: ReplayCreationReceiptV1["launchKind"],
    target: ReplayResolvedTargetV1 | null,
    navigationTarget: string | null,
    requireTargetCheck: boolean,
  ): void {
    if (
      receipt.sourceRunId !== command.sourceRunId ||
      receipt.actionId !== command.actionId ||
      receipt.launchKind !== launchKind
    ) {
      failPressureResultRead(ERROR.REPLAY_RECEIPT_INVALID, "replayReceipt", "COMMAND_MISMATCH");
    }
    if (launchKind === "NAVIGATE") {
      if (receipt.navigationTarget !== navigationTarget) {
        failPressureResultRead(
          ERROR.REPLAY_RECEIPT_INVALID,
          "replayReceipt.navigationTarget",
          "SERVER_ACTION_MISMATCH",
        );
      }
    } else if (
      requireTargetCheck &&
      receipt.frozenTargetRouteHash !== target?.targetDescriptorHash
    ) {
      failPressureResultRead(
        ERROR.REPLAY_RECEIPT_INVALID,
        "replayReceipt.frozenTargetRouteHash",
        "TARGET_ROUTE_MISMATCH",
      );
    }
  }
}

function required(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failPressureResultRead(ERROR.RESULT_ACCESS_DENIED, path, "NON_EMPTY_STRING");
  }
  return value;
}
