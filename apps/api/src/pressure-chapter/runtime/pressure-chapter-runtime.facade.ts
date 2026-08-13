import {
  isSha256,
  validateReplayCreationReceiptV1,
  validateRunRouteSnapshotV1,
  validateSangtianPressureResultEnvelopeV1,
  type ReplayCreationReceiptV1,
  type RunRouteSnapshotV1,
  type SangtianPressureResultEnvelopeV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  validateCommittedGenesis,
} from "../genesis/genesis.service";
import type { InitializeGenesisResultV1 } from "../genesis/types";
import type {
  ChapterOrchestratorStateV1,
  CommittedSettlementResumeAuthorityV1,
  SubmitOrchestratedActionCommandV1,
} from "../orchestrator/contracts";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import type { FinalizeN7PressureRunCommandV1 } from "../finale/finale-application.service";
import {
  validateAuthorityFirstTerminalRecordV1,
  type FinalizePressureRunResultV1,
} from "../terminal-commit";
import type { NarrativeOutboxConsumeResultV1 } from "../narrative/ports";
import type { PressureResultQueryV1 } from "../result/result-query.service";
import {
  PRESSURE_CHAPTER_RUNTIME_ERROR_CODES as ERROR,
  failPressureChapterRuntime,
} from "./errors";
import type {
  InitializePressureChapterRunCommandV1,
  InitializePressureChapterRunResultV1,
  OpenPressureN1FromGenesisHandoffCommandV1,
  OpenPressureN1FromGenesisHandoffResultV1,
  PersistedGenesisN1HandoffV1,
  PressureChapterRuntimeDependenciesV1,
} from "./contracts";
import { buildGenesisOpenN1OutboxDedupeKeyV1 } from "./contracts";

/**
 * One stateless facade over the Pressure chapter feature. It owns no game data,
 * clock, policy, Provider or persistence capability. Every mutation is delegated
 * to exactly one existing authority boundary.
 */
export class PressureChapterRuntimeFacade {
  constructor(private readonly ports: PressureChapterRuntimeDependenciesV1) {}

  async initializeRun(
    command: Readonly<InitializePressureChapterRunCommandV1>,
  ): Promise<InitializePressureChapterRunResultV1> {
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    assertRunId(command.genesis.runId, route.runId, "command.genesis.runId");
    const genesis = await this.ports.genesis.initialize(command.genesis);
    const committed = validateCommittedGenesis(genesis.committed);
    assertRunId(committed.record.runId, route.runId, "genesis.record.runId");
    if (committed.record.snapshot.routeHash !== route.routeHash) {
      mismatch("genesis.record.snapshot.routeHash", route.routeHash);
    }
    return {
      genesis: cloneGenesisResult(genesis, committed),
      handoff: buildPersistedGenesisN1Handoff(committed),
    };
  }

  async openN1FromGenesisHandoff(
    command: Readonly<OpenPressureN1FromGenesisHandoffCommandV1>,
  ): Promise<OpenPressureN1FromGenesisHandoffResultV1> {
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    const genesis = validateCommittedGenesis(command.genesis);
    assertGenesisRouteBinding(genesis, route);
    const handoff = assertPersistedGenesisN1Handoff(command.handoff, genesis);
    assertRequiredText(command.idempotencyKey, "command.idempotencyKey");
    assertSha256(command.requestFingerprint, "command.requestFingerprint");
    assertNow(command.nowMs, "command.nowMs");

    const result = await this.ports.genesisN1Handoff.openFromGenesisHandoff({
      routeSnapshot: route,
      genesis: structuredClone(genesis),
      handoff,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: command.requestFingerprint,
      nowMs: command.nowMs,
    });
    if (!result || (result.status !== "OPENED" && result.status !== "REPLAYED")) {
      invalidDependency("genesisN1Handoff.status");
    }
    if (result.sourceTaskType !== "OPEN_CHAPTER") {
      invalidDependency("genesisN1Handoff.sourceTaskType");
    }
    if (result.sourceAuthority !== "GENESIS_FROZEN") {
      invalidDependency("genesisN1Handoff.sourceAuthority");
    }
    if (result.sourceDedupeKey !== handoff.outboxDedupeKey) {
      invalidDependency("genesisN1Handoff.sourceDedupeKey");
    }
    if (result.sourceCommitHash !== handoff.sourceCommitHash) {
      invalidDependency("genesisN1Handoff.sourceCommitHash");
    }
    if (result.outboxStatus !== "ACKNOWLEDGED") {
      invalidDependency("genesisN1Handoff.outboxStatus");
    }
    return {
      status: result.status,
      sourceTaskType: "OPEN_CHAPTER",
      sourceAuthority: "GENESIS_FROZEN",
      sourceDedupeKey: result.sourceDedupeKey,
      sourceCommitHash: result.sourceCommitHash,
      outboxStatus: "ACKNOWLEDGED",
      chapter: assertChapterState(result.chapter, route),
    };
  }

