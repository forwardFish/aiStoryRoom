import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  chapterSequence,
  sha256Canonical,
  validateWorldStateV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { validateAtomicChapterCommitRecordV1 } from "../chapter-settlement";
import { validateCommittedGenesis } from "../genesis";
import type {
  PressureChatMessageV1,
  PressureChatPort,
  PressureFormalActionAccessContextV1,
  PressureInteractionAccessPort,
  PressureInteractionAccessV1,
  PressureSystemDefaultAccessContextV1,
} from "../interaction/contracts";
import type { SeatControlSnapshotV1, SeatDefaultDirectiveV1 } from "../seat-control/types";
import { decodeSeatEnvelope } from "../seat-control-persistence/envelope";
import {
  createSangtianAEmotionContentSourceCompilerV1,
  type SangtianAEmotionContentSourceCompilerV1,
} from "../a-emotion-production/content-source";
import {
  compileCommittedInvestigationLifecycleEmissionsV1,
} from "../a-emotion-production/investigation-lifecycle.prisma-bridge";
import type {
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
} from "../narrative-authority/contracts";
import {
  buildAuthorityDownstreamManifestV1,
  downstreamDedupeKeysV1,
  insertAEmotionAuthorityEmissionsV1,
  insertNarrativeProjectionPlanV1,
  planInteractiveNarrativeAudiencesV1,
  planNarrativeProjectionJobsV1,
} from "../projection-plan";
import type {
  WorkingLedgerAppendResultV1,
  WorkingLedgerEventV1,
  WorkingLedgerKeyV1,
  WorkingLedgerPort,
} from "../working-ledger/contracts";
import { projectWorkingLedger } from "../working-ledger/working-ledger";
import { withWorkingLedgerProjectionCacheHashV1 } from "../working-ledger/projection-cache";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";
import {
  buildPressureMvpDecisionStateV1,
  decodePressureMvpDecisionStateV1,
} from "./mvp-decision-state";

const LEDGER_EVENT_TYPE = "PRESSURE_WORKING_LEDGER_EVENT";
const CHAT_EVENT_PREFIX = "PRESSURE_CHAT";

interface StoryEventRow {
  id: string;
  runId: string;
  type: string;
  payloadJson: unknown;
  dedupeKey: string | null;
  createdAt?: Date;
}

interface ChapterRuntimeRow {
  id: string;
  runId: string;
  chapterId: string;
  routeHash: string;
  workingRevision: number;
  workingStateJson: unknown;
  workingStateHash: string;
  lockVersion: number;
  decisionStateJson?: unknown;
  ledgerProjectionJson?: unknown;
}

interface RuntimeRouteRow {
  runId: string;
  routeHash: string;
  contentPackageVersion: string;
  contentPackageSha256: string;
  orchestrationPackageVersion: string;
  orchestrationPackageSha256: string;
  runtimeContractVersion: string;
  runtimeContractSha256: string;
  humanSeatIdsAtStartJson: unknown;
}

interface RuntimeWorldRow {
  id: string;
  worldSequence: number;
  stateJson: unknown;
}

