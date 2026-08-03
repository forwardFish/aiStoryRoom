import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCausalDelta } from "../src/causal-context.js";
import {
  compileForegroundContext,
  buildForegroundUserContext,
  buildNarratorMessages,
} from "../src/foreground.js";
import type { CompiledForegroundContext } from "../src/types.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { sangtianWorkspaceSeeder } from "../src/sangtian-workspace.js";
import { prepareSangtianDecision } from "../src/sangtian-decisions.js";

const fixtures = [
  {
    name: "Sangtian historical court",
    action: "暂不签发，先封存清流县档房。",
    recentCanon: "巡抚书吏捧着回文匣，仍在屏风外等候。",
    protectedNarrative: "总督把封缄令牌交给县令亲随，命他先封存档房；改桑文书暂不签发。",
    pressure: "巡抚书吏追问暂缓签发的书面理由和复核期限。",
    currentFact: "巡抚书吏仍在屏风外等候答复。",
    foreground: [
      "## Story",
      "浙江改桑急令已经送达总督府。",
      "",
      "## Scene",
      "内厅里只有总督、巡抚书吏和县令亲随。",
      "",
      "## Tone",
      "克制、具体，以人物言行呈现压力。",
      "",
      "## Debug",
      "stateRevision=77; validator=legacy; requiredAnchorGroups=all",
    ].join("\n"),
  },
  {
    name: "second-world orbital station",
    action: "Keep the station listening while the crew verifies the alarm.",
    recentCanon: "The station alarm clicked once, then held on a steady amber light.",
    protectedNarrative: "Mara kept the listening array online and ordered no departure from the station.",
    pressure: "The engineer asks whether to spend the reserve battery on a deeper scan.",
    currentFact: "The reserve battery remains available but has not been committed.",
    foreground: [
      "## Story",
      "An isolated orbital station has detected an unverified transmission.",
      "",
      "## Scene",
      "Mara and the engineer remain in the listening room.",
      "",
      "## Tone",
      "Tense, restrained science fiction.",
      "",
      "## Debug",
      "state.path=station.power; synonymTable=forbidden",
    ].join("\n"),
  },
] as const;

for (const fixture of fixtures) {
  test(`P05 compiles the fixed five-section Narrator workset for ${fixture.name}`, () => {
    const delta = buildCausalDelta({
      turnId: "T01",
      action: fixture.action,
      selectedOption: {
        id: "fixture.option",
        label: fixture.action,
        effect: {
          intent: fixture.action,
          beatContract: {
            sourceRef: "internal.acceptance.anchor",
            objective: "Do not expose this settlement checklist.",
            moves: [fixture.pressure],
            requiredAnchorGroups: [["internal anchor"]],
            requiredDurableAnchorGroups: [["internal durable anchor"]],
            authorizedPlayerActions: [fixture.action],
            constraints: ["internal validator instruction"],
            settledNarrative: fixture.protectedNarrative,
            fallbackContinuation: "A reviewed prose continuation.",
            narrativeSeed: {
              playerOutcome: fixture.protectedNarrative,
              continuationMoves: [fixture.pressure],
              sourceEventIds: ["fixture.event.current"],
              deferredEventIds: ["fixture.event.later"],
              npcOrWorldPressure: fixture.pressure,
              stopCondition: fixture.pressure,
            },
            sceneEvidence: {
              packetId: "fixture.scene-evidence",
              evidenceItems: [
                {
                  evidenceId: "fixture.current-action",
                  evidenceClass: "CURRENT_CANON",
                  statement: `The player already acted: ${fixture.action}`,
                  sourceClaimIds: [],
                  adaptationDecisionIds: [],
                  useAs: "OBJECTIVE_FACT",
                },
                {
                  evidenceId: "fixture.current-state",
                  evidenceClass: "CURRENT_STATE",
                  statement: fixture.currentFact,
                  sourceClaimIds: [],
                  adaptationDecisionIds: [],
                  useAs: "OBJECTIVE_FACT",
                },
                {
                  evidenceId: "fixture.source-mechanism",
                  evidenceClass: "ORIGINAL_MECHANISM",
                  statement: "A prior source scene establishes that responsibility is contested through a formal reply.",
                  sourceClaimIds: ["fixture.claim"],
                  adaptationDecisionIds: [],
                  useAs: "DRAMATIC_MECHANISM",
                },
              ],
              unresolvedFacts: ["The hidden instigator remains unknown."],
              specificityBoundary: "Do not add exact quantities or new evidence.",
            },
            stopCondition: fixture.pressure,
          },
          knowledgeBoundary: {
            sourceRef: "fixture.knowledge",
            allowed: [fixture.currentFact],
            forbidden: ["Do not invent an exact quantity."],
          },
          stateHints: [{
            key: "internal.state.path",
            op: "set",
            value: true,
            presentThisTurn: true,
            surfaceAnchor: fixture.protectedNarrative,
          }],
        },
      },
    });
    const context: CompiledForegroundContext = {
      foregroundGuidance: fixture.foreground,
      durableMemory: "A durable fact visible to this player.",
      storyMemory: "A role-scoped Storykeeper memory that remains relevant across turns.",
      recentCanonExcerpt: fixture.recentCanon,
      report: {
        usedChars: 0,
        budgets: {},
        truncated: [],
        removedPlayerDirectiveClauses: 0,
        deduplicatedContextCardSections: 0,
      },
    };

    const direct = buildForegroundUserContext(delta, context);
    assertFixedWorkset(
      direct,
      fixture.action,
      fixture.protectedNarrative,
      fixture.pressure,
      fixture.currentFact,
    );

    const messages = buildNarratorMessages(delta, context);
    assert.equal(messages.length, 2);
    assertFixedWorkset(
      messages[1].content,
      fixture.action,
      fixture.protectedNarrative,
      fixture.pressure,
      fixture.currentFact,
    );
    const entirePrompt = messages.map((message) => message.content).join("\n");
    assert.doesNotMatch(
      entirePrompt,
      /requiredAnchorGroups|requiredDurableAnchorGroups|sourceRef|stateRevision|state\.path|internal\.state\.path|synonymTable|validator|settlement checklist/iu,
    );
    assert.match(
      messages[1].content,
      /A role-scoped Storykeeper memory that remains relevant across turns/u,
    );
    assert.deepEqual(delta.scenePacket?.sourceEventIds, ["fixture.event.current"]);
    assert.deepEqual(delta.scenePacket?.deferredEventIds, ["fixture.event.later"]);
    assert.doesNotMatch(entirePrompt, /fixture\.event\.(?:current|later)|fixture\.claim/u);
  });
}