  async resume(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(routeSnapshot);
    return assertChapterState(
      await this.ports.chapters.resume(route, nowMs),
      route,
    );
  }

  async resumeFromCommittedSettlementAuthority(
    routeSnapshot: RunRouteSnapshotV1,
    authority: Readonly<CommittedSettlementResumeAuthorityV1>,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(routeSnapshot);
    const fastResume = this.ports.chapters.resumeFromCommittedSettlementAuthority;
    if (!fastResume) return this.resume(route, nowMs);
    return assertChapterState(
      await fastResume.call(this.ports.chapters, route, authority, nowMs),
      route,
    );
  }

  async submitAction(
    command: SubmitOrchestratedActionCommandV1,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    return assertChapterState(
      await this.ports.chapters.submitAction({ ...command, routeSnapshot: route }),
      route,
    );
  }

  async advanceDeadline(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(routeSnapshot);
    return assertChapterState(
      await this.ports.chapters.advanceDeadline(route, nowMs),
      route,
    );
  }

  async applyAiFailure(
    routeSnapshot: RunRouteSnapshotV1,
    seatId: SeatIdV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(routeSnapshot);
    return assertChapterState(
      await this.ports.chapters.applyAiFailure(route, seatId, nowMs),
      route,
    );
  }

  async finalize(
    command: Readonly<FinalizeN7PressureRunCommandV1>,
  ): Promise<FinalizePressureRunResultV1> {
    const result = await this.ports.finale.finalize(command);
    const record = validateAuthorityFirstTerminalRecordV1(result.record);
    assertRunId(record.runId, command.runId, "finale.record.runId");
    if (record.idempotencyKey !== command.idempotencyKey) {
      mismatch("finale.record.idempotencyKey", command.idempotencyKey);
    }
    if (record.requestFingerprint !== command.requestFingerprint) {
      mismatch("finale.record.requestFingerprint", command.requestFingerprint);
    }
    return structuredClone({ ...result, record });
  }

  async getResult(
    query: Readonly<PressureResultQueryV1>,
  ): Promise<SangtianPressureResultEnvelopeV1> {
    const envelope = validateSangtianPressureResultEnvelopeV1(
      await this.ports.result.getResult(query),
    );
    assertRunId(envelope.runId, query.runId, "result.runId");
    return structuredClone(envelope);
  }

  async consumeNarrative(
    workerId: string,
  ): Promise<NarrativeOutboxConsumeResultV1> {
    return structuredClone(await this.ports.narrative.consumeNext(workerId));
  }

  async replay(
    viewerId: string,
    command: unknown,
  ): Promise<ReplayCreationReceiptV1> {
    const receipt = validateReplayCreationReceiptV1(
      await this.ports.replay.execute(viewerId, command),
    );
    const sourceRunId = readSourceRunId(command);
    assertRunId(receipt.sourceRunId, sourceRunId, "replayReceipt.sourceRunId");
    return structuredClone(receipt);
  }
}

