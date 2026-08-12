import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  chapterSequence,
  compareCanonicalText,
  sha256Canonical,
  validateSealedChapterSettlementInputV1,
  validateWorldStateV1,
  type B0ChapterSettlementMaterialV1,
  type ChapterIdV1,
  type SealedChapterSettlementInputV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import { validateCommittedGenesis } from "../genesis";
import {
  assertChapterSettlementSourceReadyV1,
  sealChapterCloseFenceV1,
  sealChapterSettlementSourceV1,
  validateAtomicChapterCommitRecordV1,
  validateChapterSettlementSourceV1,
} from "../chapter-settlement/chapter-commit-record";
import type {
  ChapterSettlementKeyV1,
  ChapterSettlementSourcePort,
  ChapterSettlementSourceV1,
} from "../chapter-settlement/types";
import type {
  ChapterOrchestratorStateV1,
  ChapterSettlementPort,
} from "../orchestrator/contracts";
import {
  canonicalSeatParticipationV1,
  computeDurableChapterSettlementPreparationFingerprintV1,
  type DurableChapterSettlementSourcePreparationPort,
  type DurableChapterSettlementSourcePreparationReceiptV1,
  type DurableChapterSettlementSourcePreparationV1,
} from "../integration/chapter-settlement.adapter";
import type { WorkingLedgerEventV1 } from "../working-ledger/contracts";
import { projectWorkingLedger } from "../working-ledger/working-ledger";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  PRESSURE_ORCHESTRATOR_STATE_EVENT_TYPE,
  readCurrentOrchestratorState,
} from "./orchestrator-state.prisma-adapter";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";

const SETTLEMENT_SOURCE_EVENT_TYPE = "PRESSURE_CHAPTER_SETTLEMENT_SOURCE";
const WORKING_LEDGER_EVENT_TYPE = "PRESSURE_WORKING_LEDGER_EVENT";

export type ChapterSettlementSeatParticipationV1 =
  Parameters<ChapterSettlementPort["settle"]>[0]["seatParticipation"];

interface SourceEventRow {
  id: string;
  runId: string;
  type: string;
  payloadJson: unknown;
  dedupeKey: string | null;
}

interface SourceRuntimeRow {
  id: string;
  runId: string;
  chapterId: string;
  chapterSequence: number;
  state: string;
  baseWorldSequence: number;
  baseWorldStateHash: string;
  previousFrozenHash: string;
  routeHash: string;
  workingRevision: number;
  workingStateHash: string;
  closeInputHash: string | null;
  lockVersion: number;
}

interface SourceRouteRow {
  runId: string;
  routeHash: string;
}

interface SourceRunRow {
  id: string;
  worldSequence: number;
  stateJson: unknown;
}

interface SourcePersistenceTransaction {
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<SourceEventRow[]>;
    findUnique(input: Record<string, unknown>): Promise<SourceEventRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<SourceEventRow>;
  };
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<SourceRuntimeRow | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  pressureRunRouteSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<SourceRouteRow | null>;
  };
  storyRun: {
    findUnique(input: Record<string, unknown>): Promise<SourceRunRow | null>;
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
}

export type ChapterSettlementSourcePrismaClient =
  PressureSerializableClient<SourcePersistenceTransaction>;

interface StoredSettlementSourceEnvelopeV1 {
  schemaVersion: "pressure_chapter_settlement_source_envelope_v1";
  preparationFingerprint: string;
  chapterDescriptorHash: string;
  source: ChapterSettlementSourceV1;
  envelopeHash: string;
}

/**
 * W4 close sealer plus W6 durable reader. It snapshots the live ledger and
 * world exactly once after the orchestrator/runtime both reached SETTLING.
 */
