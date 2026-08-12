import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
} from "@ai-story/shared";
import {
  PRESSURE_RUN_SHELL_WRITE_CAPABILITY_V1,
  assertPressureRunShellCandidate,
  type PressureRunShellCandidateV1,
  type PressureRunShellWriterPort,
} from "../production/run-shell";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
} from "../persistence/transaction";
import { buildPressureRunLifecycleCreateData, pressurePlayerSlotId, pressureRoleSlotId } from "./lifecycle-state";
import type {
  PressureProductionPrismaClient,
  PressureProductionTransaction,
} from "./prisma-ports";
import {
  fingerprintMismatch,
  invalid,
  readPressureProductionSnapshot,
} from "./production-store";

/**
 * Creates only the relational Run shell and its independent lifecycle row.
 * StoryRun.stateJson starts as `{}` and is reserved for exact WorldStateV1
 * authority after Genesis; no legacy Chapter/Scene/World authority is exposed.
 */
export class PrismaPressureRunShellWriterAdapter
implements PressureRunShellWriterPort {
  readonly capability = PRESSURE_RUN_SHELL_WRITE_CAPABILITY_V1;

  constructor(private readonly prisma: PressureProductionPrismaClient) {}

  async createOnce(candidateValue: Readonly<PressureRunShellCandidateV1>) {
    const candidate = structuredClone(
      assertPressureRunShellCandidate(candidateValue as PressureRunShellCandidateV1),
    );
    try {
      return await pressureSerializableTransaction(this.prisma, (tx) =>
        createPressureRunShellInTransactionV1(tx, candidate),
      );
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      return pressureSerializableTransaction(this.prisma, async (tx) => {
        const concurrent = await readPressureProductionSnapshot(
          tx,
          candidate.room.runId,
        );
        if (!concurrent) throw error;
        return {
          status: "EXISTING" as const,
          shell: assertSameShell(concurrent.lifecycle.shell, candidate),
        };
      });
    }
  }
}

/**
 * Transaction-scoped shell writer used by Replay so the new target shell,
 * its persisted route intent, and the immutable replay receipt commit or roll
 * back together in one outer Serializable transaction.
 */
export async function createPressureRunShellInTransactionV1(
  tx: PressureProductionTransaction,
  candidateValue: Readonly<PressureRunShellCandidateV1>,
) {
  const candidate = structuredClone(
    assertPressureRunShellCandidate(
      candidateValue as PressureRunShellCandidateV1,
    ),
  );
  const existing = await readPressureProductionSnapshot(
    tx,
    candidate.room.runId,
  );
  if (existing) {
    return {
      status: "EXISTING" as const,
      shell: assertSameShell(existing.lifecycle.shell, candidate),
    };
  }

  await createStoryRun(tx, candidate);
  const roleCount = await tx.storyRole.createMany({
    data: candidate.roles.map((role) => ({
      id: pressureRoleSlotId(candidate.room.runId, role.roleKey),
      runId: candidate.room.runId,
      roleKey: role.roleKey,
      roleName: role.roleName,
      identity: role.identity,
      publicInfo: role.publicInfo,
      hiddenSecret: role.hiddenSecret,
      personalGoal: role.personalGoal,
      currentState: role.currentState,
      abilityText: role.abilityText,
      arcText: role.arcText,
      knownInfoJson: structuredClone(role.knownInfo),
      cannotDoJson: structuredClone(role.cannotDo),
      isAiControlled: role.isAiControlled,
      status: role.status,
    })),
  });
  if (roleCount.count !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    throw invalid("Pressure role shell did not create exactly six rows");
  }

  const playerCount = await tx.storyPlayer.createMany({
    data: candidate.players.map((player) => ({
      id: pressurePlayerSlotId(candidate.room.runId, player.seatId),
      runId: candidate.room.runId,
      userId: player.userId,
      roleId: pressureRoleSlotId(candidate.room.runId, player.roleKey),
      playerType: player.playerType,
      status: player.status,
    })),
  });
  if (playerCount.count !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    throw invalid("Pressure controller shell did not create exactly six rows");
  }

  await tx.pressureRunLifecycle.create({
    data: buildPressureRunLifecycleCreateData(candidate),
  });
  const readback = await readPressureProductionSnapshot(
    tx,
    candidate.room.runId,
  );
  if (!readback) throw invalid("Pressure Run shell vanished after creation");
  return {
    status: "CREATED" as const,
    shell: assertSameShell(readback.lifecycle.shell, candidate),
  };
}

async function createStoryRun(
  tx: PressureProductionTransaction,
  candidate: PressureRunShellCandidateV1,
): Promise<void> {
  await tx.storyRun.create({
    data: {
      id: candidate.room.runId,
      templateId: candidate.room.templateId,
      ownerUserId: candidate.room.ownerUserId,
      title: candidate.room.title,
      hook: "",
      mode: candidate.room.mode,
      templateKey: candidate.room.templateKey,
      status: candidate.room.status,
      currentDay: 1,
      totalDays: candidate.room.totalDays,
      maxPlayers: candidate.room.maxPlayers,
      activeHumanCount: candidate.room.activeHumanCount,
      aiPlayerCount: candidate.room.aiPlayerCount,
      stateJson: {},
      visibility: candidate.room.visibility,
      inviteCode: candidate.room.inviteCode,
      engineVersion: candidate.room.engineVersion,
      strategyVersion: candidate.room.strategyVersion,
      version: 1,
    },
  });
}

function assertSameShell(
  storedValue: PressureRunShellCandidateV1,
  candidate: PressureRunShellCandidateV1,
): PressureRunShellCandidateV1 {
  const stored = structuredClone(assertPressureRunShellCandidate(storedValue));
  if (
    stored.room.runId !== candidate.room.runId ||
    stored.idempotencyKey !== candidate.idempotencyKey ||
    stored.requestFingerprint !== candidate.requestFingerprint ||
    stored.shellHash !== candidate.shellHash ||
    sha256Canonical(stored) !== sha256Canonical(candidate)
  ) {
    throw fingerprintMismatch(
      "Pressure Run create replay does not match its immutable shell receipt",
      {
        runId: candidate.room.runId,
        storedShellHash: stored.shellHash,
        candidateShellHash: candidate.shellHash,
      },
    );
  }
  return stored;
}