interface WorkingLedgerTransaction {
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<StoryEventRow[]>;
    findUnique(input: Record<string, unknown>): Promise<StoryEventRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<StoryEventRow>;
  };
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<ChapterRuntimeRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<ChapterRuntimeRow>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  pressureDecisionAction: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  pressureNarrativeProjection: {
    create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
    createMany?(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
  pressureOutboxTask: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
    createMany?(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
  pressureRunRouteSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<RuntimeRouteRow | null>;
  };
  pressureGenesisCommit: {
    findUnique(input: Record<string, unknown>): Promise<{
      runId: string;
      commitManifestJson: unknown;
    } | null>;
  };
  pressureChapterSettlement: {
    findUnique(input: Record<string, unknown>): Promise<{
      runId: string;
      commitManifestJson: unknown;
    } | null>;
  };
  storyRun: {
    findUnique(input: Record<string, unknown>): Promise<RuntimeWorldRow | null>;
  };
}

export type WorkingLedgerPrismaClient =
  PressureSerializableClient<WorkingLedgerTransaction>;

/**
 * Lossless W5 event persistence. OPEN/ACTION only advance the ledger lock;
 * BEAT is the sole event that CAS-advances workingRevision. This capability
 * intentionally has no StoryRun delegate, so it cannot advance worldSequence.
 */
export class PrismaWorkingLedgerRepository implements WorkingLedgerPort {
  constructor(
    private readonly prisma: WorkingLedgerPrismaClient,
    private readonly narrativeCompiler?: ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
    private readonly aEmotionCompiler?: Pick<
      SangtianAEmotionContentSourceCompilerV1,
      "compileBeat"
    > & Partial<Pick<
      SangtianAEmotionContentSourceCompilerV1,
      "compileFormalCommitment"
    >>,
  ) {}

  async read(key: WorkingLedgerKeyV1): Promise<WorkingLedgerEventV1[]> {
    return pressureSerializableTransaction(this.prisma, async (tx) =>
      readLedgerEvents(tx, key));
  }

  async append(input: {
    key: WorkingLedgerKeyV1;
    expectedHeadHash: string | null;
    events: WorkingLedgerEventV1[];
  }): Promise<WorkingLedgerAppendResultV1> {
    if (!input.events.length) {
      return { status: "APPENDED", events: [] };
    }
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        let runtime = await tx.pressureChapterRuntime.findUnique({
          where: { id: input.key.chapterRuntimeId },
          select: {
            id: true,
            runId: true,
            chapterId: true,
            routeHash: true,
            workingRevision: true,
            workingStateJson: true,
            workingStateHash: true,
            lockVersion: true,
            decisionStateJson: true,
            ledgerProjectionJson: true,
          },
        });
        if (!runtime) {
          runtime = await createChapterRuntimeForOpening(tx, input);
        }
        if (!runtime || runtime.runId !== input.key.runId) {
          throw missing("Chapter runtime", input.key);
        }
        const current = await readLedgerEvents(tx, input.key);
        const currentHead = current.at(-1)?.eventHash ?? null;
        if (currentHead !== input.expectedHeadHash) {
          return { status: "HEAD_MISMATCH" as const, events: current };
        }
        assertAppendChain(input.key, runtime, current, input.events);
        const committedLedger = [...current, ...input.events];
        const projected = projectWorkingLedger(committedLedger);
        const beatEvents = input.events.filter(
          (event) => event.payload.eventType === "BEAT_APPLIED",
        );
        if (beatEvents.length > 1) {
          throw invalid("One append may contain at most one BEAT_APPLIED event");
        }
        let beatDownstreamManifest: unknown = null;
        for (const event of input.events) {
          if (event.payload.eventType === "FORMAL_ACTION_ACCEPTED") {
            await persistFormalAction(tx, event);
          } else if (event.payload.eventType === "BEAT_APPLIED") {
            beatDownstreamManifest = await persistBeat(
              tx,
              event,
              committedLedger,
              this.narrativeCompiler,
              this.aEmotionCompiler,
            );
          } else if (event.payload.eventType === "FORMAL_COMMITMENT_APPLIED") {
            const compiler = this.aEmotionCompiler
              ?? createSangtianAEmotionContentSourceCompilerV1();
            const emissions = compiler.compileFormalCommitment
              ? compiler.compileFormalCommitment({
                sourceKind: "FORMAL_COMMITMENT_COMMITTED",
                roomId: event.runId,
                committedAt: new Date().toISOString(),
                commitmentEventHash: event.eventHash,
                ledgerEvents: committedLedger,
              })
              : [];
            await insertAEmotionAuthorityEmissionsV1(
              tx,
              "CHAPTER_WORKING",
              emissions,
            );
          }
          await persistLedgerEvent(tx, event);
        }

        const beat = beatEvents[0];
        const runtimeData: Record<string, unknown> = {
          lockVersion: { increment: 1 },
          decisionStateJson: json(decisionState(
            projected,
            beat ? [] : preservedRequiredSeats(
              runtime.decisionStateJson,
              projected.nextDecisionPin?.decisionPointId ?? null,
            ),
          )),
          ledgerProjectionJson: json(serializeLedgerProjection(
            projected,
            beatDownstreamManifest,
          )),
        };
        const runtimeWhere: Record<string, unknown> = {
          id: runtime.id,
          runId: runtime.runId,
          lockVersion: runtime.lockVersion,
        };
        if (beat?.payload.eventType === "BEAT_APPLIED") {
          runtimeWhere.workingRevision = beat.payload.beatResolution.baseWorkingRevision;
          runtimeWhere.workingStateHash = beat.payload.beatResolution.inputWorkingStateHash;
          runtimeData.workingRevision = beat.payload.beatResolution.committedWorkingRevision;
          runtimeData.workingStateJson = json(beat.payload.stateAfter);
          runtimeData.workingStateHash = beat.payload.stateAfterHash;
          runtimeData.state = "BEAT_RESOLVED";
        }
        const locked = await tx.pressureChapterRuntime.updateMany({
          where: runtimeWhere,
          data: runtimeData,
        });
        if (locked.count !== 1) {
          throw new LedgerHeadRace();
        }
        return {
          status: "APPENDED" as const,
          events: structuredClone(input.events),
        };
      });
    } catch (error) {
      if (!(error instanceof LedgerHeadRace) && !isUniqueConflict(error)) {
        throw error;
      }
      if (process.env.PRESSURE_CHAPTER_DIAGNOSTIC_ERRORS === "1") {
        console.error("Pressure working ledger append conflict", {
          kind: error instanceof LedgerHeadRace ? "LOCK_VERSION_RACE" : "UNIQUE_CONFLICT",
          code: error && typeof error === "object" && "code" in error
            ? String(error.code)
            : null,
          target: error && typeof error === "object" && "meta" in error
            ? JSON.stringify(error.meta).slice(0, 500)
            : null,
          runId: input.key.runId,
          chapterRuntimeId: input.key.chapterRuntimeId,
        });
      }
      const current = await this.read(input.key);
      return { status: "HEAD_MISMATCH", events: current };
    }
  }
}

