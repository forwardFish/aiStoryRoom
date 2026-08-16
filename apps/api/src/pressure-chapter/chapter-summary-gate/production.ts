import { sha256Canonical, type SeatIdV1 } from "@ai-story/shared";
import type { PressureGameChapterSummaryReaderPort } from "../game-projection";
import type { PressureViewerStoryPackV1 } from "../production-config/viewer-story-pack";
import {
  PressureOneCallStoryGeneratorV1,
  type PressureChapterSummaryAuthorityV1,
  type PressureGeneratedChapterSummaryV1,
} from "../story-generation";

export const PRESSURE_CHAPTER_SUMMARY_EVENT_TYPES_V2 = Object.freeze({
  SUMMARY: "PRESSURE_CHAPTER_SUMMARY_V2",
  CONFIRMATION: "PRESSURE_CHAPTER_SUMMARY_CONFIRMATION_V2",
} as const);

export interface PressureChapterSummaryIdentityV2 {
  runId: string;
  routeHash: string;
  chapterRuntimeId: string;
  chapterId: string;
  viewerSeatId: SeatIdV1;
}

export interface PressureChapterSummaryConfirmationCommandV2
extends PressureChapterSummaryIdentityV2 {
  controlEpoch: number;
  expectedWorkingRevision: number;
  submissionFenceToken: string;
  idempotencyKey: string;
}

export interface PressureChapterSummaryProductionV2 {
  mode: "PRISMA_STORY_EVENT_V2";
  reader: PressureGameChapterSummaryReaderPort;
  commandHandler: { handle(input: PressureChapterSummaryConfirmationCommandV2): Promise<unknown> };
  coordinator: PressureChapterSummaryProductionCoordinatorV2;
}

type PrismaLike = {
  storyEvent: {
    findUnique(input: unknown): Promise<{ payloadJson: unknown } | null>;
    create(input: unknown): Promise<unknown>;
    update(input: unknown): Promise<unknown>;
  };
  pressureChapterRuntime?: { findUnique?(input: unknown): Promise<unknown> };
  pressureChapterSettlement?: { findFirst?(input: unknown): Promise<unknown> };
  pressureDecisionAction?: { findMany?(input: unknown): Promise<unknown[]> };
};

/**
 * Settlement remains the only chapter-progression authority. This module only
 * hides the already-open next runtime until one viewer confirms the previous
 * chapter's durable summary.
 */
export function createPrismaPressureChapterSummaryProductionV2(input: Readonly<{
  prisma: PrismaLike;
  generator: PressureOneCallStoryGeneratorV1;
  now?: () => Date;
}>): PressureChapterSummaryProductionV2 {
  const store = new PrismaPressureChapterSummaryStoryEventStoreV2(input.prisma, input.now);
  const coordinator = new PressureChapterSummaryProductionCoordinatorV2({
    prisma: input.prisma,
    generator: input.generator,
    store,
  });
  return {
    mode: "PRISMA_STORY_EVENT_V2",
    reader: { readCurrent: (scope) => coordinator.readCurrent(scope) },
    commandHandler: { handle: (command) => coordinator.confirm(command) },
    coordinator,
  };
}