export class PrismaDurableChapterSettlementSourceRepository
implements ChapterSettlementSourcePort, DurableChapterSettlementSourcePreparationPort {
  constructor(private readonly prisma: ChapterSettlementSourcePrismaClient) {}

  async prepareSource(
    inputValue: Readonly<DurableChapterSettlementSourcePreparationV1>,
  ): Promise<DurableChapterSettlementSourcePreparationReceiptV1> {
    const input = validatePreparation(inputValue);
    const { runId, chapterRuntimeId, chapterId } = input.settlementInput;
    const expectedFingerprint = computeDurableChapterSettlementPreparationFingerprintV1(input);
    if (input.preparationFingerprint !== expectedFingerprint) {
      throw fingerprint("Chapter settlement preparation fingerprint is invalid", input);
    }
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        const existing = await tx.storyEvent.findUnique({
          where: { dedupeKey: sourceDedupeKey(runId, chapterRuntimeId) },
          select: sourceEventSelect(),
        });
        if (existing) {
          return replayReceipt(decodeSourceEnvelope(existing), input);
        }

        const [runtime, route, run, lineage, orchestrator, ledgerEvents] = await Promise.all([
          tx.pressureChapterRuntime.findUnique({
            where: { id: chapterRuntimeId },
            select: {
              id: true,
              runId: true,
              chapterId: true,
              chapterSequence: true,
              state: true,
              baseWorldSequence: true,
              baseWorldStateHash: true,
              previousFrozenHash: true,
              routeHash: true,
              workingRevision: true,
              workingStateHash: true,
              closeInputHash: true,
              lockVersion: true,
            },
          }),
          tx.pressureRunRouteSnapshot.findUnique({
            where: { runId },
            select: { runId: true, routeHash: true },
          }),
          tx.storyRun.findUnique({
            where: { id: runId },
            select: { id: true, worldSequence: true, stateJson: true },
          }),
          readLineage(tx, input),
          readCurrentOrchestratorState(tx, runId),
          readWorkingLedger(tx, runId, chapterRuntimeId),
        ]);
        if (!runtime || !route || !run || !lineage || !orchestrator) {
          throw missing("Chapter close authority snapshot", {
            runId,
            chapterRuntimeId,
          });
        }
        const world = validateWorldStateV1(run.stateJson);
        const projection = projectWorkingLedger(ledgerEvents);
        assertCloseAuthority(input, runtime, route, run, lineage, orchestrator, projection, world);

        const source = assertChapterSettlementSourceReadyV1(
          sealChapterSettlementSourceV1({
            schemaVersion: "pressure_chapter_settlement_source_v1",
            closeFence: sealChapterCloseFenceV1({
              schemaVersion: "pressure_chapter_close_fence_v1",
              runId,
              chapterRuntimeId,
              chapterId,
              lifecycleState: "CHAPTER_SETTLING",
              closedWorkingRevision: projection.state.revision,
              observedWorkingRevision: runtime.workingRevision,
              closedWorkingStateHash: projection.stateHash,
              observedWorkingStateHash: runtime.workingStateHash,
              closedDecisionLedgerHash: projection.headHash,
              observedDecisionLedgerHash: projection.headHash,
              closedActionCount: projection.acceptedActions.size,
              observedActionCount: projection.acceptedActions.size,
              baseWorldSequenceAtClose: input.settlementInput.baseWorldSequence,
              observedWorldSequence: run.worldSequence,
              baseWorldStateHashAtClose: input.settlementInput.baseWorldStateHash,
              observedWorldStateHash: world.stateHash,
              runRouteHashAtClose: route.routeHash,
              previousFrozenHashAtClose: runtime.previousFrozenHash,
              reservationLedgerHashAtClose: input.settlementInput.reservationLedgerHash,
              contentPolicyVersionAtClose: input.settlementInput.contentPolicyVersion,
              contentPolicyHashAtClose: input.settlementInput.contentPolicyHash,
              settlementContractVersionAtClose: input.settlementInput.settlementContractVersion,
              settlementContractHashAtClose: input.settlementInput.settlementContractHash,
            }),
            sealedInput: input.settlementInput,
            settlementMaterial: buildSettlementMaterial(
              input.seatParticipation,
              projection,
              world,
            ),
            baseWorldState: world,
          }),
        );
        const envelope = sealSourceEnvelope({
          schemaVersion: "pressure_chapter_settlement_source_envelope_v1",
          preparationFingerprint: input.preparationFingerprint,
          chapterDescriptorHash: input.chapterDescriptorHash,
          source,
        });

        const runtimeClosed = await tx.pressureChapterRuntime.updateMany({
          where: {
            id: runtime.id,
            runId: runtime.runId,
            state: "CHAPTER_SETTLING",
            workingRevision: runtime.workingRevision,
            workingStateHash: runtime.workingStateHash,
            closeInputHash: null,
            lockVersion: runtime.lockVersion,
          },
          data: {
            closeInputHash: input.settlementInput.inputHash,
            lockVersion: { increment: 1 },
          },
        });
        if (runtimeClosed.count !== 1) {
          throw fence("Chapter closeInputHash CAS was lost", input);
        }
        const row = await tx.storyEvent.create({
          data: {
            id: `pc_source_${source.sourceHash.slice(0, 32)}`,
            runId,
            day: chapterSequence(chapterId),
            type: SETTLEMENT_SOURCE_EVENT_TYPE,
            messageType: "system",
            visibility: "system",
            payloadJson: json(envelope),
            sequence: null,
            dedupeKey: sourceDedupeKey(runId, chapterRuntimeId),
          },
        });
        const committed = decodeSourceEnvelope(row);
        return receipt("PREPARED", committed);
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.readEnvelope(runId, chapterRuntimeId);
      if (!existing) throw error;
      return replayReceipt(existing, input);
    }
  }

  async readSealedSource(
    key: Readonly<ChapterSettlementKeyV1>,
  ): Promise<ChapterSettlementSourceV1 | null> {
    const envelope = await this.readEnvelope(key.runId, key.chapterRuntimeId);
    if (!envelope) return null;
    if (
      envelope.source.sealedInput.runId !== key.runId
      || envelope.source.sealedInput.chapterRuntimeId !== key.chapterRuntimeId
    ) throw invalid("Stored settlement source is bound to a different chapter", key);
    return structuredClone(envelope.source);
  }

  private async readEnvelope(
    runId: string,
    chapterRuntimeId: string,
  ): Promise<StoredSettlementSourceEnvelopeV1 | null> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.storyEvent.findUnique({
        where: { dedupeKey: sourceDedupeKey(runId, chapterRuntimeId) },
        select: sourceEventSelect(),
      });
      return row ? decodeSourceEnvelope(row) : null;
    });
  }
}