async function createChapterRuntimeForOpening(
  tx: WorkingLedgerTransaction,
  input: {
    key: WorkingLedgerKeyV1;
    expectedHeadHash: string | null;
    events: WorkingLedgerEventV1[];
  },
): Promise<ChapterRuntimeRow | null> {
  const opening = input.events.length === 1 ? input.events[0] : null;
  if (
    input.expectedHeadHash !== null
    || !opening
    || opening.sequence !== 0
    || opening.previousEventHash !== null
    || opening.payload.eventType !== "WORKING_LEDGER_OPENED"
    || opening.runId !== input.key.runId
    || opening.chapterRuntimeId !== input.key.chapterRuntimeId
  ) return null;

  const sequence = chapterSequence(opening.chapterId);
  const [route, run, lineage] = await Promise.all([
    tx.pressureRunRouteSnapshot.findUnique({
      where: { runId: opening.runId },
      select: {
        runId: true,
        routeHash: true,
        contentPackageVersion: true,
        contentPackageSha256: true,
        orchestrationPackageVersion: true,
        orchestrationPackageSha256: true,
        runtimeContractVersion: true,
        runtimeContractSha256: true,
        humanSeatIdsAtStartJson: true,
      },
    }),
    tx.storyRun.findUnique({
      where: { id: opening.runId },
      select: { id: true, worldSequence: true, stateJson: true },
    }),
    sequence === 1
      ? tx.pressureGenesisCommit.findUnique({
          where: { runId: opening.runId },
          select: { runId: true, commitManifestJson: true },
        })
      : tx.pressureChapterSettlement.findUnique({
          where: {
            runId_committedWorldSequence: {
              runId: opening.runId,
              committedWorldSequence: sequence - 1,
            },
          },
          select: { runId: true, commitManifestJson: true },
        }),
  ]);
  if (
    !route
    || !run
    || !lineage
    || route.routeHash !== opening.payload.routeHash
    || run.worldSequence !== sequence - 1
  ) {
    throw new PressurePersistenceError(
      ERROR.AUTHORITY_FENCE_MISMATCH,
      "Chapter opening authority lineage is incomplete or stale",
      { runId: opening.runId, chapterId: opening.chapterId },
    );
  }
  const baseWorld = validateWorldStateV1(run.stateJson);
  const decodedLineage = decodeLineage(lineage, sequence);
  if (
    baseWorld.worldSequence !== sequence - 1
    || baseWorld.stateHash !== decodedLineage.worldStateHash
    || opening.payload.initialState.revision !== 0
    || opening.payload.initialStateHash !== sha256Canonical(opening.payload.initialState)
  ) {
    throw new PressurePersistenceError(
      ERROR.AUTHORITY_FENCE_MISMATCH,
      "Chapter opening world or WorkingSeed is not bound to frozen authority",
      { runId: opening.runId, chapterId: opening.chapterId },
    );
  }
  return tx.pressureChapterRuntime.create({
    data: {
      id: opening.chapterRuntimeId,
      runId: opening.runId,
      chapterId: opening.chapterId,
      chapterSequence: sequence,
      state: "CHAPTER_ACTIVE",
      baseWorldSequence: run.worldSequence,
      baseWorldStateHash: baseWorld.stateHash,
      previousFrozenHash: decodedLineage.frozenHash,
      routeHash: route.routeHash,
      contentPackageVersion: route.contentPackageVersion,
      contentHash: route.contentPackageSha256,
      orchestrationPackageVersion: route.orchestrationPackageVersion,
      orchestrationHash: route.orchestrationPackageSha256,
      runtimeContractVersion: route.runtimeContractVersion,
      runtimeContractHash: route.runtimeContractSha256,
      workingRevision: 0,
      workingStateJson: json(opening.payload.initialState),
      workingStateHash: opening.payload.initialStateHash,
      decisionStateJson: json(decisionStateFromPin(opening.payload.nextDecisionPin)),
      ledgerProjectionJson: json(serializeLedgerProjection(projectWorkingLedger(input.events))),
      lockVersion: 0,
    },
  });
}

export class PrismaPressureChatRepository implements PressureChatPort {
  constructor(private readonly prisma: WorkingLedgerPrismaClient) {}

  async findByIdempotencyKey(input: {
    runId: string;
    chapterRuntimeId: string;
    idempotencyKey: string;
  }): Promise<PressureChatMessageV1 | null> {
    const key = chatDedupeKey(input);
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.storyEvent.findUnique({
        where: { dedupeKey: key },
        select: eventSelect(),
      });
      return row ? decodeChat(row) : null;
    });
  }

  async appendIfAbsent(message: PressureChatMessageV1): Promise<{
    status: "APPENDED" | "EXISTING";
    message: PressureChatMessageV1;
  }> {
    const dedupeKey = chatDedupeKey(message);
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        const prior = await tx.storyEvent.findUnique({
          where: { dedupeKey },
          select: eventSelect(),
        });
        if (prior) {
          return {
            status: "EXISTING" as const,
            message: assertSameChat(decodeChat(prior), message),
          };
        }
        const runtime = await tx.pressureChapterRuntime.findUnique({
          where: { id: message.chapterRuntimeId },
          select: {
            id: true,
            runId: true,
            chapterId: true,
            routeHash: true,
            workingRevision: true,
            workingStateJson: true,
            workingStateHash: true,
            lockVersion: true,
          },
        });
        if (
          !runtime || runtime.runId !== message.runId
          || runtime.chapterId !== message.chapterId
        ) throw missing("Chat chapter runtime", message);
        const row = await tx.storyEvent.create({
          data: {
            id: message.messageId,
            runId: message.runId,
            day: chapterNumber(message.chapterId),
            type: chatEventType(message.chapterRuntimeId),
            messageType: "chat",
            roleKey: message.senderSeatId,
            visibility: "pressure_audience",
            audienceType: message.visibility,
            audienceRoleIdsJson: json(message.audienceSeatIds),
            payloadJson: json(message),
            sequence: null,
            dedupeKey,
          },
        });
        return { status: "APPENDED" as const, message: decodeChat(row) };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.findByIdempotencyKey(message);
      if (!existing) throw error;
      return { status: "EXISTING", message: assertSameChat(existing, message) };
    }
  }

  async list(input: {
    runId: string;
    chapterRuntimeId: string;
  }): Promise<PressureChatMessageV1[]> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const rows = await tx.storyEvent.findMany({
        where: { runId: input.runId, type: chatEventType(input.chapterRuntimeId) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: eventSelect(),
      });
      return rows.map(decodeChat);
    });
  }
}

interface AccessTransaction {
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<ChapterRuntimeRow | null>;
  };
  storyPlayer: {
    findUnique(input: Record<string, unknown>): Promise<{
      id: string;
      runId: string;
      userId: string | null;
      playerType: string;
      status: string;
      role: { roleKey: string; knownInfoJson: unknown } | null;
    } | null>;
  };
  storyRun: {
    findUnique(input: Record<string, unknown>): Promise<{
      id: string;
      stateJson: unknown;
    } | null>;
  };
  pressureSeatControlSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<{
      runId: string;
      stateRevision: number;
      snapshotJson: unknown;
      stateHash: string;
      version: number;
    } | null>;
  };
}

