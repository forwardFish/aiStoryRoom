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
import { validateDecisionCopy, validateNarratorDraft } from "../output-validator";
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
  assert.match(prompt.userPrompt, /输出前逐段计数：必须是四至七个自然段/);
  assert.match(prompt.userPrompt, /每段最多三句/);
  assert.match(prompt.userPrompt, /去掉空白后不得少于 300 字/);
  assert.match(prompt.userPrompt, /不能用重复物件状态、规则解释或新增事实凑字/);
  assert.match(prompt.userPrompt, /【RECENT CANON】/);
  assert.match(prompt.userPrompt, /总督已经看过清流县令密信/);
  assert.match(prompt.userPrompt, /【SCENE START】/);
  assert.match(prompt.userPrompt, /【SCENE END】/);
  assert.match(prompt.userPrompt, /【SCENE START ACTORS — ONLY THESE MAY ACT BEFORE TRANSITION】/);
  assert.match(prompt.userPrompt, /【SCENE END ACTORS — ONLY THESE MAY ACT AFTER TRANSITION】/);
  assert.match(prompt.userPrompt, /【AUTHORIZED ACTOR ARRIVALS】/);
  assert.match(prompt.userPrompt, /【AUTHORIZED ACTOR DEPARTURES】/);
  assert.match(prompt.userPrompt, /【AUTHORIZED PLAYER SPEECH】/);
  assert.match(prompt.userPrompt, /暂缓签发，三日内复核/);
  assert.match(prompt.userPrompt, /持此去清流，封存档房/);
  assert.match(prompt.userPrompt, /【MANDATORY SCENE BEATS】/);
  assert.match(prompt.userPrompt, /【AUTHORIZED EXISTING OBJECTS】/);
  assert.match(prompt.userPrompt, /"巡抚回文匣"/);
  assert.doesNotMatch(prompt.userPrompt, /continuityNote|不得改变分量/);
  assert.doesNotMatch(prompt.userPrompt, /\[\s*"巡",\s*"清",\s*"总"/);
  assert.match(prompt.userPrompt, /【REQUIRED END CHANGE】/);
  assert.match(prompt.userPrompt, new RegExp(escapeRegExp(fixture.settlement.event.actionText)));
  for (const reaction of fixture.settlement.event.authoritativeNpcReactions) {
    assert.match(prompt.userPrompt, new RegExp(escapeRegExp(reaction.action)));
  }
  assert.match(prompt.systemPrompt, /Recent Canon 是已经发生的最高连续性依据/);
  assert.match(prompt.systemPrompt, /场景只能从 SCENE START 推进到 SCENE END/);
  assert.match(prompt.systemPrompt, /SCENE START ACTORS 和 SCENE END ACTORS 是分阶段的实体级硬边界/);
  assert.match(prompt.systemPrompt, /获批预算 300—1500/);
  assert.match(prompt.systemPrompt, /到期后果只有在正文真正发生后，后台才会记为兑现/);
  assert.match(prompt.systemPrompt, /不得改写为从此刻、现在或本轮重新起算/);
  assert.match(prompt.systemPrompt, /不得换算成“已非一日、已有数日、一夜之间”/);
  assert.match(prompt.systemPrompt, /不写“分量没有变”/);
  assert.match(prompt.systemPrompt, /不得为方便场面另取一纸、另造节略、底稿、附件或第二份文书/);
  assert.match(prompt.userPrompt, /【AUTHORIZED QUANTITIES】/);
  assert.match(prompt.userPrompt, /三日/);
  assert.match(prompt.userPrompt, /本轮始于并结束于嘉靖三十五年五月初八辰时/);
  assert.match(prompt.userPrompt, /只让已点名的在场人物行动/);
  assert.match(prompt.userPrompt, /不得新增它的材质、尺寸、正反面、刻字、字号、纹样/);
  assert.match(prompt.userPrompt, /【PLAYER ACTION — THIS HAS ALREADY HAPPENED】/);
  assert.doesNotMatch(prompt.userPrompt, /【本轮末尾必须自然到场的公开压力/);
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
    assert.match(decisionPrompt.userPrompt, new RegExp(escapeRegExp(route.actionText)));
  }
  assert.match(decisionPrompt.systemPrompt, /description 必须逐字复制对应 actionBoundary/);
  assert.doesNotMatch(decisionPrompt.userPrompt, /stateEffects|statePatch|createsPendingConsequence/);
});

