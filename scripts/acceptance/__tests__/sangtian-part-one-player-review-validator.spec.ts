import assert from "node:assert/strict";
import test from "node:test";
import { computeImmutableHash, sha256Bytes } from "../../story-decomposition/lib/contract-utils.mjs";
import { buildCheckpointPlayerGate } from "../sangtian-part-one-player-review-validator.ts";

const SEALED_AT = "2026-07-23T08:00:00.000Z";

function makeView() {
  const view: any = {
    schemaVersion: "player-visible-view-v1",
    runId: "RUN-PLAYER-GATE-TEST",
    checkpoint: "T01",
    story: "雨点打在总督衙门的青砖上。巡抚的第二道催文已经送到，清流县的亲随却仍抱着那只封口发毛的匣子，不肯交给旁人。堂下两班书吏都低着头，等总督先开口。",
    publicEndingState: "三日期限未变；巡抚正在催办；县册密报尚未核实。",
    displayDecisions: [
      { visibleOrdinal: 1, title: "先封存县册", actionText: "命亲随把匣子直接交到总督衙门，当堂登记封存，再回文巡抚说明复核缘由。" },
      { visibleOrdinal: 2, title: "附条件先行", actionText: "先准清流县小范围改桑，同时要求巡抚与县令共同具名，限日送来旧册副本。" },
      { visibleOrdinal: 3, title: "先会巡抚", actionText: "暂不碰匣中材料，立刻请巡抚到衙议定复核主持权与第一份公文的责任写法。" },
    ],
    screenshotRefs: ["turn-01/visible-ui.png"],
    viewHash: "",
  };
  view.viewHash = computeImmutableHash(view, ["viewHash"]);
  return view;
}

function makeRef(view: any, fieldPath: string, quote: string) {
  const value = fieldPath
    .slice(1)
    .split("/")
    .reduce((entry: any, key: string) => entry[key], view);
  const startOffset = value.indexOf(quote);
  assert.ok(startOffset >= 0, `${quote} must be present at ${fieldPath}`);
  return {
    viewHash: view.viewHash,
    fieldPath,
    startOffset,
    endOffset: startOffset + quote.length,
    quoteHash: sha256Bytes(Buffer.from(quote, "utf8")),
  };
}

function scored(view: any, score = 4) {
  return {
    score,
    evidenceRefs: [makeRef(view, "/story", "巡抚的第二道催文已经送到")],
    reason: "我能从这句可见正文直接判断压力已经进入当前场景。",
  };
}