export type InteractionAccessPrismaClient =
  PressureSerializableClient<AccessTransaction>;

/** Read-only membership and action-capability projection for W5. */
export class PrismaPressureInteractionAccessRepository
implements PressureInteractionAccessPort {
  constructor(private readonly prisma: InteractionAccessPrismaClient) {}

  async load(input: {
    subjectId: string;
    runId: string;
    chapterRuntimeId: string;
    actionContext?: PressureFormalActionAccessContextV1;
    systemDefault?: PressureSystemDefaultAccessContextV1;
  }): Promise<PressureInteractionAccessV1> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const runtime = await tx.pressureChapterRuntime.findUnique({
        where: { id: input.chapterRuntimeId },
        select: {
          id: true,
          runId: true,
          chapterId: true,
          routeHash: true,
          workingRevision: true,
          workingStateJson: true,
          workingStateHash: true,
          lockVersion: true,
          decisionStateJson: true,
          ledgerProjectionJson: true,
        },
      });
      if (!runtime || runtime.runId !== input.runId) {
        throw missing("Interaction chapter runtime", input);
      }
      const [membership, run, seatControlRow] = await Promise.all([
        tx.storyPlayer.findUnique({
          where: { runId_userId: { runId: input.runId, userId: input.subjectId } },
          select: {
            id: true,
            runId: true,
            userId: true,
            playerType: true,
            status: true,
            role: { select: { roleKey: true, knownInfoJson: true } },
          },
        }),
        tx.storyRun.findUnique({
          where: { id: input.runId },
          select: { id: true, stateJson: true },
        }),
        tx.pressureSeatControlSnapshot.findUnique({
          where: { runId: input.runId },
          select: {
            runId: true,
            stateRevision: true,
            snapshotJson: true,
            stateHash: true,
            version: true,
          },
        }),
      ]);
      const activePoint = decodeDecisionState(runtime.decisionStateJson);
      const seatEnvelope = seatControlRow ? decodeSeatEnvelope(seatControlRow) : null;
      const directive = input.actionContext?.idempotencyKey && seatEnvelope
        ? seatEnvelope.directives[input.actionContext.idempotencyKey] ?? null
        : null;
      if (directive && !input.systemDefault) {
        throw invalid("Deterministic default action requires system authorization context", {
          runId: input.runId,
          idempotencyKey: directive.idempotencyKey,
        });
      }
      if (input.systemDefault) {
        return buildSystemDefaultAccess({
          runtime,
          activePoint,
          input,
          directive,
          seatControlRow: seatControlRow && seatEnvelope
            ? { snapshot: seatEnvelope.snapshot, stateHash: seatControlRow.stateHash }
            : null,
        });
      }
      const snapshot = seatEnvelope?.snapshot ?? null;
      const membershipSeatId = membership?.role?.roleKey as SeatIdV1 | undefined;
      const humanControlledSeat = snapshot?.seatControls.find((control) =>
        control.seatId === membershipSeatId
        && control.originalHumanControllerId === input.subjectId
        && control.activeControllerId === input.subjectId
        && control.mode === "HUMAN_ACTIVE");
      const aiControlledSeat = snapshot?.seatControls.find((control) =>
        control.designatedAiControllerId === input.subjectId
        && control.activeControllerId === input.subjectId
        && control.mode === "AI_ACTIVE");
      const controlledSeat = humanControlledSeat ?? aiControlledSeat;
      const humanAccessValid = Boolean(
        membership
        && membership.runId === input.runId
        && membership.userId === input.subjectId
        && membership.playerType === "human"
        && membership.status === "active"
        && membership.role
        && PRESSURE_CHAPTER_SEAT_IDS_V1.includes(membershipSeatId as SeatIdV1)
        && humanControlledSeat,
      );
      const aiAccessValid = Boolean(aiControlledSeat);
      if (
        (!humanAccessValid && !aiAccessValid)
        || !snapshot
        || snapshot.runId !== input.runId
        || snapshot.routeHash !== runtime.routeHash
        || snapshot.stateHash !== seatControlRow?.stateHash
        || !controlledSeat
      ) {
        throw missing("Controlled Pressure seat", input);
      }
      const controlledSeatIds = [controlledSeat.seatId];
      const controlEpochBySeat = {
        [controlledSeat.seatId]: controlledSeat.controlEpoch,
      } as Partial<Record<SeatIdV1, number>>;
      const authorityWorld = run?.stateJson ?? null;
      return {
        routeHash: runtime.routeHash,
        runId: runtime.runId,
        chapterRuntimeId: runtime.id,
        chapterId: runtime.chapterId as PressureInteractionAccessV1["chapterId"],
        workingRevision: runtime.workingRevision,
        workingStateHash: runtime.workingStateHash,
        activeDecisionPointId: activePoint?.decisionPointId ?? null,
        controlledSeatIds,
        controlEpochBySeat,
        allowedActionTypes: stringArray(activePoint?.optionIds),
        interactableSeatIds: PRESSURE_CHAPTER_SEAT_IDS_V1.filter(
          (seatId) => !controlledSeatIds.includes(seatId),
        ),
        visibleEvidenceRefs: visibleEvidenceRefs(
          authorityWorld,
          runtime.workingStateJson,
          membership?.role ? [membership.role.knownInfoJson] : [],
          controlledSeatIds,
        ),
        resourceAvailability: resourceAvailability(authorityWorld),
      };
    });
  }
}

