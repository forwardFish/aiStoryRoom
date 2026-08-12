import { randomBytes, randomUUID } from "node:crypto";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  ReplayNewTargetFactoryPortV1,
  ReplayReceiptTransactionV1,
} from "../persistence";
import {
  PRESSURE_RUN_SHELL_WRITE_CAPABILITY_V1,
  PressureRunShellService,
  SangtianPressureCanonicalRoleCatalogAdapter,
  type PressureCanonicalRoleCatalogPort,
  type PressureRunShellWriterPort,
} from "../production/run-shell";
import {
  createPressureRunShellInTransactionV1,
} from "../production-prisma/run-shell.prisma-adapter";
import type { PressureProductionTransaction } from "../production-prisma/prisma-ports";
import { readPressureProductionSnapshot } from "../production-prisma/production-store";
import {
  validateReplayResolvedTargetV1,
  type ReplayCreationRequestV1,
} from "../replay";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";

export type PressureReplayTargetTransactionV1 =
  ReplayReceiptTransactionV1 & PressureProductionTransaction;

export interface PressureReplayServerIdentityGeneratorV1 {
  nextTargetRunId(kind: "RUN" | "LOBBY"): string;
  nextInviteCode(): string;
  nextHumanControllerId(runId: string, userId: string): string;
}

export interface PressureReplayNewTargetFactoryOptionsV1 {
  identities?: PressureReplayServerIdentityGeneratorV1;
  roleCatalog?: PressureCanonicalRoleCatalogPort;
}

/**
 * Creates only a new Pressure shell/lobby. Source authority is read-only, and
 * the tx-scoped writer makes shell + embedded replay intent + receipt atomic.
 */
export class PrismaPressureReplayNewTargetFactoryV1
implements ReplayNewTargetFactoryPortV1<ReplayReceiptTransactionV1> {
  private readonly identities: PressureReplayServerIdentityGeneratorV1;
  private readonly roleCatalog: PressureCanonicalRoleCatalogPort;

  constructor(options: PressureReplayNewTargetFactoryOptionsV1 = {}) {
    this.identities = options.identities ?? new CryptoPressureReplayIdentityGeneratorV1();
    this.roleCatalog = options.roleCatalog ?? new SangtianPressureCanonicalRoleCatalogAdapter();
  }

  async createRun(
    txValue: ReplayReceiptTransactionV1,
    request: Readonly<ReplayCreationRequestV1>,
  ): Promise<{ createdRunId: string }> {
    if (
      request.action.launchKind !== "CREATE_RUN" ||
      request.participantMode !== "SOLO"
    ) throw invalid("Replay createRun received a non-Solo action");
    const tx = requireTargetTransaction(txValue);
    const context = await this.resolveContext(tx, request);
    const runId = required(
      this.identities.nextTargetRunId("RUN"),
      "identities.nextTargetRunId",
    );
    const humanControllerId = required(
      this.identities.nextHumanControllerId(runId, request.viewerId),
      "identities.nextHumanControllerId",
    );
    const shell = await this.shellService(tx).create({
      runId,
      templateId: context.source.run.templateId,
      ownerUserId: request.viewerId,
      title: context.source.run.title,
      inviteCode: required(this.identities.nextInviteCode(), "identities.nextInviteCode"),
      visibility: normalizeVisibility(context.source.run.visibility),
      participantMode: "SOLO",
      humanAssignments: [{
        seatId: context.targetSeatId,
        userId: request.viewerId,
        humanControllerId,
      }],
      idempotencyKey: targetShellIdempotencyKey(request),
      replayTargetIntent: context.target,
    });
    if (shell.shell.room.activeHumanCount !== 1 || shell.shell.room.aiPlayerCount !== 5) {
      throw invalid("Solo replay target is not the required 1 human + 5 AI shell");
    }
    return { createdRunId: shell.shell.room.runId };
  }

  async createLobby(
    txValue: ReplayReceiptTransactionV1,
    request: Readonly<ReplayCreationRequestV1>,
  ): Promise<{ createdLobbyId: string }> {
    if (
      request.action.launchKind !== "CREATE_LOBBY" ||
      request.participantMode !== "MULTIPLAYER"
    ) throw invalid("Replay createLobby received a non-Multiplayer action");
    const tx = requireTargetTransaction(txValue);
    const context = await this.resolveContext(tx, request);
    const runId = required(
      this.identities.nextTargetRunId("LOBBY"),
      "identities.nextTargetRunId",
    );
    const preselected = request.action.type === "CHANGE_ROLE"
      ? [{
          seatId: context.targetSeatId,
          userId: request.viewerId,
          humanControllerId: required(
            this.identities.nextHumanControllerId(runId, request.viewerId),
            "identities.nextHumanControllerId",
          ),
        }]
      : [];
    const shell = await this.shellService(tx).createLobbyDraft({
      runId,
      templateId: context.source.run.templateId,
      ownerUserId: request.viewerId,
      title: context.source.run.title,
      inviteCode: required(this.identities.nextInviteCode(), "identities.nextInviteCode"),
      visibility: "link",
      participantMode: "MULTIPLAYER",
      humanAssignments: preselected,
      idempotencyKey: targetShellIdempotencyKey(request),
      replayTargetIntent: context.target,
    });
    if (
      shell.shell.lifecycle.start.phase !== "NOT_STARTED" ||
      shell.shell.lifecycle.routeFreeze !== "UNFROZEN" ||
      shell.shell.lifecycle.lobby.readyUserIds.length !== 0
    ) throw invalid("Multiplayer replay must create only a reconfirmation lobby");
    return { createdLobbyId: shell.shell.room.runId };
  }

  private shellService(tx: PressureProductionTransaction): PressureRunShellService {
    const writer: PressureRunShellWriterPort = {
      capability: PRESSURE_RUN_SHELL_WRITE_CAPABILITY_V1,
      createOnce: (candidate) =>
        createPressureRunShellInTransactionV1(tx, candidate),
    };
    return new PressureRunShellService(this.roleCatalog, writer);
  }

  private async resolveContext(
    tx: PressureProductionTransaction,
    request: Readonly<ReplayCreationRequestV1>,
  ) {
    if (!request.target) throw invalid("Replay target intent is missing");
    const target = validateReplayResolvedTargetV1(request.target);
    if (
      target.sourceRunId !== request.sourceRunId ||
      target.participantMode !== request.participantMode ||
      target.targetExperience !== request.action.targetExperience
    ) throw invalid("Replay target intent is not bound to the command");
    const source = await readPressureProductionSnapshot(tx, request.sourceRunId);
    if (!source) throw invalid("Replay source Run shell does not exist");
    if (source.lifecycle.state.participantMode !== request.participantMode) {
      throw invalid("Replay source participantMode mismatch");
    }
    const sourceSeat = PRESSURE_CHAPTER_SEAT_IDS_V1.find(
      (seatId) => source.players.get(seatId)?.userId === request.viewerId,
    );
    if (!sourceSeat) throw invalid("Replay viewer is not a human source seat");

    let targetSeatId: SeatIdV1 = sourceSeat;
    if (request.action.type === "CHANGE_ROLE") {
      if (!request.requestedRoleId || request.requestedRoleId === sourceSeat) {
        throw invalid("CHANGE_ROLE requires a different canonical seat");
      }
      targetSeatId = request.requestedRoleId;
    } else if (request.requestedRoleId !== null) {
      throw invalid("Only CHANGE_ROLE may carry requestedRoleId");
    }
    return { source, target, sourceSeat, targetSeatId };
  }
}

