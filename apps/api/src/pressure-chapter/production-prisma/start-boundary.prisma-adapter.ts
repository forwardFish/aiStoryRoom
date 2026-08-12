import { randomBytes } from "node:crypto";
import { sha256Canonical } from "@ai-story/shared";
import {
  assertPressureStartBoundaryRequest,
  buildFrozenHumanSeatSet,
  buildPressureEffectiveStartMaterial,
  type FrozenPressureHumanSeatSetV1,
  type PressureStartBoundaryRequestV1,
  type PressureStartBoundaryPortV1,
  type PressureStartCompletedStageV1,
  type PressureStartCompletionV1,
  type PressureStartFailureV1,
} from "../production/start-lifecycle";
import { pressureSerializableTransaction } from "../persistence/transaction";
import {
  assertHashRecord,
  withPressureRunLifecycleState,
} from "./lifecycle-state";
import type { PressureProductionPrismaClient } from "./prisma-ports";
import {
  assertLobbyMutable,
  casPressureLifecycle,
  casPressureStoryRun,
  fence,
  fingerprintMismatch,
  invalid,
  missing,
  readPressureProductionSnapshot,
  type PressureProductionSnapshotV1,
} from "./production-store";

const ALL_START_STAGES: PressureStartCompletedStageV1[] = [
  "HUMAN_SEATS_FROZEN",
  "ROUTE_FROZEN",
  "GENESIS_COMMITTED",
  "SEAT_CONTROL_INITIALIZED",
  "N1_OPENED",
];