function buildPersistedGenesisN1Handoff(
  committed: InitializeGenesisResultV1["committed"],
): PersistedGenesisN1HandoffV1 {
  const runId = committed.record.runId;
  const genesisHash = committed.record.snapshot.genesisHash;
  const sourceCommitHash = committed.record.commit.commitHash;
  return {
    schemaVersion: "pressure_genesis_n1_handoff_v1",
    taskType: "OPEN_CHAPTER",
    checkpoint: "PERSISTED",
    sourceAuthority: "GENESIS_FROZEN",
    runId,
    chapterId: "N1",
    genesisHash,
    sourceCommitHash,
    outboxDedupeKey: buildGenesisOpenN1OutboxDedupeKeyV1(
      runId,
      sourceCommitHash,
    ),
  };
}

function assertGenesisRouteBinding(
  genesis: InitializeGenesisResultV1["committed"],
  route: RunRouteSnapshotV1,
): void {
  assertRunId(genesis.record.runId, route.runId, "command.genesis.record.runId");
  if (genesis.record.snapshot.routeHash !== route.routeHash) {
    mismatch("command.genesis.record.snapshot.routeHash", route.routeHash);
  }
}

function assertPersistedGenesisN1Handoff(
  value: PersistedGenesisN1HandoffV1,
  genesis: InitializeGenesisResultV1["committed"],
): PersistedGenesisN1HandoffV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPressureChapterRuntime(
      ERROR.CONTEXT_MISMATCH,
      "command.handoff",
      "OBJECT",
    );
  }
  const expected = buildPersistedGenesisN1Handoff(genesis);
  for (const key of Object.keys(expected) as (keyof PersistedGenesisN1HandoffV1)[]) {
    if (value[key] !== expected[key]) {
      mismatch(`command.handoff.${key}`, String(expected[key]));
    }
  }
  return structuredClone(expected);
}

function assertChapterState(
  value: ChapterOrchestratorStateV1,
  route: RunRouteSnapshotV1,
): ChapterOrchestratorStateV1 {
  const state = validateOrchestratorStateV1(value);
  assertRunId(state.runId, route.runId, "chapter.runId");
  if (state.routeHash !== route.routeHash) {
    mismatch("chapter.routeHash", route.routeHash);
  }
  return structuredClone(state);
}

function cloneGenesisResult(
  result: InitializeGenesisResultV1,
  committed: InitializeGenesisResultV1["committed"],
): InitializeGenesisResultV1 {
  if (result.status !== "COMMITTED" && result.status !== "REPLAYED") {
    failPressureChapterRuntime(
      ERROR.DEPENDENCY_RESULT_INVALID,
      "genesis.status",
    );
  }
  return { status: result.status, committed: structuredClone(committed) };
}

function readSourceRunId(command: unknown): string {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    failPressureChapterRuntime(ERROR.CONTEXT_MISMATCH, "replayCommand", "OBJECT");
  }
  const sourceRunId = (command as Record<string, unknown>).sourceRunId;
  if (typeof sourceRunId !== "string" || sourceRunId.trim().length === 0) {
    failPressureChapterRuntime(
      ERROR.CONTEXT_MISMATCH,
      "replayCommand.sourceRunId",
      "NON_EMPTY_STRING",
    );
  }
  return sourceRunId;
}

function assertRunId(actual: string, expected: string, path: string): void {
  if (actual !== expected) mismatch(path, expected);
}

function assertRequiredText(value: string, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    failPressureChapterRuntime(ERROR.CONTEXT_MISMATCH, path, "NON_EMPTY_STRING");
  }
}

function assertSha256(value: string, path: string): void {
  if (!isSha256(value)) {
    failPressureChapterRuntime(ERROR.CONTEXT_MISMATCH, path, "SHA256");
  }
}

function assertNow(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    failPressureChapterRuntime(ERROR.CONTEXT_MISMATCH, path, "NON_NEGATIVE_SAFE_INTEGER");
  }
}

function invalidDependency(path: string): never {
  return failPressureChapterRuntime(ERROR.DEPENDENCY_RESULT_INVALID, path);
}

function mismatch(path: string, expected: string): never {
  return failPressureChapterRuntime(
    ERROR.CONTEXT_MISMATCH,
    path,
    `EXPECTED_${expected}`,
  );
}