function buildSystemDefaultAccess(input: {
  runtime: ChapterRuntimeRow;
  activePoint: { decisionPointId: string; optionIds: string[] } | null;
  input: {
    subjectId: string;
    runId: string;
    chapterRuntimeId: string;
    actionContext?: PressureFormalActionAccessContextV1;
    systemDefault?: PressureSystemDefaultAccessContextV1;
  };
  directive: SeatDefaultDirectiveV1 | null;
  seatControlRow: { snapshot: SeatControlSnapshotV1; stateHash: string } | null;
}): PressureInteractionAccessV1 {
  const { runtime, activePoint, directive, seatControlRow } = input;
  const actionContext = input.input.actionContext;
  const systemDefault = input.input.systemDefault;
  if (!actionContext || !systemDefault || !directive || !seatControlRow) {
    throw missing("Deterministic default authorization", {
      runId: input.input.runId,
      chapterRuntimeId: input.input.chapterRuntimeId,
      idempotencyKey: actionContext?.idempotencyKey ?? null,
    });
  }
  const trigger = systemDefault.reason === "DEADLINE" ? "HUMAN_DEADLINE" : "AI_FAILURE";
  if (
    directive.runId !== input.input.runId
    || directive.decisionPointId !== actionContext.decisionPointId
    || directive.seatId !== actionContext.seatId
    || directive.controlEpoch !== actionContext.controlEpoch
    || directive.idempotencyKey !== actionContext.idempotencyKey
    || directive.trigger !== trigger
    // A seat-control directive proves that the reserved system actor is
    // permitted to act for this seat at this authority snapshot. Its frozen
    // policy is deliberately different from the authored decision policy
    // carried by systemDefault: the latter selects the actual action for the
    // active decision point. Comparing the two policy identities made every
    // valid per-decision AI-failure default look forged.
    || directive.defaultPolicyRef
      !== seatControlRow.snapshot.frozenPolicy.deterministicDefaultPolicyRef
    || directive.defaultPolicyHash
      !== seatControlRow.snapshot.frozenPolicy.deterministicDefaultPolicyHash
    || directive.canonicalActionPayloadHash !== actionContext.payloadHash
    || directive.canonicalActionPayloadHash !== systemDefault.canonicalActionPayloadHash
    || directive.authorityStateHash !== seatControlRow.stateHash
  ) {
    throw invalid("Deterministic default authorization mismatch", {
      runId: input.input.runId,
      chapterRuntimeId: input.input.chapterRuntimeId,
      idempotencyKey: actionContext.idempotencyKey,
    });
  }
  const snapshot = structuredClone(seatControlRow.snapshot);
  if (
    snapshot.runId !== input.input.runId
    || snapshot.routeHash !== runtime.routeHash
    || snapshot.stateHash !== seatControlRow.stateHash
    || snapshot.stateHash !== directive.authorityStateHash
  ) {
    throw invalid("Deterministic default seat-control snapshot mismatch", {
      runId: input.input.runId,
      chapterRuntimeId: input.input.chapterRuntimeId,
      idempotencyKey: actionContext.idempotencyKey,
    });
  }
  const seat = snapshot.seatControls.find(
    (candidate) => candidate.seatId === actionContext.seatId,
  );
  if (
    !seat
    || seat.mode !== "AI_ACTIVE"
    || seat.controlEpoch !== actionContext.controlEpoch
    || seat.activeControllerId !== input.input.subjectId
    || seat.designatedAiControllerId !== input.input.subjectId
  ) {
    throw invalid("Deterministic default system actor is not current seat authority", {
      runId: input.input.runId,
      chapterRuntimeId: input.input.chapterRuntimeId,
      seatId: actionContext.seatId,
      idempotencyKey: actionContext.idempotencyKey,
    });
  }
  const allowedActionTypes = stringArray(activePoint?.optionIds)
    .filter((actionType) => actionType === actionContext.actionType);
  return {
    routeHash: runtime.routeHash,
    runId: runtime.runId,
    chapterRuntimeId: runtime.id,
    chapterId: runtime.chapterId as PressureInteractionAccessV1["chapterId"],
    workingRevision: runtime.workingRevision,
    workingStateHash: runtime.workingStateHash,
    activeDecisionPointId: activePoint?.decisionPointId ?? null,
    controlledSeatIds: [actionContext.seatId],
    controlEpochBySeat: { [actionContext.seatId]: actionContext.controlEpoch },
    allowedActionTypes,
    interactableSeatIds: [],
    visibleEvidenceRefs: [],
    resourceAvailability: [],
  };
}

async function readLedgerEvents(
  tx: Pick<WorkingLedgerTransaction, "storyEvent">,
  key: WorkingLedgerKeyV1,
): Promise<WorkingLedgerEventV1[]> {
  const rows = await tx.storyEvent.findMany({
    where: { runId: key.runId, type: LEDGER_EVENT_TYPE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: eventSelect(),
  });
  const events = rows
    .map(decodeLedgerEvent)
    .filter((event) => event.chapterRuntimeId === key.chapterRuntimeId)
    .sort((left, right) => left.sequence - right.sequence);
  if (events.length) projectWorkingLedger(events);
  return events;
}

/**
 * Query-oriented cache only. StoryEvent remains the immutable ledger authority;
 * every value here is deterministically rebuilt by projectWorkingLedger.
 */
function serializeLedgerProjection(
  projection: ReturnType<typeof projectWorkingLedger>,
  beatDownstreamManifest: unknown = null,
): Record<string, unknown> {
  return withWorkingLedgerProjectionCacheHashV1({
    schemaVersion: "pressure_mvp_ledger_projection_v1",
    key: projection.key,
    chapterId: projection.chapterId,
    routeHash: projection.routeHash,
    chapterDefinitionHash: projection.chapterDefinitionHash,
    headHash: projection.headHash,
    headSequence: projection.headSequence,
    stateHash: projection.stateHash,
    nextDecisionPin: projection.nextDecisionPin,
    acceptedActions: mapEntries(projection.acceptedActions),
    actionsByIdempotencyKey: mapEntries(projection.actionsByIdempotencyKey),
    appliedBeats: mapEntries(projection.appliedBeats),
    pendingReservations: mapEntries(projection.pendingReservations),
    commitments: mapEntries(projection.commitments),
    commitmentActionsByIdempotencyKey: mapEntries(
      projection.commitmentActionsByIdempotencyKey ?? new Map(),
    ),
    evidenceRefsByAction: mapEntries(projection.evidenceRefsByAction),
    knowledgeBySeat: mapEntries(projection.knowledgeBySeat),
    seatArcProgressBySeat: mapEntries(projection.seatArcProgressBySeat),
    beatDownstreamManifest,
  });
}

function mapEntries<T>(value: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...value.entries()]
    .map(([key, entry]) => [key, structuredClone(entry)] as [string, T])
    .sort(([left], [right]) => left.localeCompare(right));
}