function validatePreparation(
  value: Readonly<DurableChapterSettlementSourcePreparationV1>,
): DurableChapterSettlementSourcePreparationV1 {
  const settlementInput = validateSealedChapterSettlementInputV1(value.settlementInput);
  const seats = canonicalSeatParticipationV1(value.seatParticipation);
  if (
    value.schemaVersion !== "pressure_chapter_settlement_preparation_v1"
    || value.routeHash !== settlementInput.runRouteHash
    || !isHash(value.chapterDescriptorHash)
    || !isHash(value.preparationFingerprint)
  ) throw invalid("Chapter settlement preparation is invalid");
  return structuredClone({ ...value, settlementInput, seatParticipation: seats });
}

async function readLineage(
  tx: SourcePersistenceTransaction,
  input: DurableChapterSettlementSourcePreparationV1,
) {
  const { runId, chapterId } = input.settlementInput;
  const sequence = chapterSequence(chapterId);
  return sequence === 1
    ? tx.pressureGenesisCommit.findUnique({
        where: { runId },
        select: { runId: true, commitManifestJson: true },
      })
    : tx.pressureChapterSettlement.findUnique({
        where: {
          runId_committedWorldSequence: {
            runId,
            committedWorldSequence: sequence - 1,
          },
        },
        select: { runId: true, commitManifestJson: true },
      });
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

async function readWorkingLedger(
  tx: Pick<SourcePersistenceTransaction, "storyEvent">,
  runId: string,
  chapterRuntimeId: string,
): Promise<WorkingLedgerEventV1[]> {
  const rows = await tx.storyEvent.findMany({
    where: { runId, type: WORKING_LEDGER_EVENT_TYPE },
    select: sourceEventSelect(),
  });
  const events = rows.map((row) => structuredClone(row.payloadJson) as WorkingLedgerEventV1)
    .filter((event) => event.chapterRuntimeId === chapterRuntimeId)
    .sort((left, right) => left.sequence - right.sequence);
  if (!events.length) throw missing("Working ledger", { runId, chapterRuntimeId });
  projectWorkingLedger(events);
  return events;
}

function assertCloseAuthority(
  input: DurableChapterSettlementSourcePreparationV1,
  runtime: SourceRuntimeRow,
  route: SourceRouteRow,
  run: SourceRunRow,
  lineage: NonNullable<Awaited<ReturnType<typeof readLineage>>>,
  orchestrator: NonNullable<Awaited<ReturnType<typeof readCurrentOrchestratorState>>>,
  projection: ReturnType<typeof projectWorkingLedger>,
  world: WorldStateV1,
): void {
  const { runId, chapterRuntimeId, chapterId } = input.settlementInput;
  const sequence = chapterSequence(chapterId);
  const decodedLineage = decodeLineage(lineage, sequence);
  const lineageHash = decodedLineage.frozenHash;
  const lineageWorldHash = decodedLineage.worldStateHash;
  const reservations = [...projection.pendingReservations.values()]
    .map((reservation) => ({ ...reservation }))
    .sort((left, right) => compareCanonicalText(left.reservationKey, right.reservationKey));
  if (
    runtime.id !== chapterRuntimeId
    || runtime.runId !== runId
    || runtime.chapterId !== chapterId
    || runtime.chapterSequence !== sequence
    || runtime.state !== "CHAPTER_SETTLING"
    || runtime.closeInputHash !== null
    || runtime.routeHash !== input.routeHash
    || route.routeHash !== input.routeHash
    || runtime.baseWorldSequence !== input.settlementInput.baseWorldSequence
    || runtime.baseWorldStateHash !== input.settlementInput.baseWorldStateHash
    || runtime.previousFrozenHash !== input.settlementInput.previousFrozenHash
    || lineageHash !== input.settlementInput.previousFrozenHash
    || lineageWorldHash !== input.settlementInput.baseWorldStateHash
    || run.worldSequence !== input.settlementInput.baseWorldSequence
    || world.worldSequence !== run.worldSequence
    || world.stateHash !== input.settlementInput.baseWorldStateHash
    || runtime.workingRevision !== projection.state.revision
    || runtime.workingStateHash !== projection.stateHash
    || projection.routeHash !== input.routeHash
    || projection.headHash !== input.settlementInput.decisionLedgerHash
    || projection.stateHash !== input.settlementInput.finalWorkingStateHash
    || projection.acceptedActions.size !== input.settlementInput.sealedDecisionActionIds.length
    || sha256Canonical(reservations) !== input.settlementInput.reservationLedgerHash
    || orchestrator.phase !== "SETTLING"
    || orchestrator.chapterRuntimeId !== chapterRuntimeId
    || orchestrator.currentChapterId !== chapterId
    || orchestrator.routeHash !== input.routeHash
    || orchestrator.descriptorHash !== input.chapterDescriptorHash
    || orchestrator.settlementInputHash !== input.settlementInput.inputHash
  ) throw fence("Chapter close authority fence does not match preparation", input);
  const actionIds = [...projection.acceptedActions.keys()].sort(compareCanonicalText);
  if (!sameStrings(actionIds, input.settlementInput.sealedDecisionActionIds)) {
    throw fence("Chapter close action set does not match sealed input", input);
  }
  const persistedParticipation = derivePersistedSeatParticipation(
    orchestrator.chapterSeatSummaries,
    projection,
    input,
  );
  if (
    sha256Canonical(persistedParticipation)
    !== sha256Canonical(canonicalSeatParticipationV1(input.seatParticipation))
  ) throw fence("Chapter close seat participation does not match orchestrator state", input);
}

function derivePersistedSeatParticipation(
  summaries: ChapterOrchestratorStateV1["chapterSeatSummaries"],
  projection: ReturnType<typeof projectWorkingLedger>,
  input: DurableChapterSettlementSourcePreparationV1,
): ChapterSettlementSeatParticipationV1 {
  const bySeat = new Map(summaries.map((summary) => [summary.seatId, summary]));
  if (
    summaries.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
    || bySeat.size !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
  ) throw fence("Orchestrator seat summaries must contain the canonical six seats", input);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const summary = bySeat.get(seatId);
    if (!summary) throw fence("Orchestrator seat summary is missing", input);
    const acceptedActionIds = [...projection.acceptedActions.values()]
      .filter((accepted) => accepted.action.seatId === seatId)
      .map((accepted) => accepted.action.actionId)
      .sort(compareCanonicalText);
    const persistedActionIds = canonicalUnique(summary.sealedActionIds);
    const persistedDefaultActionIds = canonicalUnique(summary.defaultActionIds);
    const expectedDefaultActionIds = [...projection.acceptedActions.values()]
      .filter((accepted) => (
        accepted.action.seatId === seatId
        && accepted.action.idempotencyKey.startsWith("pressure-default-v1:")
      ))
      .map((accepted) => accepted.action.actionId)
      .sort(compareCanonicalText);
    const defaultCodes = canonicalUnique(summary.defaultCodes);
    if (
      !sameStrings(summary.sealedActionIds, persistedActionIds)
      || !sameStrings(summary.defaultActionIds, persistedDefaultActionIds)
      || !sameStrings(summary.defaultCodes, defaultCodes)
      || !sameStrings(persistedActionIds, acceptedActionIds)
      || !sameStrings(persistedDefaultActionIds, expectedDefaultActionIds)
    ) throw fence("Orchestrator seat action summary does not match the working ledger", input);
    if (summary.requirement === "NOT_REQUIRED") {
      if (persistedActionIds.length !== 0 || defaultCodes.length !== 0) {
        throw fence("NOT_REQUIRED seat contains authoritative chapter actions", input);
      }
      return {
        seatId,
        requirement: "NOT_REQUIRED",
        completion: "NOT_REQUIRED",
        defaultCodes: [],
      };
    }
    const defaultCount = persistedDefaultActionIds.length;
    const nonDefaultCount = persistedActionIds.length - defaultCount;
    return {
      seatId,
      requirement: "REQUIRED",
      completion: defaultCount > 0
        ? nonDefaultCount > 0 ? "MIXED_ACTIONS" : "DEFAULTED"
        : "SEALED_ACTIONS",
      defaultCodes,
    };
  });
}