test("Narrator receives only the latest changed-situation paragraph from Recent Canon", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  context.sections.recentCanon.items[0]!.narrative = [
    "巡抚书吏先前已经说过米价和空手回去的话。",
    "县令亲随先前已经说明只敢报疑。",
    "案前两边来人都没有退，等总督发出第一道命令。"
  ].join("\n\n");
  const prompt = buildSoloNarratorPrompt(context);
  assert.doesNotMatch(prompt.userPrompt, /先前已经说过米价/);
  assert.doesNotMatch(prompt.userPrompt, /先前已经说明只敢报疑/);
  assert.match(prompt.userPrompt, /案前两边来人都没有退/);
  assert.match(prompt.userPrompt, /NAME_HOLDER_AND_AUTHORIZED_TEXT_ONLY/);
  assert.match(prompt.userPrompt, /AUTHORIZED_STATE_FIELDS_ONLY_NO_NEW_APPEARANCE/);
});

test("Narrator receives a phase-specific material boundary when the action writes a document", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = `${event.actionText}并把责任逐项写入改桑执行回文。`;
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.transitionAllowed = true;
  event.narrativePlan.sceneEnd.timeLabel = "嘉靖三十五年五月初九巳时";
  event.narrativePlan.sceneEnd.locationLabel = "杭州总督府签押房";
  const prompt = buildSoloNarratorPrompt(context);
  assert.match(prompt.userPrompt, /FRESH WRITING MATERIAL-STATE BOUNDARY/);
  assert.match(prompt.userPrompt, /不得在转场前写成/);
  assert.match(prompt.userPrompt, /只有正文明确进入.*五月初九巳时.*签押房\s+后/);
});

test("Narrator requires a declarative institutional action to be spoken verbatim", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = "由总督府定复核清单，巡抚和县令只能派见证人参加。";
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.authorizedPlayerSpeech = [
    "由总督府定复核清单，巡抚和县令只能派见证人参加"
  ];
  const prompt = buildSoloNarratorPrompt(context);
  assert.match(prompt.userPrompt, /PLAYER ACTION PERFORMANCE MODE/);
  assert.match(prompt.userPrompt, /不得只用眼神、摆笔或旁白解释动作含义/);
  assert.match(prompt.userPrompt, /玩家必须在开头逐字说出/);
});

test("Narrator treats an action aimed at an absent register as an order, not an on-site prop scene", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = "原册留在档房，换新封条；总督、县令、巡抚三方各留封样。";
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.authorizedPlayerSpeech = [
    "原册留在档房，换新封条；总督、县令、巡抚三方各留封样"
  ];
  event.narrativePlan.sceneStart.documentStates = [{
    documentRef: "document.qingliu_register_original",
    label: "清流县册原件",
    accessState: "NOT_PRESENT",
    holderRef: null,
    continuityNote: "原件仍在清流县档房。"
  }];
  const prompt = buildSoloNarratorPrompt(context);
  assert.match(prompt.userPrompt, /清流县册原件不在现场/);
  assert.match(prompt.userPrompt, /不得当场取出、换封、盖印、分割或递交/);
  assert.match(prompt.userPrompt, /只写玩家下令，不写实物操作/);
});

test("Decision gate rejects an extra action inferred from the prose", () => {
  const fixture = partOneFixture();
  const routes = fixture.workingSet.decisionAffordances;
  const validation = validateDecisionCopy({
    decisions: routes.map((route, index) => ({
      routeKey: route.affordanceTemplateId,
      description: index === 0
        ? `拒绝书面回复，${route.actionText}`
        : route.actionText
    }))
  }, fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "DECISION_DESCRIPTION_EXCEEDS_ACTION_BOUNDARY"),
    true
  );
});

test("Narrator gate refuses to pay a due consequence that is absent from the prose", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.authoritativeWorldMoves.push({
    beatId: "PAYOFF-TEST-DUE-CONSEQUENCE",
    sourceType: "DUE_CONSEQUENCE",
    sourceId: "PCR-P1-REGISTER-CUSTODY",
    consequenceId: "PC-P1-TEST-DUE",
    actorRefs: ["actor.reform_clerk"],
    action: "改桑书吏当面交代原件与抄件分别由谁经手，证据保管链第一次能够逐项回查。",
    requiredTermGroups: [
      ["改桑书吏"],
      ["原件", "抄件"],
      ["证据保管链", "逐项回查"]
    ],
    resultCeiling: "不得新增县册内容或暗账结论。"
  });
  event.narrativePlan.sceneBeats.push({
    beatId: "PAYOFF-TEST-DUE-CONSEQUENCE",
    sourceType: "WORLD_MOVE",
    action: "改桑书吏当面交代原件与抄件分别由谁经手，证据保管链第一次能够逐项回查。",
    requiredTermGroups: [
      ["改桑书吏"],
      ["原件", "抄件"],
      ["证据保管链", "逐项回查"]
    ],
    mustAppear: true
  });
  const validation = validateNarratorDraft(
    parseNarratorDraft(partOneNarration(fixture)),
    context
  );
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) =>
      issue.code === "COMMITTED_EVENT_NOT_RENDERED"
      && issue.message.includes("改桑书吏当面交代")
    ),
    true
  );
});