function decisionState(
  projection: ReturnType<typeof projectWorkingLedger>,
  requiredSeatIds: SeatIdV1[] = [],
) {
  return decisionStateFromPin(
    projection.nextDecisionPin,
    projection.state.revision,
    requiredSeatIds,
  );
}

function decisionStateFromPin(
  pin: ReturnType<typeof projectWorkingLedger>["nextDecisionPin"],
  workingRevision = 0,
  requiredSeatIds: SeatIdV1[] = [],
) {
  return buildPressureMvpDecisionStateV1({
    workingRevision,
    pin,
    requiredSeatIds: pin ? orderedSeats(requiredSeatIds) : [],
  });
}

function preservedRequiredSeats(
  value: unknown,
  decisionPointId: string | null,
): SeatIdV1[] {
  if (!value || typeof value !== "object" || !decisionPointId) return [];
  try {
    const record = decodePressureMvpDecisionStateV1(value);
    return record.activeDecisionPointId === decisionPointId
      ? [...record.requiredSeatIds]
      : [];
  } catch {
    return [];
  }
}

function decodeDecisionState(
  value: unknown,
): { decisionPointId: string; optionIds: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const record = decodePressureMvpDecisionStateV1(value);
  if (record.state === "NONE" && record.activeDecisionPointId === null) return null;
  if (
    record.state !== "OPEN"
    || typeof record.activeDecisionPointId !== "string"
    || !record.activeDecisionPointId
  ) throw invalid("Stored MVP decision state is invalid", { reason: "ACTIVE_POINT" });
  return {
    decisionPointId: record.activeDecisionPointId,
    optionIds: stringArray(record.allowedActionTypes),
  };
}