export class PrismaPressureStartBoundaryAdapter
implements PressureStartBoundaryPortV1 {
  constructor(
    private readonly prisma: PressureProductionPrismaClient,
    private readonly generateStartMaterial: PressureStartMaterialGeneratorV1 =
      generatePressureStartMaterial,
  ) {}

  async finalizeHumanSeatSet(requestValue: Readonly<PressureStartBoundaryRequestV1>) {
    const request = structuredClone(
      assertPressureStartBoundaryRequest(
        requestValue as PressureStartBoundaryRequestV1,
      ),
    );
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const snapshot = await requireSnapshot(tx, request.runId);
      if (request.requestedByUserId !== snapshot.run.ownerUserId) {
        throw fence("Only the Pressure Run owner may finalize the human roster", {
          runId: request.runId,
          requestedByUserId: request.requestedByUserId,
        });
      }
      const existing = snapshot.lifecycle.state.start.frozenHumanSeatSet;
      if (existing) {
        assertSameFrozen(existing, request);
        if (snapshot.lifecycle.state.start.phase === "FAILED") {
          const start = {
            ...structuredClone(snapshot.lifecycle.state.start),
            phase: "STARTING" as const,
            completedStages: ["HUMAN_SEATS_FROZEN"] as PressureStartCompletedStageV1[],
            completion: null,
            routeHash: null,
            genesisHash: null,
            seatControlStateHash: null,
            n1ChapterHash: null,
            lastFailure: null,
          };
          const next = withPressureRunLifecycleState(snapshot.lifecycle, {
            ...snapshot.lifecycle.state,
            lifecycle: "STARTING",
            routeFreeze: "START_BOUNDARY_FROZEN",
            start,
          });
          await casPressureLifecycle(tx, snapshot.lifecycle, next.data);
          await casPressureStoryRun(tx, snapshot.run, { status: "starting" });
        }
        return { status: "EXISTING" as const, frozen: structuredClone(existing) };
      }

      assertLobbyMutable(snapshot);
      assertFinalRoster(snapshot, request);
      const replayTargetIntent =
        snapshot.lifecycle.state.lobby.replayTargetIntent;
      if (
        replayTargetIntent &&
        request.routeKey !== null &&
        request.routeKey !==
          replayTargetIntent.pinnedRegistration.registration.routeKey
      ) {
        throw fingerprintMismatch(
          "Replay start routeKey differs from the frozen target intent",
          { runId: request.runId },
        );
      }
      const generated = this.generateStartMaterial(request.runId);
      const effectiveStart = buildPressureEffectiveStartMaterial({
        startRequestFingerprint: request.requestFingerprint,
        idempotencyKey: generated.idempotencyKey,
        runSeed: generated.runSeed,
      });
      const frozen = buildFrozenHumanSeatSet(
        request,
        effectiveStart,
        replayTargetIntent,
      );
      const start = {
        ...structuredClone(snapshot.lifecycle.state.start),
        phase: "STARTING" as const,
        completedStages: ["HUMAN_SEATS_FROZEN"] as PressureStartCompletedStageV1[],
        frozenHumanSeatSet: structuredClone(frozen),
        completion: null,
        routeHash: null,
        genesisHash: null,
        seatControlStateHash: null,
        n1ChapterHash: null,
        lastFailure: null,
      };
      const next = withPressureRunLifecycleState(snapshot.lifecycle, {
        ...snapshot.lifecycle.state,
        lifecycle: "STARTING",
        routeFreeze: "START_BOUNDARY_FROZEN",
        start,
      }, {
        startRequestFingerprint: frozen.startRequestFingerprint,
        startIdempotencyKey: frozen.effectiveStart.idempotencyKey,
        startRunSeed: frozen.effectiveStart.runSeed,
        startMaterialHash: frozen.effectiveStart.materialHash,
      });
      await casPressureLifecycle(tx, snapshot.lifecycle, next.data);
      await casPressureStoryRun(tx, snapshot.run, {
        status: "starting",
        activeHumanCount: frozen.humanAssignments.length,
        aiPlayerCount: 6 - frozen.humanAssignments.length,
      });
      return { status: "FROZEN" as const, frozen: structuredClone(frozen) };
    });
  }

  async markStarted(completionValue: Readonly<PressureStartCompletionV1>) {
    const completion = structuredClone(completionValue) as PressureStartCompletionV1;
    assertHashRecord(
      completion,
      "pressure_start_completion_v1",
      "completionHash",
    );
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const snapshot = await requireSnapshot(tx, completion.runId);
      const start = snapshot.lifecycle.state.start;
      if (start.completion) {
        if (!sameCompletionAuthority(start.completion, completion)) {
          throw fingerprintMismatch(
            "Pressure Run is already started with another completion",
            { runId: completion.runId },
          );
        }
        return {
          status: "EXISTING" as const,
          completion: structuredClone(start.completion),
        };
      }
      if (
        !start.frozenHumanSeatSet ||
        start.frozenHumanSeatSet.requestFingerprint !== completion.requestFingerprint
      ) {
        throw fingerprintMismatch(
          "Pressure start completion does not match the frozen human roster",
          { runId: completion.runId },
        );
      }
      const nextStart = {
        ...structuredClone(start),
        phase: "STARTED" as const,
        completedStages: [...ALL_START_STAGES],
        completion: structuredClone(completion),
        routeHash: completion.routeHash,
        genesisHash: completion.genesisHash,
        seatControlStateHash: completion.seatControlStateHash,
        n1ChapterHash: completion.chapterOrchestratorHash,
        lastFailure: null,
      };
      const next = withPressureRunLifecycleState(snapshot.lifecycle, {
        ...snapshot.lifecycle.state,
        lifecycle: "PLAYING",
        routeFreeze: "START_BOUNDARY_FROZEN",
        start: nextStart,
      });
      await casPressureLifecycle(tx, snapshot.lifecycle, next.data);
      await casPressureStoryRun(tx, snapshot.run, { status: "playing" });
      return { status: "STARTED" as const, completion: structuredClone(completion) };
    });
  }

  async recordFailure(failureValue: Readonly<PressureStartFailureV1>): Promise<void> {
    const failure = structuredClone(failureValue) as PressureStartFailureV1;
    assertHashRecord(failure, "pressure_start_failure_v1", "failureHash");
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      const snapshot = await requireSnapshot(tx, failure.runId);
      const start = snapshot.lifecycle.state.start;
      if (start.completion) {
        throw fence("A completed Pressure start cannot be downgraded to FAILED", {
          runId: failure.runId,
        });
      }
      if (start.lastFailure?.failureHash === failure.failureHash) return;
      if (
        start.frozenHumanSeatSet &&
        start.frozenHumanSeatSet.requestFingerprint !== failure.requestFingerprint
      ) {
        throw fingerprintMismatch(
          "Pressure start failure does not match the frozen request",
          { runId: failure.runId },
        );
      }
      if (
        !start.frozenHumanSeatSet &&
        failure.completedStages.includes("HUMAN_SEATS_FROZEN")
      ) {
        throw invalid("Start failure claims a missing frozen human roster", {
          runId: failure.runId,
        });
      }
      const nextStart = {
        ...structuredClone(start),
        phase: "FAILED" as const,
        completedStages: [...failure.completedStages],
        completion: null,
        lastFailure: structuredClone(failure),
      };
      const next = withPressureRunLifecycleState(snapshot.lifecycle, {
        ...snapshot.lifecycle.state,
        lifecycle: "FAILED",
        start: nextStart,
      });
      await casPressureLifecycle(tx, snapshot.lifecycle, next.data);
      await casPressureStoryRun(tx, snapshot.run, { status: "start_failed" });
    });
  }
}

