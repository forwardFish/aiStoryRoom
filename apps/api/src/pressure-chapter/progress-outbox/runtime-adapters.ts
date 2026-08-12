import {
  chapterSequence,
  isSha256,
  type ChapterIdV1,
  type RunRouteSnapshotV1,
} from "@ai-story/shared";
import type { AssembledN7FinaleInputV1 } from "../finale/assembler";
import type { PressureChapterRuntimeFacade } from "../runtime/pressure-chapter-runtime.facade";
import type { StoredRunRouteReaderPort } from "../run-router";
import {
  PRESSURE_PROGRESS_OUTBOX_ERROR_CODES as ERROR,
  PressureProgressOutboxError,
} from "./errors";
import type {
  ProgressComputeFinaleHandoffV1,
  ProgressOpenChapterHandoffV1,
  RuntimeProgressFinalePortV1,
  RuntimeProgressOpenChapterPortV1,
} from "./ports";

export interface ProgressChapterHandoffAuthorityPortV1 {
  verifyCommittedSource(input: Readonly<{
    runId: string;
    chapterRuntimeId: string;
    sourceBundleHash: string;
    sourceCommitHash: string;
  }>): Promise<boolean>;
  readChapterRuntime(input: Readonly<{
    runId: string;
    chapterId: Exclude<ChapterIdV1, "N1">;
  }>): Promise<Readonly<{
    chapterRuntimeId: string;
    routeHash: string;
    previousFrozenHash: string;
  }> | null>;
}

export interface ProgressN7FinaleAssemblerPortV1 {
  assemble(runId: string): Promise<AssembledN7FinaleInputV1>;
}

type ProgressRuntimePortV1 = Pick<
  PressureChapterRuntimeFacade,
  "resume" | "finalize"
>;

/**
 * Durable W6 OPEN_CHAPTER handoff adapter.
 *
 * The chapter orchestrator may already have opened the next chapter before the
 * outbox row is claimed. The immutable target runtime is therefore checked
 * before and after resume; a crash-after-open replay reports REPLAYED without
 * creating a second chapter runtime.
 */
export class RuntimeProgressOpenChapterAdapterV1
implements RuntimeProgressOpenChapterPortV1 {
  constructor(
    private readonly routes: StoredRunRouteReaderPort,
    private readonly authority: ProgressChapterHandoffAuthorityPortV1,
    private readonly runtime: ProgressRuntimePortV1,
  ) {}

  async openNextChapter(request: Readonly<{
    handoff: Readonly<ProgressOpenChapterHandoffV1>;
    workerId: string;
    nowMs: number;
  }>) {
    const handoff = validateOpenHandoff(request.handoff);
    requiredText(request.workerId, "workerId");
    safeMs(request.nowMs, "nowMs");
    await this.assertCommittedSource(handoff);
    const route = await this.readBoundRoute(handoff.runId);
    const prior = await this.readBoundTarget(handoff, route);
    if (prior) {
      return {
        status: "REPLAYED" as const,
        chapterId: handoff.targetChapterId,
        chapterRuntimeId: prior.chapterRuntimeId,
      };
    }

    await this.runtime.resume(route, request.nowMs);
    const opened = await this.readBoundTarget(handoff, route);
    if (!opened) {
      invalid("runtime.resume", "TARGET_CHAPTER_NOT_DURABLE");
    }
    return {
      status: "OPENED" as const,
      chapterId: handoff.targetChapterId,
      chapterRuntimeId: opened.chapterRuntimeId,
    };
  }

  private async assertCommittedSource(
    handoff: Readonly<ProgressOpenChapterHandoffV1>,
  ): Promise<void> {
    const verified = await this.authority.verifyCommittedSource({
      runId: handoff.runId,
      chapterRuntimeId: handoff.previousChapterRuntimeId,
      sourceBundleHash: handoff.sourceBundleHash,
      sourceCommitHash: handoff.sourceCommitHash,
    });
    if (verified !== true) invalid("handoff", "COMMITTED_SOURCE_MISMATCH");
  }

  private async readBoundRoute(runId: string): Promise<RunRouteSnapshotV1> {
    const stored = await this.routes.readStoredRoute(runId);
    if (!stored || stored.runId !== runId || stored.snapshot.runId !== runId) {
      invalid("route", "RUN_BINDING_MISMATCH");
    }
    return structuredClone(stored.snapshot);
  }

  private async readBoundTarget(
    handoff: Readonly<ProgressOpenChapterHandoffV1>,
    route: Readonly<RunRouteSnapshotV1>,
  ) {
    const target = await this.authority.readChapterRuntime({
      runId: handoff.runId,
      chapterId: handoff.targetChapterId,
    });
    if (!target) return null;
    if (
      !target.chapterRuntimeId.trim()
      || target.routeHash !== route.routeHash
      || target.previousFrozenHash !== handoff.sourceBundleHash
    ) {
      invalid("targetChapter", "AUTHORITY_BINDING_MISMATCH");
    }
    return target;
  }
}