function buildSettlementMaterial(
  seats: ChapterSettlementSeatParticipationV1,
  projection: ReturnType<typeof projectWorkingLedger>,
  world: WorldStateV1,
): B0ChapterSettlementMaterialV1 {
  const canonicalSeats = canonicalSeatParticipationV1(seats);
  const resources = Object.entries(world.resources)
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([resourceId, quantity]) => ({
      resourceId,
      quantity,
      version: world.worldSequence,
    }));
  const actions = [...projection.acceptedActions.values()]
    .sort((left, right) => compareCanonicalText(left.action.actionId, right.action.actionId))
    .map((accepted) => ({
      actionId: accepted.action.actionId,
      decisionPointId: accepted.action.decisionPointId,
      seatId: accepted.action.seatId,
      // The frozen action contract carries an explicit deterministic-default
      // idempotency namespace. Non-default HUMAN/AI provenance is rule-neutral
      // in B0 and remains a separate seat-control audit concern.
      source: accepted.action.idempotencyKey.startsWith("pressure-default-v1:")
        ? "DEFAULT" as const
        : "HUMAN" as const,
      actionType: accepted.action.actionType,
      payload: structuredClone(accepted.action.payload),
      resourceCommitments: accepted.intent.resourceReservations
        .map((reservation) => ({
          commitmentId: reservation.reservationKey,
          reservationKey: reservation.reservationKey,
          resourceId: reservation.resourceId,
          amount: reservation.amount,
          expectedResourceVersion: world.worldSequence,
        }))
        .sort((left, right) => compareCanonicalText(left.commitmentId, right.commitmentId)),
      evidenceRefs: [...accepted.intent.evidenceRefs].sort(compareCanonicalText),
    }));
  return { seats: canonicalSeats, resources, actions };
}