function assertFinalRoster(
  snapshot: PressureProductionSnapshotV1,
  candidate: Pick<
    PressureStartBoundaryRequestV1,
    "runId" | "participantMode" | "humanAssignments"
  >,
): void {
  const state = snapshot.lifecycle.state;
  if (state.participantMode !== candidate.participantMode) {
    throw fingerprintMismatch("Start participantMode differs from the Run shell", {
      runId: candidate.runId,
    });
  }
  const selected = state.lobby.selectedSeats;
  if (selected.length !== candidate.humanAssignments.length) {
    throw fence("Start roster omits or adds a human controller slot", {
      runId: candidate.runId,
    });
  }
  const joined = new Set(state.lobby.joinedUserIds);
  const ready = new Set(state.lobby.readyUserIds);
  const selectedBySeat = new Map(selected.map((entry) => [entry.seatId, entry]));
  for (const assignment of candidate.humanAssignments) {
    const current = selectedBySeat.get(assignment.seatId);
    if (
      !joined.has(assignment.userId) ||
      !ready.has(assignment.userId) ||
      !current ||
      current.userId !== assignment.userId ||
      current.humanControllerId !== assignment.humanControllerId
    ) {
      throw fence("Start roster is not the joined, ready canonical lobby roster", {
        runId: candidate.runId,
        seatId: assignment.seatId,
      });
    }
  }
  const persistedAssignments = selected.map((entry) => ({
    seatId: entry.seatId,
    userId: entry.userId,
    humanControllerId: entry.humanControllerId,
  }));
  if (
    sha256Canonical(persistedAssignments) !==
    sha256Canonical(candidate.humanAssignments)
  ) {
    throw fingerprintMismatch("Start roster canonical order differs from the lobby", {
      runId: candidate.runId,
    });
  }
}

function assertSameFrozen(
  stored: FrozenPressureHumanSeatSetV1,
  request: PressureStartBoundaryRequestV1,
): void {
  if (
    stored.runId !== request.runId ||
    stored.startRequestFingerprint !== request.requestFingerprint
  ) {
    throw fingerprintMismatch(
      "Pressure human roster was already frozen by another start request",
      { runId: request.runId },
    );
  }
}

export interface PressureStartMaterialGeneratorV1 {
  (runId: string): { idempotencyKey: string; runSeed: string };
}

function generatePressureStartMaterial(_runId: string) {
  return {
    idempotencyKey: `pressure-start:${randomBytes(24).toString("hex")}`,
    runSeed: randomBytes(32).toString("hex"),
  } satisfies ReturnType<PressureStartMaterialGeneratorV1>;
}

function sameCompletionAuthority(
  stored: PressureStartCompletionV1,
  candidate: PressureStartCompletionV1,
): boolean {
  return (
    stored.runId === candidate.runId &&
    stored.requestFingerprint === candidate.requestFingerprint &&
    stored.routeHash === candidate.routeHash &&
    stored.genesisHash === candidate.genesisHash &&
    stored.seatControlStateHash === candidate.seatControlStateHash &&
    stored.chapterOrchestratorHash === candidate.chapterOrchestratorHash
  );
}

async function requireSnapshot(
  tx: Parameters<typeof readPressureProductionSnapshot>[0],
  runId: string,
): Promise<PressureProductionSnapshotV1> {
  const snapshot = await readPressureProductionSnapshot(tx, runId);
  if (!snapshot) throw missing(runId);
  return snapshot;
}