/** Drives the unique N7 Finale only from an exact committed handoff. */
export class RuntimeProgressFinaleAdapterV1
implements RuntimeProgressFinalePortV1 {
  constructor(
    private readonly routes: StoredRunRouteReaderPort,
    private readonly authority: ProgressChapterHandoffAuthorityPortV1,
    private readonly assembler: ProgressN7FinaleAssemblerPortV1,
    private readonly runtime: ProgressRuntimePortV1,
  ) {}

  async computeFinale(request: Readonly<{
    handoff: Readonly<ProgressComputeFinaleHandoffV1>;
    workerId: string;
    nowMs: number;
  }>) {
    const handoff = validateFinaleHandoff(request.handoff);
    requiredText(request.workerId, "workerId");
    safeMs(request.nowMs, "nowMs");
    const sourceVerified = await this.authority.verifyCommittedSource({
      runId: handoff.runId,
      chapterRuntimeId: handoff.terminalChapterRuntimeId,
      sourceBundleHash: handoff.sourceBundleHash,
      sourceCommitHash: handoff.sourceCommitHash,
    });
    if (sourceVerified !== true) invalid("handoff", "COMMITTED_SOURCE_MISMATCH");

    const stored = await this.routes.readStoredRoute(handoff.runId);
    if (!stored || stored.runId !== handoff.runId) {
      invalid("route", "RUN_BINDING_MISMATCH");
    }
    const assembled = await this.assembler.assemble(handoff.runId);
    const terminalBundle = assembled.source.frozenChapterBundles.at(-1);
    if (
      assembled.source.runId !== handoff.runId
      || assembled.source.routeHash !== stored.snapshot.routeHash
      || assembled.source.terminalChapterId !== "N7"
      || assembled.source.terminalWorldSequence !== 7
      || terminalBundle?.chapterId !== "N7"
      || terminalBundle.bundleHash !== handoff.sourceBundleHash
    ) {
      invalid("finaleSource", "N7_HANDOFF_BINDING_MISMATCH");
    }

    const result = await this.runtime.finalize({
      runId: handoff.runId,
      idempotencyKey: finaleIdempotencyKey(handoff),
      requestFingerprint: assembled.source.sourceFingerprint,
    });
    return {
      status: result.status,
      runId: handoff.runId,
      authorityCommitHash: result.record.authorityCommitHash,
    };
  }
}

export function finaleIdempotencyKey(
  handoff: Readonly<ProgressComputeFinaleHandoffV1>,
): string {
  return `pressure-finale:${handoff.runId}:${handoff.sourceBundleHash}`;
}

function validateOpenHandoff(
  value: Readonly<ProgressOpenChapterHandoffV1>,
): ProgressOpenChapterHandoffV1 {
  if (!value || value.sourceAuthority !== "CHAPTER_FROZEN") {
    invalid("handoff.sourceAuthority", "EXPECTED_CHAPTER_FROZEN");
  }
  validateCommonHandoff(value);
  requiredText(value.previousChapterRuntimeId, "handoff.previousChapterRuntimeId");
  if (chapterSequence(value.targetChapterId) < 2) {
    invalid("handoff.targetChapterId", "EXPECTED_N2_TO_N7");
  }
  return structuredClone(value);
}

function validateFinaleHandoff(
  value: Readonly<ProgressComputeFinaleHandoffV1>,
): ProgressComputeFinaleHandoffV1 {
  if (!value || value.sourceAuthority !== "CHAPTER_FROZEN") {
    invalid("handoff.sourceAuthority", "EXPECTED_CHAPTER_FROZEN");
  }
  validateCommonHandoff(value);
  requiredText(value.terminalChapterRuntimeId, "handoff.terminalChapterRuntimeId");
  return structuredClone(value);
}

function validateCommonHandoff(value: {
  runId: string;
  outboxDedupeKey: string;
  sourceBundleHash: string;
  sourceCommitHash: string;
}): void {
  requiredText(value.runId, "handoff.runId");
  requiredText(value.outboxDedupeKey, "handoff.outboxDedupeKey");
  hash(value.sourceBundleHash, "handoff.sourceBundleHash");
  hash(value.sourceCommitHash, "handoff.sourceCommitHash");
}

function requiredText(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
}

function hash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) invalid(path, "SHA256");
}

function safeMs(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path, "SAFE_MILLISECONDS");
}

function invalid(path: string, detail: string): never {
  throw new PressureProgressOutboxError(
    ERROR.DEPENDENCY_RESULT_INVALID,
    `Pressure progress runtime adapter rejected ${path}: ${detail}`,
    { path, detail },
  );
}