test("P05 the real Sangtian opening packet exposes current facts but not a second player action", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-p05-sangtian-evidence-"));
  const projectRoot = path.resolve(process.cwd(), "../..");
  const workspace = new FileStoryWorkspace(
    root,
    projectRoot,
    "p05-evidence-test",
    sangtianWorkspaceSeeder,
  );
  const runId = "p05_sangtian_evidence";
  try {
    await workspace.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    const snapshot = await workspace.snapshot(runId);
    const selected = snapshot.previousOptions.find((option) => option.id === "opening_d1");
    assert.ok(selected);
    const prepared = await prepareSangtianDecision(workspace, {
      runId,
      turnNumber: 1,
      action: selected.label,
      selectedOption: selected,
    });
    assert.ok(prepared?.selectedOption);
    const delta = buildCausalDelta({
      turnId: "T01",
      action: selected.label,
      selectedOption: prepared.selectedOption,
    });
    const compiled = await compileForegroundContext(workspace.paths(runId), snapshot);
    const prompt = buildNarratorMessages(delta, compiled)[1].content;
    const thisTurn = prompt.match(/## 本轮唯一剧情拍\n\n([\s\S]*?)\n\n## 玩家行动/u)?.[1] || "";
    const evidence = delta.beatContract?.sceneEvidence?.evidenceItems || [];
    const currentStateFacts = evidence.filter((item) => (
      item.useAs === "OBJECTIVE_FACT" && item.evidenceClass === "CURRENT_STATE"
    ));
    assert.ok(currentStateFacts.length > 0);
    for (const fact of currentStateFacts) assert.match(thisTurn, new RegExp(escapeRegExp(fact.statement), "u"));
    for (const fact of evidence.filter((item) => item.evidenceClass === "CURRENT_CANON")) {
      assert.doesNotMatch(thisTurn, new RegExp(escapeRegExp(fact.statement), "u"));
    }
    assert.match(thisTurn, /本轮只写服务器选定的这一剧情拍/u);
    assert.match(thisTurn, /当前人物允许知道的内容/u);
    assert.match(thisTurn, /当前不得揭露或写实的内容/u);
    assert.match(thisTurn, /具体田亩数、户数、差额或精确数量/u);
    assert.match(thisTurn, /县令亲随.*不知道原册的更多细节/u);
    assert.match(thisTurn, /三日内具报改桑执行方案/u);
    assert.match(thisTurn, /杭州米价已经连涨/u);
    assert.match(thisTurn, /巡抚回文匣目前由巡抚书吏持有，其中为空，目前合拢/u);
    assert.equal(prompt.trim().endsWith(selected.label), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function assertFixedWorkset(
  value: string,
  readerAction: string,
  protectedNarrative: string,
  pressure: string,
  currentFact: string,
) {
  const headings = [...value.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
  assert.deepEqual(headings, [
    "前景约束",
    "持久记忆",
    "最近正文",
    "本轮唯一剧情拍",
    "玩家行动",
  ]);
  assert.doesNotMatch(value, /## Story Memory|## Recent Canon Excerpt|## Settled Action Draft/u);

  const thisTurn = value.match(/## 本轮唯一剧情拍\n\n([\s\S]*?)\n\n## 玩家行动/u)?.[1] || "";
  assert.match(thisTurn, /本轮只写服务器选定的这一剧情拍/u);
  assert.match(thisTurn, /当前可直接使用的客观事实/u);
  assert.match(thisTurn, new RegExp(escapeRegExp(currentFact), "u"));
  assert.doesNotMatch(thisTurn, /The player already acted:/u);
  assert.equal(countOccurrences(thisTurn, pressure) >= 1, true);
  assert.equal(countOccurrences(value, protectedNarrative), 1);
  assert.equal(value.trim().endsWith(readerAction), true);
  assert.doesNotMatch(value, /Foreground Context|Foreground Guidance|Durable Memory|Recent Player Canon|This Turn|Reader Action/u);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}