export class CryptoPressureReplayIdentityGeneratorV1
implements PressureReplayServerIdentityGeneratorV1 {
  nextTargetRunId(kind: "RUN" | "LOBBY"): string {
    return `pressure-replay-${kind.toLowerCase()}-${randomUUID()}`;
  }

  nextInviteCode(): string {
    return randomBytes(18).toString("base64url");
  }

  nextHumanControllerId(runId: string, userId: string): string {
    return `pressure-human:${sha256Canonical({
      schemaVersion: "pressure_replay_human_controller_v1",
      runId,
      userId,
      nonce: randomUUID(),
    }).slice(0, 32)}`;
  }
}

function targetShellIdempotencyKey(request: ReplayCreationRequestV1): string {
  return `pressure-replay-target:${sha256Canonical({
    schemaVersion: "pressure_replay_target_shell_idempotency_v1",
    sourceRunId: request.sourceRunId,
    idempotencyKey: request.idempotencyKey,
    requestFingerprint: request.requestFingerprint,
    targetDescriptorHash: request.target?.targetDescriptorHash ?? null,
  })}`;
}

function requireTargetTransaction(
  value: ReplayReceiptTransactionV1,
): PressureReplayTargetTransactionV1 {
  const tx = value as unknown as Record<string, unknown>;
  for (const delegate of [
    "pressureReplayCommandReceipt",
    "storyRun",
    "storyRole",
    "storyPlayer",
    "pressureRunLifecycle",
  ]) {
    if (!tx[delegate] || typeof tx[delegate] !== "object") {
      throw invalid(`Replay transaction is missing ${delegate}`);
    }
  }
  return value as PressureReplayTargetTransactionV1;
}

function normalizeVisibility(value: string): "link" | "public" {
  return value === "public" ? "public" : "link";
}

function required(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(`Server identity generator returned no ${path}`);
  }
  return value.trim();
}

function invalid(message: string): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message);
}
