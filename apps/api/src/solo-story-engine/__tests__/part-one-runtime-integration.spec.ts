import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPartOneRuntimeWorkingSet,
  createInitialPartOneState,
  loadPartOneRuntimePackage,
  partOneRuntimeTargets,
  settlePartOneAction
} from "@ai-story/templates";
import { compileSoloStoryContext } from "../context-compiler";
import { buildSoloDecisionPrompt } from "../decision-prompt-builder";
import { buildSoloNarratorPrompt } from "../narrator-prompt-builder";
import { parseNarratorDraft } from "../output-parser";
import { bindStoryTurnReferences } from "../reference-binder";
import { executeSoloStoryTurn } from "../two-stage-executor";
import type {
  CompiledStoryContext,
  ConfirmedResolution,
  PlayerIntent,
  StoryRole,
  StoryTurnPublishedOutput
} from "../types";
import { transportWith } from "./helpers";

const role: StoryRole = {
  roleId: "zhejiang_governor",
  roleName: "浙江总督",
  identity: "奉命总督浙江军政，同时承担改桑、粮价和地方秩序的责任。",
  goal: "在不把未经核验的疑点写成罪证的前提下，建立可执行、可复核的浙江方案。",
  permissions: ["行文", "传令", "封存", "复核", "调粮", "递奏"],
  knownFactIds: ["fact-deadline"],
  heldLeverageKeys: []
};

test("Narrator receives settled story facts but cannot see next-decision routes", () => {
  const fixture = partOneFixture();
  const prompt = buildSoloNarratorPrompt(fixture.context);
  assert.equal(prompt.responseMode, "TEXT");
  assert.match(prompt.userPrompt, /本轮已结算事件/);
  assert.match(prompt.userPrompt, new RegExp(escapeRegExp(fixture.settlement.event.actionText)));
  assert.doesNotMatch(prompt.userPrompt, /routeKey|affordanceTemplateId|stateEffects|statePatch/);
  assert.doesNotMatch(prompt.systemPrompt, /LEGAL_NEXT_DECISION_SEEDS/);
  for (const route of fixture.workingSet.decisionAffordances) {
    assert.ok(
      !prompt.userPrompt.includes(route.affordanceTemplateId),
      `Narrator leaked route id ${route.affordanceTemplateId}`
    );
    assert.ok(
      !prompt.userPrompt.includes(route.actionText),
      `Narrator leaked future action ${route.actionText}`
    );
  }

  const draft = parseNarratorDraft(partOneNarration(fixture));
  const decisionPrompt = buildSoloDecisionPrompt(fixture.context, draft);
  assert.equal(decisionPrompt.responseMode, "JSON");
  assert.match(decisionPrompt.userPrompt, new RegExp(escapeRegExp(draft.rawProse)));
  for (const route of fixture.workingSet.decisionAffordances) {
    assert.match(decisionPrompt.userPrompt, new RegExp(escapeRegExp(route.affordanceTemplateId)));
  }
  assert.doesNotMatch(decisionPrompt.userPrompt, /stateEffects|statePatch|createsPendingConsequence/);
});

test("Part One publishes immutable Narrator prose and server-bound Decision copy after exactly two calls", async () => {
  const fixture = partOneFixture();
  const narration = partOneNarration(fixture);
  const routes = fixture.workingSet.decisionAffordances;
  const calls = { count: 0, stages: [] as string[] };
  const transport = transportWith({
    narrator: narration,
    decision: JSON.stringify({
      decisions: routes.map((route) => ({
        routeKey: route.affordanceTemplateId,
        description: route.actionText
      }))
    })
  }, calls);
  const target = fixture.targets.find((candidate) => candidate.type === "PUBLIC_FRAME")
    || fixture.targets[0]!;
  const result = await executeSoloStoryTurn({
    attemptId: "attempt-part-one-two-stage",
    role,
    scene: fixture.scene,
    facts: fixture.facts,
    recentCanon: [],
    pendingConsequences: [],
    activePressures: fixture.pressures,
    relevantScriptCards: [],
    availableTargets: fixture.targets,
    nextAvailableTargets: fixture.targets,
    partOneRuntime: fixture.workingSet,
    partOneSettlement: fixture.settlement,
    rawAction: {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      label: "先封档房，再复巡抚",
      targetId: target.id,
      targetLabel: target.label,
      actionText: fixture.settlement.event.actionText
    },
    transport,
    maxTokenEstimate: 6_000
  });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  if (!result.ok) return;
  assert.equal(result.attempt.providerCallCount, 2);
  assert.deepEqual(calls.stages, ["NARRATOR", "DECISION"]);
  assert.equal(
    `${result.output.resultType === "PUBLISHED_TURN" ? result.output.story.resultNarrative : ""}\n\n${
      result.output.resultType === "PUBLISHED_TURN" ? result.output.story.nextSituationNarrative : ""
    }`,
    narration
  );
  assert.equal(result.output.resultType, "PUBLISHED_TURN");
  if (result.output.resultType !== "PUBLISHED_TURN") return;
  assert.deepEqual(
    result.output.decisions.map((decision) => decision.affordanceTemplateId),
    routes.map((route) => route.affordanceTemplateId)
  );
  assert.deepEqual(
    result.output.decisions.map((decision) => decision.description),
    routes.map((route) => route.actionText)
  );
  assert.equal(
    result.decisionPrompt.userPrompt.includes(result.narratorProvider.rawText),
    true,
    "Decision must see the exact passed narrator endpoint"
  );
});