function sealSourceEnvelope(
  draft: Omit<StoredSettlementSourceEnvelopeV1, "envelopeHash">,
): StoredSettlementSourceEnvelopeV1 {
  return { ...structuredClone(draft), envelopeHash: sha256Canonical(draft) };
}

function decodeSourceEnvelope(row: SourceEventRow): StoredSettlementSourceEnvelopeV1 {
  try {
    const value = structuredClone(row.payloadJson) as StoredSettlementSourceEnvelopeV1;
    const { envelopeHash, ...body } = value;
    const source = validateChapterSettlementSourceV1(value.source);
    if (
      value.schemaVersion !== "pressure_chapter_settlement_source_envelope_v1"
      || row.type !== SETTLEMENT_SOURCE_EVENT_TYPE
      || row.runId !== source.sealedInput.runId
      || row.dedupeKey !== sourceDedupeKey(source.sealedInput.runId, source.sealedInput.chapterRuntimeId)
      || !isHash(value.preparationFingerprint)
      || !isHash(value.chapterDescriptorHash)
      || sha256Canonical(body) !== envelopeHash
    ) throw new Error("ROW_BINDING_OR_HASH_MISMATCH");
    const expected = computeDurableChapterSettlementPreparationFingerprintV1({
      routeHash: source.sealedInput.runRouteHash,
      settlementInput: source.sealedInput,
      chapterDescriptorHash: value.chapterDescriptorHash,
      seatParticipation: source.settlementMaterial.seats,
    });
    if (expected !== value.preparationFingerprint) throw new Error("PREPARATION_HASH_MISMATCH");
    return { ...value, source };
  } catch (cause) {
    throw invalid("Stored ChapterSettlementSource is invalid", {
      eventId: row.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function replayReceipt(
  envelope: StoredSettlementSourceEnvelopeV1,
  input: DurableChapterSettlementSourcePreparationV1,
): DurableChapterSettlementSourcePreparationReceiptV1 {
  if (
    envelope.preparationFingerprint !== input.preparationFingerprint
    || envelope.chapterDescriptorHash !== input.chapterDescriptorHash
    || envelope.source.sealedInput.inputHash !== input.settlementInput.inputHash
  ) throw fingerprint("Chapter settlement source was already prepared differently", input);
  return receipt("REPLAYED", envelope);
}

function receipt(
  status: "PREPARED" | "REPLAYED",
  envelope: StoredSettlementSourceEnvelopeV1,
): DurableChapterSettlementSourcePreparationReceiptV1 {
  const source = envelope.source;
  return {
    schemaVersion: "pressure_chapter_settlement_preparation_receipt_v1",
    status,
    preparationFingerprint: envelope.preparationFingerprint,
    runId: source.sealedInput.runId,
    chapterRuntimeId: source.sealedInput.chapterRuntimeId,
    sealedInputHash: source.sealedInput.inputHash,
    closeFenceHash: source.closeFence.closeFenceHash,
    sourceHash: source.sourceHash,
  };
}

function sourceDedupeKey(runId: string, chapterRuntimeId: string): string {
  return `pressure-settlement-source:${runId}:${chapterRuntimeId}`;
}

function sourceEventSelect(): Record<string, true> {
  return { id: true, runId: true, type: true, payloadJson: true, dedupeKey: true };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function isHash(value: string): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function missing(label: string, details: Record<string, unknown>): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_NOT_FOUND, `${label} was not found`, details);
}

function fingerprint(
  message: string,
  input: Pick<DurableChapterSettlementSourcePreparationV1, "settlementInput">,
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.FINGERPRINT_MISMATCH, message, {
    runId: input.settlementInput.runId,
    chapterRuntimeId: input.settlementInput.chapterRuntimeId,
  });
}

function fence(
  message: string,
  input: Pick<DurableChapterSettlementSourcePreparationV1, "settlementInput">,
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.AUTHORITY_FENCE_MISMATCH, message, {
    runId: input.settlementInput.runId,
    chapterRuntimeId: input.settlementInput.chapterRuntimeId,
  });
}

function invalid(
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
