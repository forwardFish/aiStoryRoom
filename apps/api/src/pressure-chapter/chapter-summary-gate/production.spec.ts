import assert from "node:assert/strict";
import test from "node:test";
import { PressureOneCallStoryGeneratorV1 } from "../story-generation";
import { assertPressureChapterSummaryConfirmationAuthorityV2 } from "./confirmation-authority";
import { createPrismaPressureChapterSummaryProductionV2 } from "./production";

class MemoryStoryEventDelegate {
  records = new Map<string, any>();
  async findUnique(input: any) { return structuredClone(this.records.get(input.where.dedupeKey) ?? null); }
  async create(input: any) {
    const key = input.data.dedupeKey;
    if (this.records.has(key)) { const error: any = new Error("unique"); error.code = "P2002"; throw error; }
    const value = { ...structuredClone(input.data), createdAt: new Date("2026-08-15T00:00:00.000Z") };
    this.records.set(key, value);
    return structuredClone(value);
  }
  async update(input: any) {
    const current = this.records.get(input.where.dedupeKey);
    assert.ok(current);
    const value = { ...current, ...structuredClone(input.data) };
    this.records.set(input.where.dedupeKey, value);
    return structuredClone(value);
  }
}

function fixture() {
  const storyEvent = new MemoryStoryEventDelegate();
  let providerCalls = 0;
  const settlement = {
    runId: "run-1",
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1",
    chapterSequence: 1,
    commitHash: "a".repeat(64),
    evaluationJson: {
      closingNarrative: "九堰危机的权威结算已经封存。",
      completedObjectives: ["完成本章正式行动"],
      incompleteObjectives: ["京师追问仍待处理"],
      remainingPressures: ["灾后奏疏必须继续核验"],
      nextChapterHook: "进入N2：水灾后的第一道奏疏",
      metricChanges: [{ metricRef: "civilian_land", label: "民心", before: 50, delta: 2, after: 52 }],
    },
    worldDeltaJson: {},
    commitManifestJson: {},
  };
  const prisma: any = {
    storyEvent,
    pressureChapterSettlement: { async findFirst() { return structuredClone(settlement); } },
    pressureChapterRuntime: { async findUnique() { return { decisionStateJson: { title: "九堰将决" } }; } },
    pressureDecisionAction: {
      async findMany(input: any) {
        return [{
          id: `action-${input.where.seatId}`,
          decisionPointId: "N1.weir_crisis",
          actionType: "EVACUATE_WEIRS",
          payloadJson: { optionCode: "EVACUATE_WEIRS", customText: null },
        }];
      },
    },
  };
  const generator = new PressureOneCallStoryGeneratorV1({
    async renderOneCallStory(context: any) {
      providerCalls += 1;
      const authority = context.summaryAuthority;
      return {
        closingNarrative: "命令已经落到堰口与村镇，泥水中的回报也终于汇成了可以封存的结论。有人因此脱险，也有人仍要面对下一封奏疏里的追问；这一夜的得失不会被下一章抹去。",
        playerActions: authority.playerActions.map((item: any) => ({ actionId: item.actionId, text: item.text })),
        actualResults: authority.actualResults.map((item: any) => ({ resultRef: item.resultRef, text: item.text })),
        completedObjectives: authority.completedObjectives.map((item: any) => ({ objectiveRef: item.objectiveRef, text: item.text })),
        incompleteObjectives: authority.incompleteObjectives.map((item: any) => ({ objectiveRef: item.objectiveRef, text: item.text })),
        metricChanges: authority.metricChanges.map((item: any) => ({
          metricRef: item.metricRef,
          label: item.label,
          before: item.before,
          delta: item.delta,
          after: item.after,
        })),
        remainingPressures: authority.remainingPressures.map((item: any) => ({ pressureRef: item.pressureRef, text: item.text })),
        nextChapterHook: authority.nextChapterHookFallback,
      };
    },
  });
  const production = createPrismaPressureChapterSummaryProductionV2({
    prisma,
    generator,
    actionPresentation: {
      read(input) {
        assert.equal(input.chapterId, "N1");
        assert.equal(input.decisionPointId, "N1.weir_crisis");
        assert.equal(input.actionType, "EVACUATE_WEIRS");
        return { label: "先发堰区疏散令" };
      },
    },
  });
  const scope = {
    runId: "run-1",
    routeHash: "f".repeat(64),
    chapterRuntimeId: "runtime-n2",
    viewerSeatId: "zhejiang_governor" as const,
  };
  return { storyEvent, production, scope, providerCalls: () => providerCalls };
}