export class PrismaPressureChapterSummaryStoryEventStoreV2 {
  constructor(
    private readonly prisma: PrismaLike,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readSummary(identity: PressureChapterSummaryIdentityV2): Promise<Record<string, unknown> | null> {
    return this.readPayload(summaryKey(identity));
  }

  async claimSummary(identity: PressureChapterSummaryIdentityV2): Promise<{ owner: boolean; payload: Record<string, unknown> }> {
    const key = summaryKey(identity);
    const existing = await this.readPayload(key);
    if (existing) return { owner: false, payload: existing };
    const payload = {
      schemaVersion: "pressure_chapter_summary_story_event_v2",
      status: "GENERATING",
      identity,
      startedAt: this.now().toISOString(),
    };
    try {
      await this.prisma.storyEvent.create({
        data: eventData(identity, key, PRESSURE_CHAPTER_SUMMARY_EVENT_TYPES_V2.SUMMARY, payload),
      });
      return { owner: true, payload };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await this.readPayload(key);
      if (!raced) throw error;
      return { owner: false, payload: raced };
    }
  }

  async publishSummary(
    identity: PressureChapterSummaryIdentityV2,
    summary: PressureGeneratedChapterSummaryV1,
  ): Promise<void> {
    await this.prisma.storyEvent.update({
      where: { dedupeKey: summaryKey(identity) },
      data: {
        type: PRESSURE_CHAPTER_SUMMARY_EVENT_TYPES_V2.SUMMARY,
        payloadJson: {
          schemaVersion: "pressure_chapter_summary_story_event_v2",
          status: "PUBLISHED",
          identity,
          summary,
          publishedAt: this.now().toISOString(),
        },
      },
    });
  }

  async ensureConfirmation(identity: PressureChapterSummaryIdentityV2, idempotencyKey: string): Promise<void> {
    const key = confirmationKey(identity);
    try {
      await this.prisma.storyEvent.create({
        data: eventData(identity, key, PRESSURE_CHAPTER_SUMMARY_EVENT_TYPES_V2.CONFIRMATION, {
          schemaVersion: "pressure_chapter_summary_confirmation_event_v2",
          identity,
          idempotencyKey,
          confirmedAt: this.now().toISOString(),
        }),
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
    }
  }

  async hasConfirmation(identity: PressureChapterSummaryIdentityV2): Promise<boolean> {
    return (await this.readPayload(confirmationKey(identity))) !== null;
  }

  private async readPayload(dedupeKey: string): Promise<Record<string, unknown> | null> {
    const event = await this.prisma.storyEvent.findUnique({ where: { dedupeKey } });
    return recordOrNull(event?.payloadJson);
  }
}

export class PressureChapterSummaryProductionCoordinatorV2 {
  constructor(private readonly dependencies: Readonly<{
    prisma: PrismaLike;
    generator: PressureOneCallStoryGeneratorV1;
    store: PrismaPressureChapterSummaryStoryEventStoreV2;
  }>) {}

  async readCurrent(
    scope: Parameters<PressureGameChapterSummaryReaderPort["readCurrent"]>[0],
  ): ReturnType<PressureGameChapterSummaryReaderPort["readCurrent"]> {
    const identity = await this.resolveLatestSettledIdentity(scope);
    if (!identity || await this.dependencies.store.hasConfirmation(identity)) return null;
    const summary = await this.readOrPublish(identity);
    return summary ? projectSource(identity, summary) : null;
  }

  async readOrPublish(identity: PressureChapterSummaryIdentityV2): Promise<PressureGeneratedChapterSummaryV1 | null> {
    assertIdentity(identity);
    const existing = await this.dependencies.store.readSummary(identity);
    if (existing?.status === "PUBLISHED") return publishedSummary(existing);
    if (existing?.status === "GENERATING") return null;
    const inputs = await this.loadGenerationInputs(identity);
    if (!inputs) return null;
    const claim = await this.dependencies.store.claimSummary(identity);
    if (!claim.owner) return claim.payload.status === "PUBLISHED" ? publishedSummary(claim.payload) : null;
    const generated = await this.dependencies.generator.generate({
      mode: "CHAPTER_SUMMARY",
      storyPack: inputs.storyPack,
      summaryAuthority: inputs.summaryAuthority,
    });
    if (generated.mode !== "CHAPTER_SUMMARY") throw new Error("PRESSURE_CHAPTER_SUMMARY_GENERATION_MODE_MISMATCH");
    await this.dependencies.store.publishSummary(identity, generated);
    return generated;
  }

  async confirm(command: PressureChapterSummaryConfirmationCommandV2): Promise<{
    schemaVersion: "pressure_chapter_summary_confirmation_response_v2";
    accepted: true;
    idempotencyKey: string;
  }> {
    assertIdentity(command);
    const latest = await this.resolveLatestSettledIdentity(command);
    if (
      !latest
      || latest.chapterRuntimeId !== command.chapterRuntimeId
      || latest.chapterId !== command.chapterId
    ) {
      throw new Error("PRESSURE_CHAPTER_SUMMARY_CONFIRMATION_SOURCE_MISMATCH");
    }
    if (!(await this.readOrPublish(command))) throw new Error("PRESSURE_CHAPTER_SUMMARY_NOT_READY");
    await this.dependencies.store.ensureConfirmation(command, command.idempotencyKey);
    return {
      schemaVersion: "pressure_chapter_summary_confirmation_response_v2",
      accepted: true,
      idempotencyKey: command.idempotencyKey,
    };
  }

  private async resolveLatestSettledIdentity(
    scope: Parameters<PressureGameChapterSummaryReaderPort["readCurrent"]>[0],
  ): Promise<PressureChapterSummaryIdentityV2 | null> {
    const settlement = recordOrNull(await this.dependencies.prisma.pressureChapterSettlement?.findFirst?.({
      where: { runId: scope.runId },
      orderBy: [{ chapterSequence: "desc" }, { committedAt: "desc" }],
    }));
    if (!settlement) return null;
    return {
      runId: scope.runId,
      routeHash: scope.routeHash,
      chapterRuntimeId: nonEmpty(settlement.chapterRuntimeId, "settlement.chapterRuntimeId"),
      chapterId: nonEmpty(settlement.chapterId, "settlement.chapterId"),
      viewerSeatId: scope.viewerSeatId,
    };
  }

  private async loadGenerationInputs(identity: PressureChapterSummaryIdentityV2): Promise<{
    storyPack: PressureViewerStoryPackV1;
    summaryAuthority: PressureChapterSummaryAuthorityV1;
  } | null> {
    const settlement = recordOrNull(await this.dependencies.prisma.pressureChapterSettlement?.findFirst?.({
      where: { runId: identity.runId, chapterRuntimeId: identity.chapterRuntimeId },
    }));
    if (!settlement || settlement.chapterId !== identity.chapterId) return null;
    const runtime = recordOrNull(await this.dependencies.prisma.pressureChapterRuntime?.findUnique?.({
      where: { id: identity.chapterRuntimeId },
    }));
    const actions = await this.dependencies.prisma.pressureDecisionAction?.findMany?.({
      where: {
        runId: identity.runId,
        chapterRuntimeId: identity.chapterRuntimeId,
        seatId: identity.viewerSeatId,
        status: "SEALED",
      },
      orderBy: [{ actionOrdinal: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }) ?? [];
    const summaryAuthority = buildSummaryAuthority(identity, runtime, settlement, actions);
    return { summaryAuthority, storyPack: buildSummaryStoryPack(identity, summaryAuthority) };
  }
}

export function isPressureChapterSummaryConfirmationCommandV2(value: unknown): boolean {
  const command = recordOrNull(value);
  return command?.schemaVersion === "pressure_chapter_game_command_v1"
    && command.commandType === "CONFIRM_CHAPTER_SUMMARY";
}

export function normalizePressureChapterSummaryConfirmationCommandV2(
  value: unknown,
): PressureChapterSummaryConfirmationCommandV2 {
  const command = recordOrNull(value);
  if (!command || !isPressureChapterSummaryConfirmationCommandV2(command)) {
    throw new Error("PRESSURE_CHAPTER_SUMMARY_CONFIRMATION_COMMAND_INVALID");
  }
  const allowed = new Set([
    "schemaVersion", "commandType", "runId", "routeHash", "chapterRuntimeId", "chapterId", "seatId",
    "controlEpoch", "expectedWorkingRevision", "submissionFenceToken", "idempotencyKey",
  ]);
  const unknown = Object.keys(command).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`PRESSURE_CHAPTER_SUMMARY_CONFIRMATION_COMMAND_UNKNOWN_FIELD:${unknown}`);
  return {
    runId: nonEmpty(command.runId, "runId"),
    routeHash: digest(command.routeHash, "routeHash"),
    chapterRuntimeId: nonEmpty(command.chapterRuntimeId, "chapterRuntimeId"),
    chapterId: nonEmpty(command.chapterId, "chapterId"),
    viewerSeatId: nonEmpty(command.seatId, "seatId") as SeatIdV1,
    controlEpoch: integer(command.controlEpoch, "controlEpoch"),
    expectedWorkingRevision: integer(command.expectedWorkingRevision, "expectedWorkingRevision"),
    submissionFenceToken: nonEmpty(command.submissionFenceToken, "submissionFenceToken"),
    idempotencyKey: nonEmpty(command.idempotencyKey, "idempotencyKey"),
  };
}

function buildSummaryAuthority(
  identity: PressureChapterSummaryIdentityV2,
  runtime: Record<string, unknown> | null,
  settlement: Record<string, unknown>,
  actions: unknown[],
): PressureChapterSummaryAuthorityV1 {
  const sources = [settlement.evaluationJson, settlement.worldDeltaJson, settlement.commitManifestJson];
  const resultText = firstDeepText(sources, ["summary", "closingNarrative", "narrative", "resultText"])
    ?? `第${chapterNumber(identity.chapterId)}章的行动已经完成权威结算，结果与代价均已写入本局记录。`;
  const playerActions = actions.map((item, index) => {
    const action = recordOrNull(item) ?? {};
    return {
      actionId: String(action.id ?? `action-${index + 1}`),
      text: firstDeepText([action.payloadJson, action], ["summary", "actionEcho", "customText", "label", "actionType"])
        ?? "已提交一项正式行动。",
    };
  });
  const completed = firstDeepList(sources, ["completedObjectives", "completed", "achievedObjectives"]);
  const incomplete = firstDeepList(sources, ["incompleteObjectives", "incomplete", "unresolvedObjectives"]);
  const pressures = firstDeepList(sources, ["remainingPressures", "carryForward", "unresolvedPressures"]);
  const nextChapterId = nextChapterIdOf(identity.chapterId);
  return {
    chapterId: identity.chapterId,
    title: firstDeepText([runtime?.decisionStateJson, runtime], ["title", "chapterTitle"]) ?? identity.chapterId,
    sourceCommitHash: digest(settlement.commitHash ?? settlement.frozenBundleHash, "settlement.commitHash"),
    closingNarrativeFallback: resultText,
    playerActions,
    actualResults: [{ resultRef: "settlement.result", text: resultText }],
    completedObjectives: completed.map((text, index) => ({ objectiveRef: `objective.completed.${index + 1}`, text })),
    incompleteObjectives: incomplete.map((text, index) => ({ objectiveRef: `objective.incomplete.${index + 1}`, text })),
    metricChanges: collectMetricChanges(sources),
    remainingPressures: pressures.map((text, index) => ({ pressureRef: `pressure.remaining.${index + 1}`, text })),
    nextChapterId,
    nextChapterHookFallback: firstDeepText(sources, ["nextChapterHook", "transition", "nextHook"])
      ?? (nextChapterId ? `确认本章总结后，继续进入${nextChapterId}。` : "本局已进入最终收束。"),
  };
}

function buildSummaryStoryPack(
  identity: PressureChapterSummaryIdentityV2,
  authority: PressureChapterSummaryAuthorityV1,
): PressureViewerStoryPackV1 {
  const facts = [
    ...authority.actualResults.map((item) => ({ factRef: item.resultRef, text: item.text, source: "SETTLEMENT" })),
    ...authority.completedObjectives.map((item) => ({ factRef: item.objectiveRef, text: item.text, source: "SETTLEMENT" })),
    ...authority.incompleteObjectives.map((item) => ({ factRef: item.objectiveRef, text: item.text, source: "SETTLEMENT" })),
    ...authority.remainingPressures.map((item) => ({ factRef: item.pressureRef, text: item.text, source: "SETTLEMENT" })),
  ];
  const base = {
    schemaVersion: "pressure_viewer_story_pack_v1" as const,
    identity: {
      runId: identity.runId,
      routeHash: identity.routeHash,
      chapterRuntimeId: identity.chapterRuntimeId,
      chapterId: identity.chapterId,
      beatId: `${identity.chapterId}.CHAPTER_SUMMARY`,
      previousBeatId: null,
      viewerSeatId: identity.viewerSeatId,
      authorityRevision: 0,
      stateAfterHash: authority.sourceCommitHash,
    },
    previousAction: null,
    visibleSeatResults: [],
    authority: {
      facts,
      metrics: authority.metricChanges.map((item) => ({ metricRef: item.metricRef, label: item.label, displayValue: item.displayAfter })),
      allowedClaims: facts.map((item) => ({ kind: "FACT" as const, refId: item.factRef, statement: item.text, required: true })),
    },
    authorialMaterials: [{
      materialRef: `${identity.chapterId}.chapter-summary`,
      title: authority.title,
      text: authority.closingNarrativeFallback,
      factRefs: facts.map((item) => item.factRef),
      stopCondition: "只收束本章，不替玩家决定下一章行动。",
    }],
    decision: {
      decisionContractRef: `${identity.chapterId}.chapter-summary`,
      decisionPointRef: `${identity.chapterId}.chapter-summary`,
      legalActionRefs: [],
      catalogActions: [],
    },
    cacheKey: sha256Canonical({
      runId: identity.runId,
      chapterRuntimeId: identity.chapterRuntimeId,
      viewerSeatId: identity.viewerSeatId,
      sourceCommitHash: authority.sourceCommitHash,
    }),
  };
  return Object.freeze({ ...base, packHash: sha256Canonical(base) });
}

function projectSource(identity: PressureChapterSummaryIdentityV2, summary: PressureGeneratedChapterSummaryV1) {
  return {
    runId: identity.runId,
    routeHash: identity.routeHash,
    chapterRuntimeId: identity.chapterRuntimeId,
    sourceChapterRuntimeId: identity.chapterRuntimeId,
    viewerSeatId: identity.viewerSeatId,
    chapterId: summary.chapterId,
    title: summary.title,
    closingNarrative: summary.closingNarrative,
    playerActions: [...summary.playerActions],
    actualResults: [...summary.actualResults],
    completedObjectives: [...summary.completedObjectives],
    incompleteObjectives: [...summary.incompleteObjectives],
    metricChanges: summary.metricChanges.map((item) => ({ ...item })),
    remainingPressures: [...summary.remainingPressures],
    nextChapterHook: summary.nextChapterHook,
    confirmationState: "AWAITING_CONFIRMATION" as const,
  };
}

function publishedSummary(payload: Record<string, unknown>): PressureGeneratedChapterSummaryV1 | null {
  const summary = recordOrNull(payload.summary);
  return summary?.mode === "CHAPTER_SUMMARY" ? summary as unknown as PressureGeneratedChapterSummaryV1 : null;
}

function eventData(identity: PressureChapterSummaryIdentityV2, dedupeKey: string, type: string, payloadJson: unknown) {
  return {
    id: `pressure-summary-${sha256Canonical({ dedupeKey }).slice(0, 32)}`,
    runId: identity.runId,
    day: chapterNumber(identity.chapterId),
    type,
    messageType: "system",
    roleKey: null,
    visibility: "authorized",
    payloadJson,
    sequence: null,
    dedupeKey,
    audienceType: "PRIVATE",
    audienceRoleIdsJson: [identity.viewerSeatId],
    sourceActionId: null,
  };
}

function summaryKey(identity: PressureChapterSummaryIdentityV2): string {
  return `pressure:chapter-summary:v2:${identity.runId}:${identity.chapterRuntimeId}:${identity.viewerSeatId}`;
}

function confirmationKey(identity: PressureChapterSummaryIdentityV2): string {
  return `${summaryKey(identity)}:confirmed`;
}

function collectMetricChanges(values: unknown[]): PressureChapterSummaryAuthorityV1["metricChanges"] {
  const result: PressureChapterSummaryAuthorityV1["metricChanges"] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    const record = recordOrNull(value);
    if (!record) return;
    if ([record.before, record.delta, record.after].every((item) => typeof item === "number")) {
      const metricRef = firstDeepText([record], ["metricRef", "trackId", "metricId", "id"])
        ?? `metric.${result.length + 1}`;
      if (!seen.has(metricRef)) {
        seen.add(metricRef);
        const delta = record.delta as number;
        result.push({
          metricRef,
          label: firstDeepText([record], ["label", "name"]) ?? metricRef,
          before: record.before as number,
          delta,
          after: record.after as number,
          displayBefore: String(record.displayBefore ?? record.before),
          displayDelta: String(record.displayDelta ?? `${delta >= 0 ? "+" : ""}${delta}`),
          displayAfter: String(record.displayAfter ?? record.after),
        });
      }
    }
    Object.values(record).forEach(visit);
  };
  values.forEach(visit);
  return result;
}

function firstDeepText(values: unknown[], keys: string[]): string | null {
  for (const value of values) {
    const found = deepFind(value, (record) => {
      for (const key of keys) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      }
      return null;
    });
    if (found) return found;
  }
  return null;
}

function firstDeepList(values: unknown[], keys: string[]): string[] {
  for (const value of values) {
    const found = deepFind(value, (record) => {
      for (const key of keys) {
        if (!Array.isArray(record[key])) continue;
        return (record[key] as unknown[]).flatMap((item) => {
          if (typeof item === "string" && item.trim()) return [item.trim()];
          const text = firstDeepText([item], ["text", "summary", "label", "title"]);
          return text ? [text] : [];
        });
      }
      return null;
    });
    if (found) return found;
  }
  return [];
}

function deepFind<T>(value: unknown, matcher: (record: Record<string, unknown>) => T | null): T | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, matcher);
      if (found !== null) return found;
    }
    return null;
  }
  const record = recordOrNull(value);
  if (!record) return null;
  const match = matcher(record);
  if (match !== null) return match;
  for (const item of Object.values(record)) {
    const found = deepFind(item, matcher);
    if (found !== null) return found;
  }
  return null;
}

function nextChapterIdOf(chapterId: string): string | null {
  const number = chapterNumber(chapterId);
  return number > 0 && number < 7 ? `N${number + 1}` : null;
}

function chapterNumber(chapterId: string): number {
  const parsed = Number.parseInt(chapterId.replace(/^\D+/u, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertIdentity(identity: PressureChapterSummaryIdentityV2): void {
  nonEmpty(identity.runId, "runId");
  digest(identity.routeHash, "routeHash");
  nonEmpty(identity.chapterRuntimeId, "chapterRuntimeId");
  nonEmpty(identity.chapterId, "chapterId");
  nonEmpty(identity.viewerSeatId, "viewerSeatId");
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`PRESSURE_CHAPTER_SUMMARY_IDENTITY_INVALID:${path}`);
  return value.trim();
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`PRESSURE_CHAPTER_SUMMARY_IDENTITY_INVALID:${path}`);
  return value as number;
}

function digest(value: unknown, path: string): string {
  const result = nonEmpty(value, path);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error(`PRESSURE_CHAPTER_SUMMARY_IDENTITY_INVALID:${path}`);
  return result;
}

function isUniqueConflict(error: unknown): boolean {
  return recordOrNull(error)?.code === "P2002";
}