test("Narrator gate accepts a committed world move expressed with a close natural synonym", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  const worldMove = {
    beatId: "PAYOFF-TEST-NATURAL-SYNONYM",
    sourceType: "DUE_CONSEQUENCE" as const,
    sourceId: "PCR-P1-EXECUTION-BOUNDARY",
    consequenceId: "PC-P1-TEST-NATURAL-SYNONYM",
    actorRefs: ["actor.xunfu_aide"],
    action: "巡抚幕僚要求把总督已经划定的改桑范围逐项记入往来文书，日后谁想切割责任，都必须先面对这份书面边界。",
    requiredTermGroups: [
      ["巡抚幕僚", "幕僚"],
      ["改桑范围", "执行范围", "清流县试办", "何县试办"],
      ["责任", "具名", "切割首尾", "交代"]
    ],
    resultCeiling: "不得新增另一份已经写成的文书内容。"
  };
  event.authoritativeWorldMoves.push(worldMove);
  event.narrativePlan.presentActorLabels.push("巡抚幕僚");
  event.narrativePlan.sceneEndActorLabels.push("巡抚幕僚");
  event.narrativePlan.sceneBeats.push({
    beatId: worldMove.beatId,
    sourceType: "WORLD_MOVE",
    action: worldMove.action,
    requiredTermGroups: worldMove.requiredTermGroups,
    mustAppear: true
  });
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻，只把“为何暂缓”“三日之内”“范围与方式”说得字字分明。",
    "巡抚幕僚紧接着明言：“改桑限定清流试办，制台划定的范围还应逐项记入往来文书。日后谁想切割干系，也得先过这道书面边界，才好向朝廷交代。”"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate recognizes a messenger pushing the door open and leaving", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "领命退出内厅",
    "转身推门出去"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate recognizes a messenger going to the door and slipping out", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "领命退出内厅",
    "转身到了门边，侧身而出"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not mistake an obeisance toward the xunfu clerk for the clerk leaving", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "清流县令亲随双手接过令牌，领命退出内厅。",
    "清流县令亲随双手接过令牌，又转向巡抚书吏方向略一拱手，随后转身步出内厅。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate recognizes a messenger leaving behind a fallen door curtain", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "清流县令亲随双手接过令牌，领命退出内厅。",
    "清流县令亲随双手接过令牌，转身朝厅门走去，门帘掀动又落下，厅中便少了一人。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate recognizes departure from the actor's later mention in a long scene", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "清流县令亲随双手接过令牌，领命退出内厅。",
    [
      "清流县令亲随双手接过令牌，先退在案前等候。",
      "总督转向巡抚书吏，将暂缓签发和三日复核说得分明。巡抚书吏捧着回文匣没有退。",
      "清流县令亲随这才转身朝厅门走去，迈出门槛，背影消失在门框之外。"
    ].join("")
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate requires every settled player-action meaning to appear", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture)
    .replace(
      fixture.settlement.event.actionText,
      "浙江总督把封缄令牌递给清流县令亲随"
    )
    .replaceAll("封存档房", "交付令牌")
    .replaceAll("档房封存", "令牌交付")
    .replaceAll("封住档房", "交付令牌");
  assert.doesNotMatch(prose, /封存档房/);
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) =>
      issue.code === "COMMITTED_EVENT_NOT_RENDERED"
      && issue.message.includes("封存档房")
    ),
    true,
    JSON.stringify(validation.issues)
  );
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
    recentCanon: [{
      entryId: "canon-opening",
      chronologicalOrder: 1,
      narrative: "总督已经看过清流县令密信，知道信中只报县册数字似有改痕，不能凭信定罪。巡抚催办公文也已翻到末页，三日具报的期限就在案前。"
    }],
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

test("Narrator gate rejects invented document clues and quantified public events", () => {
  const fixture = partOneFixture();
  const draft = parseNarratorDraft([
    partOneNarration(fixture),
    "书吏袖中露出一页墨迹未干的催问条陈，像是早已备好。门外又有人来报，东门已有三家米铺闭门。"
  ].join("\n\n"));
  const validation = validateNarratorDraft(draft, fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.ok(validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_DISCOVERY"));
  assert.ok(validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"));
});

test("Narrator gate rejects an unapproved paper prop added only to stage the scene", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。",
    "巡抚书吏另取一纸铺在案边，仍在门内等候。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_DISCOVERY"),
    true
  );
});