test("current N2 projection is blocked by the latest unconfirmed N1 summary and refresh reuses it", async () => {
  const state = fixture();
  const first = await state.production.reader.readCurrent(state.scope);
  const replay = await state.production.reader.readCurrent(structuredClone(state.scope));
  assert.deepEqual(replay, first);
  assert.equal(first?.chapterId, "N1");
  assert.equal(first?.sourceChapterRuntimeId, "runtime-n1");
  assert.equal(first?.confirmationState, "AWAITING_CONFIRMATION");
  assert.equal(state.providerCalls(), 1);
  assert.equal(state.storyEvent.records.size, 1);
  const persisted = [...state.storyEvent.records.values()][0];
  assert.equal(persisted.audienceType, "PRIVATE");
  assert.deepEqual(persisted.audienceRoleIdsJson, ["zhejiang_governor"]);
  assert.deepEqual(first?.playerActions, ["你选择了“先发堰区疏散令”。"]);
  assert.doesNotMatch(JSON.stringify(first), /EVACUATE_WEIRS/u);
});

test("confirmation is viewer-scoped, idempotent and reveals the already authoritative next chapter", async () => {
  const state = fixture();
  await state.production.reader.readCurrent(state.scope);
  const command = {
    runId: "run-1",
    routeHash: "f".repeat(64),
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1",
    viewerSeatId: "zhejiang_governor" as const,
    controlEpoch: 1,
    expectedWorkingRevision: 0,
    submissionFenceToken: "fence",
    idempotencyKey: "confirm-1",
  };
  const first = await state.production.commandHandler.handle(command) as any;
  const replay = await state.production.commandHandler.handle(command) as any;
  assert.deepEqual(replay, first);
  assert.equal(first.accepted, true);
  assert.equal(await state.production.reader.readCurrent(state.scope), null);
  const retryAfterRefresh = await state.production.commandHandler.handle(command) as any;
  assert.deepEqual(retryAfterRefresh, replay);
  assert.equal(state.providerCalls(), 1);
  assert.equal(state.storyEvent.records.size, 2);
});

test("two viewers receive separate durable summaries without exposing one another's action", async () => {
  const state = fixture();
  const governor = await state.production.reader.readCurrent(state.scope);
  const law = await state.production.reader.readCurrent({ ...state.scope, viewerSeatId: "qingliu_law" });
  assert.equal(state.providerCalls(), 2);
  assert.equal(state.storyEvent.records.size, 2);
  assert.doesNotMatch(JSON.stringify(governor), /qingliu_law/u);
  assert.doesNotMatch(JSON.stringify(law), /zhejiang_governor/u);
});

test("confirmation authority is bound to the live run, route, viewer, control and source chapter", () => {
  const projection: any = {
    roomId: "run-1",
    runId: "run-1",
    route: { routeHash: "f".repeat(64) },
    chapter: { chapterRuntimeId: "runtime-n2", chapterId: "N2", workingRevision: 3 },
    viewer: {
      seatId: "zhejiang_governor",
      control: { controlEpoch: 4, submissionFenceToken: "fence-4" },
    },
    chapterSummary: {
      sourceChapterRuntimeId: "runtime-n1",
      chapterId: "N1",
      confirmationState: "AWAITING_CONFIRMATION",
    },
  };
  const command = {
    runId: "run-1",
    routeHash: "f".repeat(64),
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1",
    viewerSeatId: "zhejiang_governor" as const,
    controlEpoch: 4,
    expectedWorkingRevision: 3,
    submissionFenceToken: "fence-4",
    idempotencyKey: "confirm-controller",
  };
  assert.doesNotThrow(() => assertPressureChapterSummaryConfirmationAuthorityV2("run-1", command, projection));
  assert.throws(
    () => assertPressureChapterSummaryConfirmationAuthorityV2(
      "run-1",
      { ...command, viewerSeatId: "qingliu_law" },
      projection,
    ),
    /AUTHORITY_MISMATCH/u,
  );
});
