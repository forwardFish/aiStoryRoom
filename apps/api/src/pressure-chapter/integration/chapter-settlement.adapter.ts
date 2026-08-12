import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  validateSealedChapterSettlementInputV1,
} from "@ai-story/shared";
import {
  ChapterSettlementOrchestrator,
} from "../chapter-settlement/chapter-settlement.orchestrator";
import {
  computeChapterSettlementRequestFingerprintV1,
  validateAtomicChapterCommitRecordV1,
} from "../chapter-settlement/chapter-commit-record";
import type { ChapterSettlementPort } from "../orchestrator/contracts";
import { failPressureChapterIntegration } from "./errors";

type SettlementRequestV1 = Parameters<ChapterSettlementPort["settle"]>[0];
export type CanonicalChapterSeatParticipationV1 =
  SettlementRequestV1["seatParticipation"];

export interface DurableChapterSettlementSourcePreparationV1 {
  schemaVersion: "pressure_chapter_settlement_preparation_v1";
  routeHash: string;
  settlementInput: SettlementRequestV1["settlementInput"];
  chapterDescriptorHash: string;
  seatParticipation: CanonicalChapterSeatParticipationV1;
  preparationFingerprint: string;
}

export interface DurableChapterSettlementSourcePreparationReceiptV1 {
  schemaVersion: "pressure_chapter_settlement_preparation_receipt_v1";
  status: "PREPARED" | "REPLAYED";
  runId: string;
  chapterRuntimeId: string;
  preparationFingerprint: string;
  sealedInputHash: string;
  closeFenceHash: string;
  sourceHash: string;
}

/**
 * W1 persistence seam. The implementation must CAS the durable chapter into
 * CHAPTER_SETTLING and persist close fence + settlement source atomically.
 * It has no World/Frozen commit authority; that remains solely in W6.
 */
export interface DurableChapterSettlementSourcePreparationPort {
  prepareSource(
    input: Readonly<DurableChapterSettlementSourcePreparationV1>,
  ): Promise<DurableChapterSettlementSourcePreparationReceiptV1>;
}

export function computeDurableChapterSettlementPreparationFingerprintV1(
  input: Readonly<{
    routeHash: string;
    settlementInput: SettlementRequestV1["settlementInput"];
    chapterDescriptorHash: string;
    seatParticipation: SettlementRequestV1["seatParticipation"];
  }>,
): string {
  const settlementInput = validateSealedChapterSettlementInputV1(
    input.settlementInput,
  );
  const seatParticipation = canonicalSeatParticipationV1(
    input.seatParticipation,
  );
  hash(input.routeHash, "preparation.routeHash");
  hash(input.chapterDescriptorHash, "preparation.chapterDescriptorHash");
  if (settlementInput.runRouteHash !== input.routeHash) {
    failPressureChapterIntegration(
      "INTEGRATION_ROUTE_MISMATCH",
      "preparation.settlementInput.runRouteHash",
    );
  }
  return sha256Canonical({
    schemaVersion: "pressure_chapter_settlement_preparation_fingerprint_v1",
    commandType: "PREPARE_CHAPTER_SETTLEMENT_SOURCE",
    runId: settlementInput.runId,
    chapterRuntimeId: settlementInput.chapterRuntimeId,
    chapterId: settlementInput.chapterId,
    routeHash: input.routeHash,
    settlementInputHash: settlementInput.inputHash,
    chapterDescriptorHash: input.chapterDescriptorHash,
    seatParticipation,
  });
}

export function computeChapterSettlementIdempotencyKeyV1(input: Readonly<{
  runId: string;
  chapterRuntimeId: string;
  settlementInputHash: string;
}>): string {
  requiredText(input.runId, "settlement.runId");
  requiredText(input.chapterRuntimeId, "settlement.chapterRuntimeId");
  hash(input.settlementInputHash, "settlement.inputHash");
  return [
    "pressure-chapter-settlement-v1",
    input.runId,
    input.chapterRuntimeId,
    input.settlementInputHash,
  ].join(":");
}

/** W4 command -> durable source -> real W6 unique authority commit. */
export class W4ToW6ChapterSettlementAdapterV1 implements ChapterSettlementPort {
  constructor(
    private readonly preparation: DurableChapterSettlementSourcePreparationPort,
    private readonly orchestrator: ChapterSettlementOrchestrator,
  ) {}