test("Narrator gate allows neutral atmosphere on an already established document", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "晨光落在案上的密信纸面，窗下的砖缝泛着五月潮气，内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows an authorized fresh-ink attribute after the settled action writes the document", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = `${event.actionText}并把执行边界写进放行文书。`;
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.sceneBeats[0]!.action = event.actionText;
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "放行文书搁在案上，纸页被窗光切作明暗两半，墨迹未干处还泛着一点亮；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows not-yet-dry ink on the document written in the settled action", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = `${event.actionText}并把执行边界写进放行文书。`;
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.sceneBeats[0]!.action = event.actionText;
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "放行文书刚刚写罢，墨迹还没干透；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows the settled writing to dry across an authorized next-day transition", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = `${event.actionText}并把执行边界写进放行文书。`;
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.sceneBeats[0]!.action = event.actionText;
  event.narrativePlan.transitionAllowed = true;
  event.narrativePlan.sceneEnd.timeLabel = "嘉靖三十五年五月初九巳时";
  event.narrativePlan.sceneEnd.locationLabel = "杭州总督府签押房";
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "次日巳时，放行文书仍摊在案上，墨迹已干；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects drying the settled writing before the authorized transition occurs", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = `${event.actionText}并把执行边界写进放行文书。`;
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.sceneBeats[0]!.action = event.actionText;
  event.narrativePlan.transitionAllowed = true;
  event.narrativePlan.sceneEnd.timeLabel = "嘉靖三十五年五月初九巳时";
  event.narrativePlan.sceneEnd.locationLabel = "杭州总督府签押房";
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "放行文书刚刚写罢，墨迹已经干透。次日巳时，签押房内仍只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_MATERIAL_ATTRIBUTE"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate allows an inherited dry-ink state from Recent Canon", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  context.sections.recentCanon.items[0]!.narrative =
    "次日巳时，改桑执行回文仍摊在签押房案上，墨迹已经干透。";
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "改桑执行回文仍在案上，墨迹已干透；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects replacing the settled document with a new blank reply sheet", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = `${event.actionText}并把执行边界写进放行文书。`;
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.sceneBeats[0]!.action = event.actionText;
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "总督在空白的回文纸上落笔；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_DOCUMENT_INTRODUCTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects a new blank generic document sheet", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = `${event.actionText}并把执行边界写进放行文书。`;
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.sceneBeats[0]!.action = event.actionText;
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "总督从案上取过一张空文纸，提笔落字；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_DOCUMENT_INTRODUCTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate allows only the minimum procedure implied by a settled archive seal", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "话说完，他看着阶下的人把这道命令听全",
    "他只补了一句：“一应册籍不许移动，不许誊抄，不许任何人调阅。”话说完，他看着阶下的人把这道命令听全"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects a second attendant and an invented courier round trip", () => {
  const fixture = partOneFixture();
  const invalid = [
    "总督叫自己的亲随近前，把令牌交给他。清流县令亲随仍举着封套，在一旁等候。总督当面答复巡抚书吏，暂缓签发，三日内复核。",
    "两名亲随各自听命。持令亲随出了内厅，巡抚书吏也捧着回文匣离府。厅里一时只剩总督与案上的两封文书，谁也没有再开口。",
    "不过半个时辰，巡抚书吏又回来了。他隔着屏风转述巡抚的催问，要求总督说明复核范围与方式。总督没有答应新的文书，只把手按在案沿。",
    "书吏仍站在屏风外等候。封存尚未完成，县册疑点也仍未核验，眼前只有这句催问需要总督回应。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(invalid), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_SCENE_TRANSITION"), true);
});

