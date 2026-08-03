import assert from "node:assert/strict";
import test from "node:test";
import { buildCausalDelta } from "../src/causal-context.js";
import {
  buildForegroundUserContext,
  buildNarratorMessages,
} from "../src/foreground.js";
import type { CompiledForegroundContext } from "../src/types.js";

const fixtures = [
  {
    name: "Sangtian historical court",
    action: "暂不签发，先封存清流县档房。",
    recentCanon: "巡抚书吏捧着回文匣，仍在屏风外等候。",
    protectedNarrative: "总督把封缄令牌交给县令亲随，命他先封存档房；改桑文书暂不签发。",
    pressure: "巡抚书吏追问暂缓签发的书面理由和复核期限。",
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
              npcOrWorldPressure: fixture.pressure,
              stopCondition: fixture.pressure,
            },
            sceneEvidence: {
              packetId: "fixture.scene-evidence",
              evidenceItems: [{
                evidenceId: "fixture.source-mechanism",
                evidenceClass: "ORIGINAL_MECHANISM",
                statement: "A prior source scene establishes that responsibility is contested through a formal reply.",
                sourceClaimIds: ["fixture.claim"],
                adaptationDecisionIds: [],
                useAs: "DRAMATIC_MECHANISM",
              }],
              unresolvedFacts: ["The hidden instigator remains unknown."],
              specificityBoundary: "Do not add exact quantities or new evidence.",
            },
            stopCondition: fixture.pressure,
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
      storyMemory: "Storykeeper backstage memory must not enter the Narrator workset.",
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
    assertFixedWorkset(direct, fixture.action, fixture.protectedNarrative, fixture.pressure);

    const messages = buildNarratorMessages(delta, context);
    assert.equal(messages.length, 2);
    assertFixedWorkset(messages[1].content, fixture.action, fixture.protectedNarrative, fixture.pressure);
    const entirePrompt = messages.map((message) => message.content).join("\n");
    assert.doesNotMatch(
      entirePrompt,
      /requiredAnchorGroups|requiredDurableAnchorGroups|sourceRef|stateRevision|state\.path|internal\.state\.path|synonymTable|validator|settlement checklist/iu,
    );
  });
}

function assertFixedWorkset(
  value: string,
  readerAction: string,
  protectedNarrative: string,
  pressure: string,
) {
  const headings = [...value.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
  assert.deepEqual(headings, [
    "Foreground Guidance",
    "Durable Memory",
    "Recent Player Canon",
    "This Turn",
    "Reader Action",
  ]);
  assert.doesNotMatch(value, /## Story Memory|## Recent Canon Excerpt|## Settled Action Draft/u);

  const thisTurn = value.match(/## This Turn\n\n([\s\S]*?)\n\n## Reader Action/u)?.[1] || "";
  assert.match(thisTurn, /服务端已经确定的下一剧情拍/u);
  assert.match(thisTurn, /只提供戏剧机制，不自动成为当前事实/u);
  assert.equal(countOccurrences(thisTurn, pressure) >= 1, true);
  assert.equal(countOccurrences(value, protectedNarrative), 1);
  assert.equal(value.trim().endsWith(readerAction), true);
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}