  async settle(
    raw: SettlementRequestV1,
  ): Promise<Awaited<ReturnType<ChapterSettlementPort["settle"]>>> {
    const route = validateRunRouteSnapshotV1(raw.routeSnapshot);
    const settlementInput = validateSealedChapterSettlementInputV1(
      raw.settlementInput,
    );
    hash(raw.chapterDescriptorHash, "settlement.chapterDescriptorHash");
    if (
      settlementInput.runId !== route.runId
      || settlementInput.runRouteHash !== route.routeHash
    ) {
      failPressureChapterIntegration(
        "INTEGRATION_ROUTE_MISMATCH",
        "settlement.route",
      );
    }
    const seatParticipation = canonicalSeatParticipationV1(
      raw.seatParticipation,
    );
    const preparationFingerprint =
      computeDurableChapterSettlementPreparationFingerprintV1({
        routeHash: route.routeHash,
        settlementInput,
        chapterDescriptorHash: raw.chapterDescriptorHash,
        seatParticipation,
      });
    const prepared = await this.preparation.prepareSource({
      schemaVersion: "pressure_chapter_settlement_preparation_v1",
      routeHash: route.routeHash,
      settlementInput,
      chapterDescriptorHash: raw.chapterDescriptorHash,
      seatParticipation,
      preparationFingerprint,
    });
    validatePreparationReceipt(prepared, {
      settlementInput,
      preparationFingerprint,
    });
    const idempotencyKey = computeChapterSettlementIdempotencyKeyV1({
      runId: settlementInput.runId,
      chapterRuntimeId: settlementInput.chapterRuntimeId,
      settlementInputHash: settlementInput.inputHash,
    });
    const requestFingerprint = computeChapterSettlementRequestFingerprintV1({
      runId: settlementInput.runId,
      chapterRuntimeId: settlementInput.chapterRuntimeId,
      idempotencyKey,
      sealedInputHash: settlementInput.inputHash,
    });
    const result = await this.orchestrator.settle({
      authorityTrigger: "CHAPTER_CLOSE",
      runId: settlementInput.runId,
      chapterRuntimeId: settlementInput.chapterRuntimeId,
      idempotencyKey,
      requestFingerprint,
    });
    const record = validateAtomicChapterCommitRecordV1(result.record);
    if (
      record.runId !== settlementInput.runId
      || record.chapterRuntimeId !== settlementInput.chapterRuntimeId
      || record.chapterId !== settlementInput.chapterId
      || record.sealedInput.inputHash !== settlementInput.inputHash
      || record.sealedInput.runRouteHash !== route.routeHash
      || record.sourceHash !== prepared.sourceHash
      || record.commitFence.closeFenceHash !== prepared.closeFenceHash
      || record.requestFingerprint !== requestFingerprint
      || record.idempotencyKey !== idempotencyKey
    ) {
      failPressureChapterIntegration(
        "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
        "settlement.committedRecord",
      );
    }
    return {
      status: result.status === "COMMITTED" ? "SETTLED" : "REPLAYED",
      frozenBundle: structuredClone(record.frozenChapterBundle),
    };
  }
}

export function canonicalSeatParticipationV1(
  raw: SettlementRequestV1["seatParticipation"],
): CanonicalChapterSeatParticipationV1 {
  if (!Array.isArray(raw) || raw.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    invalid("seatParticipation", "EXACT_SIX_SEATS");
  }
  const bySeat = new Map(raw.map((item) => [item.seatId, item]));
  if (bySeat.size !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    invalid("seatParticipation", "DUPLICATE_OR_MISSING_SEAT");
  }
  return PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const item = bySeat.get(seatId);
    if (!item) invalid(`seatParticipation.${seatId}`, "MISSING");
    const defaultCodes = [...new Set(item.defaultCodes.map((value, index) => {
      requiredText(value, `seatParticipation.${seatId}.defaultCodes[${index}]`);
      return value;
    }))].sort(compareCanonicalText);
    if (item.requirement === "NOT_REQUIRED") {
      if (item.completion !== "NOT_REQUIRED" || defaultCodes.length !== 0) {
        invalid(`seatParticipation.${seatId}`, "NOT_REQUIRED_SHAPE");
      }
    } else if (item.requirement === "REQUIRED") {
      if (item.completion === "NOT_REQUIRED") {
        invalid(`seatParticipation.${seatId}`, "REQUIRED_COMPLETION");
      }
      if (
        (item.completion === "DEFAULTED" || item.completion === "MIXED_ACTIONS")
        && defaultCodes.length === 0
      ) {
        invalid(`seatParticipation.${seatId}.defaultCodes`, "NON_EMPTY_REQUIRED");
      }
      if (item.completion === "SEALED_ACTIONS" && defaultCodes.length !== 0) {
        invalid(`seatParticipation.${seatId}.defaultCodes`, "EMPTY_REQUIRED");
      }
    } else {
      invalid(`seatParticipation.${seatId}.requirement`, "ENUM");
    }
    return {
      seatId,
      requirement: item.requirement,
      completion: item.completion,
      defaultCodes,
    };
  });
}

function validatePreparationReceipt(
  receipt: DurableChapterSettlementSourcePreparationReceiptV1,
  expected: Readonly<{
    settlementInput: SettlementRequestV1["settlementInput"];
    preparationFingerprint: string;
  }>,
): void {
  if (
    receipt.schemaVersion !== "pressure_chapter_settlement_preparation_receipt_v1"
    || !["PREPARED", "REPLAYED"].includes(receipt.status)
    || receipt.runId !== expected.settlementInput.runId
    || receipt.chapterRuntimeId !== expected.settlementInput.chapterRuntimeId
    || receipt.preparationFingerprint !== expected.preparationFingerprint
    || receipt.sealedInputHash !== expected.settlementInput.inputHash
  ) {
    failPressureChapterIntegration(
      "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
      "settlement.preparationReceipt",
    );
  }
  hash(receipt.closeFenceHash, "settlement.preparationReceipt.closeFenceHash");
  hash(receipt.sourceHash, "settlement.preparationReceipt.sourceHash");
}

function hash(value: string, path: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) invalid(path, "SHA256_LOWER_HEX");
}

function requiredText(value: string, path: string): void {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
}

function invalid(path: string, detail?: string): never {
  return failPressureChapterIntegration(
    "INTEGRATION_INPUT_INVALID",
    path,
    detail,
  );
}