test("Narrator gate allows a non-factual one-day comparison in an NPC warning", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "他又照原话补了一句：“桑田改放一日不决，百姓便多一日惶惑。”他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows an authorized deadline with a remaining-time prefix", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "书吏又道：“中丞的期限也只余三日。”他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not treat idiomatic degree or document classifiers as new quantities", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "书吏的声音冷了几分：“中丞还要一份明确的回复。”他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate treats every person as a universal phrase, not a new headcount", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "幕僚退后半步，让在场每一个人都看清案前的回文"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate treats two people as the two named non-player actors in the sentence", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  plan.sceneStartActorLabels = ["浙江总督", "巡抚幕僚", "清流县令", "改桑书吏"];
  plan.sceneEndActorLabels = [...plan.sceneStartActorLabels];
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "总督的目光先落在巡抚幕僚身上，再移到清流县令脸上，示意两人听令"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate treats three people as the three named non-player actors in the sentence", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  plan.sceneStartActorLabels = ["浙江总督", "巡抚幕僚", "清流县令", "改桑书吏"];
  plan.sceneEndActorLabels = [...plan.sceneStartActorLabels];
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "总督看清流县令和改桑书吏各站一侧，巡抚幕僚立在后方，三人的话头都悬在县册上"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate treats a named county followed by 一县 as the existing place, not a new quantity", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "总督没有替尚未完成的封存和复核预写结果",
    "总督只准清流一县试办，没有替尚未完成的封存和复核预写结果"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate treats later 试办一县 as the same county named earlier in the paragraph", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "总督没有替尚未完成的封存和复核预写结果",
    "幕僚先问清流县是否试办，继而道：“试办一县，具名担责的是谁？”总督没有替尚未完成的封存和复核预写结果"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate treats 哪一县 as an interrogative boundary, not a newly settled county count", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "总督没有替尚未完成的封存和复核预写结果",
    "书吏只追问哪一县先试办；总督没有替尚未完成的封存和复核预写结果"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate treats 这一县 as a reference to the already named county", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "总督没有替尚未完成的封存和复核预写结果",
    "清流县的复核已经起步，这一县仍由总督府主持；总督没有替尚未完成的封存和复核预写结果"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("limited-trial action accepts natural pilot wording while preserving every action group", () => {
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const openingSettlement = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      actionText: "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。"
    },
    1
  );
  const limitedTrial = settlePartOneAction(
    pkg,
    openingSettlement.proposedState,
    {
      source: "RECOMMENDED",
      decisionId: "DK-P1-EXECUTION-SCOPE-OPT-01",
      actionText: "只准清流县先办一批，并把不得压价买田写进放行文书。"
    },
    2
  );
  const actionGroups = limitedTrial.event.narrativePlan.sceneBeats
    .find((beat) => beat.sourceType === "PLAYER_ACTION")!
    .requiredTermGroups;
  assert.equal(
    actionGroups.some((group) => group.includes("清流县试办")),
    true,
    JSON.stringify(actionGroups)
  );
});

test("Narrator gate rejects a representative who produces an unapproved second document", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。",
    "巡抚书吏从袖中取出一份折好的手本，双手递向案前，随后仍在门内等候。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_DOCUMENT_INTRODUCTION"),
    true
  );
});

test("Narrator gate rejects rewriting an already read secret letter as unopened", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "清流县令密信仍压在案角，封口完好，总督尚未拆阅。内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true
  );
});

test("Narrator gate rejects the governor moving a reply box held by the xunfu clerk", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "总督将回文匣搁在案角，内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true
  );
});

test("Narrator gate rejects changing an empty closed reply box without a settled handoff", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "空匣的分量比来时轻，匣盖也已经虚掩；内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true
  );
});

test("Narrator gate allows a clerk to touch the closed reply box without opening it", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "巡抚书吏的手指在回文匣上虚按了一下，没有打开；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows a clerk to consider opening the closed box without changing its state", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "巡抚书吏扶着空匣，像是在掂量该不该把匣盖打开；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate still rejects opening the box after first discussing whether to open it", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "巡抚书吏先问该不该打开，随即把匣盖打开了；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects describing an empty reply box as literally weightless", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "空匣仍合着盖，在巡抚书吏手里没有一丝分量。内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true
  );
});

test("Narrator gate allows the governor to pick up an object before its settled handoff", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "浙江总督把手按在案沿",
    "浙江总督把封缄令牌从案上拿起，递向清流县令亲随，随后把手按在案沿"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate does not confuse the authorized county messenger with the magistrate", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "浙江总督把手按在案沿",
    "浙江总督向清流县令亲随那边略一抬手，亲随上前两步接过封缄令牌，随后总督把手按在案沿"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate rejects inventing a storage position for the transferred seal token", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "话说完，他看着阶下的人把这道命令听全",
    "清流县令亲随把封缄令牌收入袖中。话说完，他看着阶下的人把这道命令听全"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true
  );
});