function decodeLineage(
  row: { runId: string; commitManifestJson: unknown },
  chapterSequenceValue: number,
): { frozenHash: string; worldStateHash: string } {
  try {
    if (chapterSequenceValue === 1) {
      const committed = validateCommittedGenesis(
        row.commitManifestJson as Parameters<typeof validateCommittedGenesis>[0],
      );
      if (committed.record.runId !== row.runId) throw new Error("RUN_BINDING_MISMATCH");
      return {
        frozenHash: committed.record.snapshot.genesisHash,
        worldStateHash: committed.record.snapshot.initialWorldState.stateHash,
      };
    }
    const committed = validateAtomicChapterCommitRecordV1(row.commitManifestJson);
    if (
      committed.runId !== row.runId
      || committed.frozenChapterBundle.committedWorldSequence !== chapterSequenceValue - 1
    ) throw new Error("RUN_OR_SEQUENCE_BINDING_MISMATCH");
    return {
      frozenHash: committed.frozenChapterBundle.bundleHash,
      worldStateHash: committed.frozenChapterBundle.committedWorldStateHash,
    };
  } catch (cause) {
    throw invalid("Stored chapter lineage manifest is invalid", {
      runId: row.runId,
      chapterSequence: chapterSequenceValue,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function assertAppendChain(
  key: WorkingLedgerKeyV1,
  runtime: ChapterRuntimeRow,
  current: WorkingLedgerEventV1[],
  events: WorkingLedgerEventV1[],
): void {
  for (const event of events) {
    if (
      event.runId !== key.runId
      || event.chapterRuntimeId !== key.chapterRuntimeId
      || event.chapterId !== runtime.chapterId
    ) throw invalid("Working ledger event context does not match runtime");
  }
  projectWorkingLedger([...current, ...events]);
}

async function persistFormalAction(
  tx: WorkingLedgerTransaction,
  event: WorkingLedgerEventV1,
): Promise<void> {
  if (event.payload.eventType !== "FORMAL_ACTION_ACCEPTED") return;
  const action = event.payload.action;
  await tx.pressureDecisionAction.create({
    data: {
      id: action.actionId,
      runId: action.runId,
      chapterRuntimeId: action.chapterRuntimeId,
      decisionPointId: action.decisionPointId,
      seatId: action.seatId,
      actionOrdinal: action.actionOrdinal,
      actionType: action.actionType,
      status: action.status,
      controlEpoch: action.controlEpoch,
      expectedWorkingRevision: action.expectedWorkingRevision,
      currentRevision: action.actionRevision,
      idempotencyKey: action.idempotencyKey,
      requestFingerprint: action.requestFingerprint,
      payloadJson: json(action.payload),
      payloadHash: action.payloadHash,
      sealedHash: action.sealedHash,
      authorityEventHash: event.eventHash,
      confirmedAt: new Date(),
      sealedAt: new Date(),
    },
  });
}

async function persistBeat(
  tx: WorkingLedgerTransaction,
  event: WorkingLedgerEventV1,
  committedLedger: WorkingLedgerEventV1[],
  narrativeCompiler?: ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
  aEmotionCompiler?: Pick<SangtianAEmotionContentSourceCompilerV1, "compileBeat">,
): Promise<unknown> {
  if (event.payload.eventType !== "BEAT_APPLIED") return null;
  const beat = event.payload.beatResolution;
  const route = await tx.pressureRunRouteSnapshot.findUnique({
      where: { runId: event.runId },
      select: {
        runId: true,
        routeHash: true,
        contentPackageVersion: true,
        contentPackageSha256: true,
        orchestrationPackageVersion: true,
        orchestrationPackageSha256: true,
        runtimeContractVersion: true,
        runtimeContractSha256: true,
      },
    });
  if (!route || route.routeHash !== event.payload.routeHash) {
    throw new PressurePersistenceError(
      ERROR.AUTHORITY_FENCE_MISMATCH,
      "Beat downstream plan is not bound to the frozen route",
      { runId: event.runId, resolutionHash: beat.resolutionHash },
    );
  }
  const projection = projectWorkingLedger(committedLedger);
  const sealedActions = beat.sealedActionIds.map((actionId) => {
    const accepted = projection.acceptedActions.get(actionId);
    if (!accepted) throw invalid("Beat downstream plan is missing a sealed action", { actionId });
    return accepted.action;
  });
  const sealedActionAudiences = beat.sealedActionIds.map((actionId) => {
    const accepted = projection.acceptedActions.get(actionId);
    if (!accepted) {
      throw invalid("Beat downstream plan is missing a sealed action audience", { actionId });
    }
    return {
      actionId,
      audienceSeatIds: [...accepted.audienceSeatIds].sort(),
    };
  });
  const workingDeltaHash = sha256Canonical(beat.workingDelta);
  const rawAuthority = {
    schemaVersion: "pressure_committed_beat_narrative_authority_v1" as const,
    runId: event.runId,
    chapterRuntimeId: event.chapterRuntimeId,
    chapterId: event.chapterId,
    decisionPointId: beat.decisionPointId,
    decisionPointKey: beat.decisionPointId,
    baseWorkingRevision: beat.baseWorkingRevision,
    committedWorkingRevision: beat.committedWorkingRevision,
    inputWorkingStateHash: beat.inputWorkingStateHash,
    sealedActionIds: [...beat.sealedActionIds],
    sealedActionsHash: beat.sealedActionsHash,
    sealedActions,
    sealedActionAudiences,
    resolverVersion: beat.resolverVersion,
    workingDelta: beat.workingDelta,
    workingDeltaHash,
    stateAfter: event.payload.stateAfter,
    stateAfterHash: event.payload.stateAfterHash,
    reservationMutations: beat.reservationMutations,
    reactionContextRef: beat.reactionContextRef,
    nextDecisionContextRef: beat.nextDecisionContextRef,
    nextDecisionPin: event.payload.nextDecisionPin,
    resolutionHash: beat.resolutionHash,
    contentPackageSha256: route.contentPackageSha256,
  };
  const narrativeJobs = planNarrativeProjectionJobsV1({
    runId: event.runId,
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: beat.resolutionHash,
    sourceCommitHash: beat.resolutionHash,
    sourceContentHash: workingDeltaHash,
    audiences: planInteractiveNarrativeAudiencesV1({
      humanSeatIds: readNarrativeHumanSeatIds(route.humanSeatIdsAtStartJson),
    }),
  }, rawAuthority, narrativeCompiler);
  const committedAtDate = new Date();
  const standardEmissions = (aEmotionCompiler ?? createSangtianAEmotionContentSourceCompilerV1())
    .compileBeat({
      sourceKind: "BEAT_COMMITTED",
      roomId: event.runId,
      committedAt: committedAtDate.toISOString(),
      beatEventHash: event.eventHash,
      ledgerEvents: committedLedger,
    });
  const lifecycleEmissions = await compileCommittedInvestigationLifecycleEmissionsV1({
    tx,
    beatEvent: event,
    projection,
    committedAt: committedAtDate.toISOString(),
  });
  const emissions = [...standardEmissions, ...lifecycleEmissions];
  const downstreamManifest = buildAuthorityDownstreamManifestV1({
    authorityKind: "BEAT",
    sourceId: beat.resolutionHash,
    sourceCommitHash: beat.resolutionHash,
    dedupeKeys: downstreamDedupeKeysV1({
      narrativeJobs,
      aEmotionEmissions: emissions,
    }),
  });
  await insertNarrativeProjectionPlanV1(
    tx,
    "PROJECT_BEAT_NARRATIVE",
    narrativeJobs,
  );
  await insertAEmotionAuthorityEmissionsV1(tx, "CHAPTER_WORKING", emissions);
  return downstreamManifest;
}

async function persistLedgerEvent(
  tx: WorkingLedgerTransaction,
  event: WorkingLedgerEventV1,
): Promise<void> {
  const roleKey = event.payload.eventType === "FORMAL_ACTION_ACCEPTED"
    ? event.payload.action.seatId
    : null;
  await tx.storyEvent.create({
    data: {
      id: `pressure_ledger_${event.eventHash.slice(0, 32)}`,
      runId: event.runId,
      day: chapterNumber(event.chapterId),
      type: LEDGER_EVENT_TYPE,
      messageType: "system",
      roleKey,
      visibility: "system",
      payloadJson: json(event),
      // StoryEvent.sequence is the global authority stream. The W5 ledger has
      // its own sequence inside payload and therefore must never consume it.
      sequence: null,
      dedupeKey: ledgerDedupeKey(event),
    },
  });
}

function decodeLedgerEvent(row: StoryEventRow): WorkingLedgerEventV1 {
  try {
    const event = structuredClone(row.payloadJson) as WorkingLedgerEventV1;
    if (
      event.schemaVersion !== "pressure_working_ledger_event_v1"
      || row.runId !== event.runId
      || row.dedupeKey !== ledgerDedupeKey(event)
    ) throw new Error("ROW_BINDING_MISMATCH");
    return event;
  } catch (cause) {
    throw invalid("Stored WorkingLedger StoryEvent is invalid", {
      storyEventId: row.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function decodeChat(row: StoryEventRow): PressureChatMessageV1 {
  try {
    const message = structuredClone(row.payloadJson) as PressureChatMessageV1;
    const { messageHash, ...body } = message;
    if (
      message.schemaVersion !== "pressure_chapter_chat_message_v1"
      || message.runId !== row.runId
      || sha256Canonical(body) !== messageHash
      || row.dedupeKey !== chatDedupeKey(message)
    ) throw new Error("ROW_BINDING_OR_HASH_MISMATCH");
    return message;
  } catch (cause) {
    throw invalid("Stored Pressure chat StoryEvent is invalid", {
      storyEventId: row.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function assertSameChat(
  stored: PressureChatMessageV1,
  candidate: PressureChatMessageV1,
): PressureChatMessageV1 {
  if (
    stored.requestFingerprint !== candidate.requestFingerprint
    || stored.messageHash !== candidate.messageHash
  ) {
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "Pressure chat idempotency key was reused for different content",
      {
        runId: candidate.runId,
        chapterRuntimeId: candidate.chapterRuntimeId,
        idempotencyKey: candidate.idempotencyKey,
      },
    );
  }
  return structuredClone(stored);
}

function eventSelect(): Record<string, true> {
  return {
    id: true,
    runId: true,
    type: true,
    payloadJson: true,
    dedupeKey: true,
    createdAt: true,
  };
}

function ledgerDedupeKey(event: WorkingLedgerEventV1): string {
  return `pressure-ledger:${event.runId}:${event.chapterRuntimeId}:${event.eventHash}`;
}

function chatDedupeKey(input: {
  runId: string;
  chapterRuntimeId: string;
  idempotencyKey: string;
}): string {
  return `pressure-chat:${input.runId}:${input.chapterRuntimeId}:${input.idempotencyKey}`;
}

function chatEventType(chapterRuntimeId: string): string {
  return `${CHAT_EVENT_PREFIX}:${chapterRuntimeId}`;
}

function chapterNumber(chapterId: string): number {
  const value = Number(chapterId.replace(/^N/, ""));
  return Number.isSafeInteger(value) ? value : 0;
}

function orderedSeats(values: readonly string[]): SeatIdV1[] {
  const selected = new Set(values);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => selected.has(seatId));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return [];
  }
  return [...new Set(value)].sort();
}

function resourceAvailability(value: unknown): Array<{
  resourceId: string;
  availableAmount: number;
}> {
  if (!value || typeof value !== "object") return [];
  const resources = (value as Record<string, unknown>).resources;
  if (Array.isArray(resources)) {
    return resources.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const resourceId = String(item.resourceId ?? "");
      const amount = Number(item.amount ?? item.availableAmount);
      return resourceId && Number.isFinite(amount)
        ? [{ resourceId, availableAmount: amount }]
        : [];
    }).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  }
  if (!resources || typeof resources !== "object") return [];
  return Object.entries(resources as Record<string, unknown>)
    .flatMap(([resourceId, raw]) => {
      const amount = typeof raw === "number"
        ? raw
        : Number((raw as Record<string, unknown> | null)?.amount);
      return Number.isFinite(amount) ? [{ resourceId, availableAmount: amount }] : [];
    })
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
}

function visibleEvidenceRefs(
  world: unknown,
  workingState: unknown,
  roleKnowledge: unknown[],
  seats: SeatIdV1[],
): string[] {
  const refs = new Set<string>();
  collectEvidenceRefs(refs, workingState);
  roleKnowledge.forEach((value) => collectEvidenceRefs(refs, value));
  if (world && typeof world === "object") {
    const record = world as Record<string, unknown>;
    if (Array.isArray(record.evidence)) {
      for (const item of record.evidence) {
        if (!item || typeof item !== "object") continue;
        const evidence = item as Record<string, unknown>;
        const id = String(evidence.evidenceId ?? evidence.evidenceRef ?? "");
        const authorized = stringArray(
          evidence.authorizedSeatIds ?? evidence.knownBySeatIds ?? [],
        );
        if (id && (!authorized.length || seats.some((seat) => authorized.includes(seat)))) {
          refs.add(id);
        }
      }
    }
    const knowledge = record.knowledgeBySeat;
    if (knowledge && typeof knowledge === "object") {
      for (const seat of seats) collectEvidenceRefs(
        refs,
        (knowledge as Record<string, unknown>)[seat],
      );
    }
  }
  return [...refs].sort();
}

function collectEvidenceRefs(target: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && /evidence|clue|proof|ref/i.test(entry)) {
        target.add(entry);
      } else collectEvidenceRefs(target, entry);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/evidenceRefs?|clueRefs?|proofRefs?/i.test(key)) {
      stringArray(entry).forEach((item) => target.add(item));
    } else {
      collectEvidenceRefs(target, entry);
    }
  }
}

function missing(label: string, details: object): PressurePersistenceError {
  return new PressurePersistenceError(
    ERROR.RECORD_NOT_FOUND,
    `${label} was not found`,
    { ...details },
  );
}

function invalid(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}

function readNarrativeHumanSeatIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((seatId) => typeof seatId !== "string")) {
    throw invalid("Route does not contain valid human narrative audiences");
  }
  return [...value];
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}

class LedgerHeadRace extends Error {}