test("reference binder never changes player-facing prose", () => {
  const fixture = partOneFixture();
  const draft = parseNarratorDraft(partOneNarration(fixture));
  const routes = fixture.workingSet.decisionAffordances;
  const raw: StoryTurnPublishedOutput = {
    schemaVersion: "solo-story-turn-v1",
    resultType: "PUBLISHED_TURN",
    story: {
      title: fixture.scene.title,
      resultNarrative: draft.resultNarrative,
      nextSituationNarrative: draft.nextSituationNarrative
    },
    resolution: {
      confirmedResolutionId: "unbound",
      outcome: "APPLIED",
      observableOutcome: "unbound"
    },
    endingState: {
      timeLabel: fixture.scene.timeLabel,
      locationLabel: fixture.scene.locationLabel,
      tension: fixture.scene.situation,
      presentEntityRefs: [],
      visibleChanges: [],
      surfacedConsequenceIds: []
    },
    decisions: routes.map((route, index) => ({
      decisionId: `raw-${index}`,
      label: route.title,
      description: route.actionText,
      intent: route.immediateIntent,
      targetRef: route.target,
      method: route.method,
      leverageKeys: [],
      visibility: "OBSERVABLE",
      riskTolerance: "MEDIUM",
      distinctAxis: route.method,
      concreteCost: route.visibleTradeoff,
      expectedCountermove: "对方会要求书面回应。",
      groundingIds: [],
      decisionKernelId: route.decisionKernelId,
      affordanceTemplateId: route.affordanceTemplateId
    })),
    grounding: {
      usedScriptSourceIds: [],
      usedStoryCardIds: [],
      usedCanonFactIds: [],
      advancedMainlineQuestionIds: [],
      paidPendingConsequenceIds: [],
      stagedDirectedBeatId: null,
      deferredConsequences: []
    }
  };
  const before = JSON.stringify(raw.story);
  const bound = bindStoryTurnReferences(raw, fixture.context);
  assert.equal(bound.resultType, "PUBLISHED_TURN");
  if (bound.resultType !== "PUBLISHED_TURN") return;
  assert.equal(JSON.stringify(bound.story), before);
});

function partOneFixture() {
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const settlement = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      actionText: "先封档房，再复巡抚"
    },
    1
  );
  const workingSet = buildPartOneRuntimeWorkingSet(pkg, settlement.proposedState, 1);
  const targets = partOneRuntimeTargets(workingSet);
  const scene = {
    sceneId: workingSet.section.sectionId,
    title: workingSet.section.title,
    timeLabel: "嘉靖三十五年五月初八",
    locationLabel: "杭州总督府内厅",
    situation: "亲随已经领令，巡抚书吏仍在内厅等候回文。",
    mainlineQuestion: workingSet.section.dramaticPurpose,
    mainlineQuestionIds: [],
    directedBeat: null
  };
  const facts = [{
    factId: "fact-deadline",
    content: "朝廷限定浙江在三日内交出能够复核的执行说法。",
    visibility: "PUBLIC" as const,
    knownByRoleIds: [],
    priority: "P0" as const
  }];
  const pressures = [{
    pressureId: "deadline",
    summary: "巡抚书吏仍在等待总督府的正式答复。",
    priority: "P0" as const
  }];
  const intent: PlayerIntent = {
    source: "RECOMMENDED",
    targetId: targets[0]!.id,
    targetLabel: targets[0]!.label,
    objective: "先保住县册现场",
    method: "发令封存",
    userFacingText: settlement.event.actionText,
    leverageKeys: [],
    immutableIntentHash: "part-one-intent"
  };
  const actionResolution: ConfirmedResolution = {
    resolutionId: "resolution-part-one",
    legality: "LEGAL",
    actionType: "RECOMMENDED",
    accepted: true,
    acceptedWithCost: false,
    actionStarted: settlement.event.actionText,
    immediateObservableResult: settlement.event.authoritativeObservableFacts,
    summary: settlement.event.actionText,
    costSummary: null,
    consumedLeverageKeys: [],
    pendingConsequences: [],
    factsModelMayStateAsConfirmed: settlement.event.authoritativeObservableFacts,
    factsStillUnknown: []
  };
  const compiled = compileSoloStoryContext({
    role,
    scene,
    facts,
    recentCanon: [],
    pendingConsequences: [],
    activePressures: pressures,
    relevantScriptCards: [],
    actionResolution,
    playerIntent: intent,
    availableTargets: targets,
    openingTrigger: null,
    partOneRuntime: workingSet,
    partOneSettlement: settlement,
    maxTokenEstimate: 6_000
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("Part One context compilation failed");
  return {
    context: compiled.context,
    settlement,
    workingSet,
    targets,
    scene,
    facts,
    pressures
  };
}

function partOneNarration(
  fixture: ReturnType<typeof partOneFixture>
) {
  const event = fixture.settlement.event;
  const reactionText = event.authoritativeNpcReactions
    .map((reaction) => reaction.action)
    .join("。");
  const factText = event.authoritativeObservableFacts.join("。");
  const pressure = fixture.workingSet.nextDecisionPressure?.summary
    || fixture.pressures[0].summary;
  return [
    `浙江总督没有再碰案上的公文，只把话说给阶下的人听：${event.actionText}。亲随领了话，转身走出内厅；守在门边的书吏抬起头，又慢慢把目光落回公文匣上。`,
    `${factText}。这番处置落下以后，原先只在口头上相争的事情有了经手的人。书吏把公文匣递到案前，却没有松手，像是在等总督府把方才的话写成一份能带走的答复。`,
    `${reactionText}。来人说完便退回原处，既没有替巡抚多问一句，也不肯把催办二字收回。内厅里的官员听得明白：对方争的不是一句软硬，而是谁先把责任写进往来的官文。`,
    `总督没有接那只匣子。书吏又往前递了半寸，低声把眼下的来意说完：${pressure}。话到这里，他便垂手站住，等案后的人开口。`
  ].join("\n\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