test("Narrator gate rejects inventing an initial desk storage position for the seal token", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "浙江总督把手按在案沿",
    "浙江总督从案后取出封缄令牌，递向清流县令亲随，随后把手按在案沿"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate allows the governor to stand from behind the desk before handing over the seal token", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "浙江总督把手按在案沿",
    "浙江总督从案后立起，将封缄令牌递向清流县令亲随，随后把手按在案沿"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects physically presenting an object held by an absent actor", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  const sealToken = (plan.sceneStart.objectStates || []).find(
    (object) => object.objectRef === "object.governor_seal_token"
  );
  assert.ok(sealToken);
  sealToken.holderRef = "actor.qingliu_messenger";
  plan.sceneStart.presentActorRefs = plan.sceneStart.presentActorRefs.filter(
    (actorRef) => actorRef !== "actor.qingliu_messenger"
  );
  const prose = partOneNarration(fixture).replace(
    "浙江总督把手按在案沿",
    "浙江总督没有去碰那枚总督封缄令牌，只把手按在案沿"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects putting a departed reply box back beside a new scene actor", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  plan.sceneStart.objectStates = [];
  plan.sceneEnd.objectStates = [];
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "巡抚幕僚看了一眼自己手边那只仍合着的空匣"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects a county register original that is marked not present", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  context.sections.partOneSettlement.items[0]!.narrativePlan.sceneStart.documentStates = [
    {
      documentRef: "document.qingliu_register_original",
      label: "清流县册原件",
      accessState: "NOT_PRESENT",
      holderRef: null,
      continuityNote: "原件尚未呈到签押房。"
    }
  ];
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "清流县令捧着县册原件走到案前，内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true
  );
});

test("Narrator gate does not confuse a future modal delivery with a document already on scene", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  context.sections.partOneSettlement.items[0]!.narrativePlan.sceneStart.documentStates = [{
    documentRef: "document.qingliu_register_original",
    label: "清流县册原件",
    accessState: "NOT_PRESENT",
    holderRef: null,
    continuityNote: "原件尚未呈到签押房。"
  }];
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "清流县册原件仍在清流，待奉令后才可呈到签押房"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) =>
      issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"
      && issue.message.includes("文书状态")
    ),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects physical seal-sample handling when the register stays off scene", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = "原册留在档房，换新封条；总督、县令、巡抚三方各留封样。";
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.sceneStart.documentStates = [{
    documentRef: "document.qingliu_register_original",
    label: "清流县册原件",
    accessState: "NOT_PRESENT",
    holderRef: null,
    continuityNote: "原件仍在清流县档房。"
  }];
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "改桑书吏递上换新封条，总督亲手在封样上压印"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate applies separate actor rosters before and after a scene transition", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  plan.transitionAllowed = true;
  plan.sceneStartActorLabels = ["浙江总督", "巡抚书吏", "清流县令亲随", "巡抚幕僚"];
  plan.sceneEndActorLabels = ["浙江总督", "清流县令", "改桑书吏", "巡抚幕僚"];
  plan.sceneEnd.timeLabel = "嘉靖三十五年五月初九巳时";
  plan.sceneEnd.locationLabel = "杭州总督府签押房";
  const prose = `${partOneNarration(fixture)}\n\n次日巳时，签押房。浙江巡抚没有起身，只看着案前众人。`;
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_ACTION"),
    true
  );
});

test("Narrator gate allows the authorized next day to be called the second day", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  const plan = event.narrativePlan;
  plan.transitionAllowed = true;
  plan.sceneStartActorLabels = ["浙江总督", "巡抚书吏", "清流县令亲随", "巡抚幕僚"];
  plan.sceneEndActorLabels = ["浙江总督", "清流县令", "改桑书吏", "巡抚幕僚"];
  plan.sceneEnd.timeLabel = "嘉靖三十五年五月初九巳时";
  plan.sceneEnd.locationLabel = "杭州总督府签押房";
  event.authoritativeWorldMoves.push({
    beatId: "TRANSITION-TEST-SECOND-DAY",
    sourceType: "SECTION_TRANSITION",
    sourceId: "SEC-P1-02",
    actorRefs: ["actor.xunfu_aide"],
    action: "议事转到次日巳时的杭州总督府签押房。",
    requiredTermGroups: [["次日巳时"], ["签押房"]],
    resultCeiling: "只能推进到次日签押房。"
  });
  const prose = `${partOneNarration(fixture)}\n\n次日巳时，签押房。巡抚幕僚只说：“三日限期，今日已是第二日。”`;
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate rejects a named actor who acts outside the authorized scene roster", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "浙江巡抚站在幕僚身后，目光落在案前。内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_ACTION"),
    true
  );
});

test("Narrator gate rejects an unlisted superior who enters with the authorized aide", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "浙江巡抚进了内厅，身后跟着幕僚。内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_ACTION"),
    true
  );
});

test("Narrator gate rejects an unlisted superior introduced as 本人 and then seated by pronoun", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。",
    "巡抚书吏一直在门内等候。廊下却有人陪着浙江巡抚本人进来。他朝总督拱手，随即在客位落座。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_ACTION"),
    true
  );
});