function makeReview(view: any) {
  const review: any = {
    schemaVersion: "codex-player-review-v1",
    runId: view.runId,
    contextId: "BLIND-CONTEXT-TEST",
    reviewMode: "BLIND_REAL_PLAYER",
    checkpoint: view.checkpoint,
    viewHash: view.viewHash,
    whatHappened: "巡抚再次催办，而清流县送来一只可能装有县册材料的匣子，堂上所有人都等我决定先执行还是先保全材料。",
    whatChanged: "催文使期限压力具体化，匣子让县册风险第一次成为眼前可以处置的东西。",
    currentPressure: "既不能无故拖延国策，也不能让尚未查清的县册失去保管链。",
    knownUnknownBoundary: "我知道催文和匣子已经到达，但不知道匣内材料是否真实，也不知道巡抚是否知情。",
    decisionSetScores: {
      whyDecisionNow: scored(view),
      actionParaphrasability: scored(view),
      naturalLanguage: scored(view),
      meaningfulDifference: scored(view),
      perceptibleTradeoffWithoutSpoiler: scored(view),
      roleAndKnowledgeLegality: scored(view),
    },
    decisionReviews: view.displayDecisions.map((decision: any, index: number) => ({
      visibleOrdinal: decision.visibleOrdinal,
      titleQuote: decision.title,
      naturalLanguageParaphrase: index === 0 ? "先保住材料再解释拖延" : index === 1 ? "有限执行并让两方共同担责" : "先与巡抚谈清复核权和责任",
      target: index === 0 ? "县册保管链" : index === 1 ? "改桑范围与责任记录" : "复核主持权",
      method: index === 0 ? "登记封存" : index === 1 ? "附条件放行" : "召集面议",
      immediateIntent: decision.actionText,
      perceivedTradeoff: index === 0 ? "可能激怒巡抚并承受拖延压力" : index === 1 ? "县册问题可能在执行中扩大" : "争取协商但给对方准备时间",
      evidenceRefs: [makeRef(view, `/displayDecisions/${index}/actionText`, decision.actionText)],
      readability: {
        score: 4,
        evidenceRefs: [makeRef(view, `/displayDecisions/${index}/actionText`, decision.actionText)],
        reason: "动作、对象和即时目的都能用一句自然中文复述。",
      },
    })),
    notFiller: {
      value: true,
      evidenceRefs: [makeRef(view, "/story", "清流县的亲随却仍抱着那只封口发毛的匣子")],
      reason: "出现了可被处置的新物件和新的责任风险，不是在重复开场。",
    },
    wantsToContinue: {
      value: true,
      continueReason: "我想知道匣内材料是否真实，也想看巡抚如何回应我的第一道命令。",
      strongestPull: "县册真伪和巡抚反制",
      evidenceRefs: [makeRef(view, "/story", "等总督先开口")],
    },
    problems: [],
    reviewerAssessment: "PASS",
    reviewSealedAt: SEALED_AT,
    immutableHash: "",
    storyScores: {
      continuity: scored(view),
      choiceResponse: scored(view),
      sceneAndDetail: scored(view),
      characterCredibility: scored(view),
      causalClarity: scored(view),
      historicalNovelStyle: scored(view),
      naturalChineseAndPacing: scored(view),
    },
  };
  review.immutableHash = computeImmutableHash(review);
  return review;
}

test("passes only a fully evidenced real-player review", async () => {
  const view = makeView();
  const review = makeReview(view);
  const result = await buildCheckpointPlayerGate(view, review);
  assert.equal(result.gate.computedVerdict, "PASS");
  assert.equal(result.gate.experienceAverage, 4);
  assert.equal(result.gate.decisionAverage, 4);
  assert.deepEqual(result.errors, []);
});

test("a score below four is a hard failure even when the reviewer writes PASS", async () => {
  const view = makeView();
  const review = makeReview(view);
  review.storyScores.historicalNovelStyle.score = 3;
  review.immutableHash = computeImmutableHash(review);
  const result = await buildCheckpointPlayerGate(view, review);
  assert.equal(result.gate.computedVerdict, "FAIL");
  assert.match(result.errors.join("\n"), /below the hard player-experience gate/);
});

test("a fabricated visible quote hash fails the checkpoint", async () => {
  const view = makeView();
  const review = makeReview(view);
  review.storyScores.continuity.evidenceRefs[0].quoteHash = "A".repeat(64);
  review.immutableHash = computeImmutableHash(review);
  const result = await buildCheckpointPlayerGate(view, review);
  assert.equal(result.gate.computedVerdict, "FAIL");
  assert.match(result.errors.join("\n"), /quoteHash does not match/);
});

test("missing a visible option review fails closed", async () => {
  const view = makeView();
  const review = makeReview(view);
  review.decisionReviews.pop();
  review.immutableHash = computeImmutableHash(review);
  const result = await buildCheckpointPlayerGate(view, review);
  assert.equal(result.gate.computedVerdict, "FAIL");
  assert.match(result.errors.join("\n"), /cover every visible option exactly once/);
});

test("a player who does not want to continue vetoes the run", async () => {
  const view = makeView();
  const review = makeReview(view);
  review.wantsToContinue.value = false;
  review.immutableHash = computeImmutableHash(review);
  const result = await buildCheckpointPlayerGate(view, review);
  assert.equal(result.gate.computedVerdict, "FAIL");
  assert.match(result.errors.join("\n"), /notFiller=true and wantsToContinue=true/);
});