test("Narrator gate rejects an invented personal name for an authorized unnamed actor", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  plan.sceneStartActorLabels.push("巡抚幕僚");
  plan.sceneEndActorLabels.push("巡抚幕僚");
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。",
    "巡抚书吏一直在门内等候。巡抚幕僚沈某向总督行了一揖。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_IDENTITY"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate allows an ordinary direct address to 大人", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句",
    "他只道：“那便请大人明示。”他没有替巡抚加一句"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_IDENTITY"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate does not treat a vague duration as a settled numeric deadline", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "书吏又道：“城中米价连涨，中丞说这几日等不起含糊话。”他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects player commitments beyond the settled action", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "没有再添别的吩咐",
    "又道：“三日内本督亲自复核，届时书面回复中丞。”"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_COMMITMENT"),
    true
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_SPEECH"),
    true
  );
});

test("Narrator gate rejects a new delivery promise invented for an NPC", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "巡抚书吏又保证随时可以把县册送到签押房。他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_NPC_COMMITMENT"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate keeps a clerk's written-reply demand attributed to the clerk", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。总督的话落下后，他先垂眼停了片刻，随后依照巡抚的原话回禀：",
    "总督抬眼看他，没有答话。书吏等了片刻，又依照巡抚的原话回禀："
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not attribute the clerk's quote to a governor mentioned in narration", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "书吏目光扫过令牌，又落回总督脸上：“若无具体范围与方式，三日后拿什么具报？”他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not carry a governor's non-speech verb across a sentence boundary", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。总督的话落下后，他先垂眼停了片刻，随后依照巡抚的原话回禀：",
    "总督没有立刻答。书吏又依照巡抚的原话回禀："
  ).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "书吏又道：“还请总督书面写明复核的范围与方式。”他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not treat 看见总督搁笔 as the governor speaking", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。总督的话落下后，他先垂眼停了片刻，随后依照巡抚的原话回禀：",
    "巡抚书吏一直在门内等候。他看见总督搁笔，往前半步，低声道："
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not treat a clerk speaking after watching the governor set down his brush as governor speech", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。总督的话落下后，他先垂眼停了片刻，随后依照巡抚的原话回禀：",
    "巡抚书吏仍捧着回文匣。他看着总督搁笔，等了片刻，才开口，声音不高："
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not treat a clerk speaking after waiting for the governor to set down his brush as governor speech", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。总督的话落下后，他先垂眼停了片刻，随后依照巡抚的原话回禀：",
    "巡抚书吏一直站在厅中，双手按着那只空匣。他等总督搁了笔，才开口，声音不高："
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not treat a clerk speaking after looking back at the governor as governor speech", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。总督的话落下后，他先垂眼停了片刻，随后依照巡抚的原话回禀：",
    "巡抚书吏的目光回到总督按住的回文上，停了一拍，才慢慢说："
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate catches a player commitment in adjacent unattributed dialogue", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    `浙江总督把手按在案沿，没有再解释密信里尚未查清的疑处，只把已经作出的处置说得清楚：${fixture.settlement.event.actionText}。`,
    "总督转向屏风外。“改桑文书暂缓签发。三日内复核，届时具报。”"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_COMMITMENT"),
    true
  );
});

test("Narrator gate catches governor speech after an explicit open even when another actor is described", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "总督这时才开口，声音不高，却让幕僚退了半步：“说清楚。谁该具名，谁可具名，不必绕。”"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_SPEECH"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects uncommitted time advances and document attributes", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "窗外日头已经偏过檐角，催办日期的墨迹干透了"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_TIME_ADVANCE"),
    true
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_MATERIAL_ATTRIBUTE"),
    true
  );
});

test("Narrator gate rejects a sun shadow moving across the window lattice", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "窗外日影缓缓移过窗棂"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_TIME_ADVANCE"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects window light moving within an untransitioned scene", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "光从窗棂移过来，窗棂外的光又移了半寸"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_TIME_ADVANCE"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate allows two people when the sentence names the exact actor pair", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.narrativePlan.sceneEndActorLabels = [
    "浙江总督",
    "巡抚幕僚",
    "清流县令",
    "改桑书吏"
  ];
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "幕僚便转向县令与书吏，将身子微微一侧，正对着两人"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects a wrong count of people remaining in the room", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "亲随离场以后，厅里只剩三个人"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects the wrong number of documents declared on the desk", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "总督案前的三份文书并排搁着"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate accepts two individually enumerated documents on the desk", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "案上一封催办公文、一封密信，都摊在总督手边"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects a remaining-room roster that silently drops the governor", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "厅里只剩案上两封文书和巡抚书吏捧着的空回文匣"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate does not mistake only the listed actors' sounds for a room roster", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  plan.sceneStartActorLabels = ["浙江总督", "巡抚书吏", "巡抚幕僚"];
  plan.sceneEndActorLabels = [...plan.sceneStartActorLabels];
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "厅里只剩书吏捧匣站着、幕僚候答不退的动静"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) =>
      issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"
      && issue.message.includes("在场人数")
    ),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate accepts an unambiguous short label for the only clerk in the room", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "厅中剩下总督、书吏，和案上两封已经拆阅的文书"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects a wrong declared character count for the following quote", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "总督开口说了八个字：“持此去清流，封存档房。”"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate allows the correct count after the messenger leaves", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "门帘落下，厅里只剩总督与巡抚书吏两人"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows a relative correct count after the messenger leaves", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "亲随脚步声沿廊下远去，厅中只剩两人"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects blank register volumes carried into the transition scene", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "改桑书吏搬了一摞空册进来，放在案角"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_DOCUMENT_INTRODUCTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects invented dampness, ink comparison and prior-day residue on evidence", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    [
      "催办公文的墨色比别处沉，密信纸角微卷，像被潮气压过一夜",
      "砚池里还留着昨日干涸的残渍"
    ].join("；")
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_MATERIAL_ATTRIBUTE"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects an invented official seal on a known document", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "催办公文的印信压在案上；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_MATERIAL_ATTRIBUTE"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects an invented copper clasp on the reply box", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "巡抚书吏的手指在回文匣的铜扣上虚按了一下；内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_MATERIAL_ATTRIBUTE"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate allows same-scene atmospheric light without treating it as a time jump", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "窗外晨光渐白，内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows ordinary dry ink on the already issued urging document", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "案上那封催办公文墨迹已干，内厅只剩茶盏轻触案面的声音"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate rejects re-anchoring an authorized deadline to the current moment", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "三日期限从此刻起算。内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_DEADLINE_ANCHOR"),
    true
  );
});

test("Narrator gate rejects saying that the three-day deadline starts now", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "三日从这一刻起已经开始走了。内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_DEADLINE_ANCHOR"),
    true
  );
});

test("Narrator gate rejects invented identifying texture on a known official object", () => {
  const fixture = partOneFixture();
  const prose = [
    "令牌搁在案上，铜面朝上，刻着总督衙门的封缄纹。清流县令亲随上前一步，双手接过，退后时将令牌收入怀中贴身藏好。总督没有多余的话，目光从令牌移到巡抚书吏身上，只说了一句：暂缓签发，三日内复核。书吏应了一声，却没有退。",
    "厅中静了一瞬。巡抚书吏微微躬身，两手交叠在身前，像把这句话在心里过了一遍。他来时受了交代，此刻不能只领一句话便走。他抬起头，语气平稳，却一字不让：总督既已下令封存档房，为何暂缓签发？",
    "他顿了顿，紧接着补上第二句：三日期限之内，还请总督书面回复，写明复核的范围与方式。说完便垂下眼，不再多言。意思已很清楚——口头答复不够。",
    "清流县令亲随立在一旁，怀中揣着令牌，也揣着那封密信，两样东西贴着胸口，一硬一软。他低着头，目光落在自己靴尖上。总督没有立刻回答，指节在案面上轻轻叩了一下，声音不大，却让厅中更静了几分。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) =>
      issue.code === "UNSUPPORTED_PART_ONE_DISCOVERY"
      || issue.code === "UNAUTHORIZED_PART_ONE_MATERIAL_ATTRIBUTE"
    ),
    true,
    JSON.stringify(validation.issues)
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
      actionText: "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。"
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
    recentCanon: [{
      entryId: "canon-opening",
      chronologicalOrder: 1,
      narrative: "总督已经看过清流县令密信，知道信中只报县册数字似有改痕，不能凭信定罪。巡抚催办公文也已翻到末页，三日具报的期限就在案前。"
    }],
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
  return [
    `浙江总督把手按在案沿，没有再解释密信里尚未查清的疑处，只把已经作出的处置说得清楚：${event.actionText}。清流县令亲随双手接过令牌，领命退出内厅。话说完，他看着阶下的人把这道命令听全，没有再添别的吩咐。${factText}。`,
    `巡抚书吏一直在门内等候。总督的话落下后，他先垂眼停了片刻，随后依照巡抚的原话回禀：${reactionText}。他没有替巡抚加一句，也没有把催问说得更轻，只把“为何暂缓”“三日之内”“范围与方式”说得字字分明。`,
    `内厅只剩茶盏轻触案面的声音。总督没有替尚未完成的封存和复核预写结果，巡抚书吏也没有退下；案前隔着的，仍是已经发出的命令和必须书面说明的责任。书吏垂手候在原处，等总督对这番催问作答。`
  ].join("\n\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
