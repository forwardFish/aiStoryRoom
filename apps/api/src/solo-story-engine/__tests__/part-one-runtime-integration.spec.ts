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
  assert.match(prompt.userPrompt, /【最近正文】/);
  assert.match(prompt.systemPrompt, /全文至少两个自然段/);
  assert.match(prompt.systemPrompt, /第一自然段只负责完整演出已结算行动/);
  assert.match(prompt.systemPrompt, /进入第二自然段后，不得再让玩家角色下令、答复、追问、承诺、批准或决定新事项/);
  assert.match(prompt.userPrompt, /总督已经看过清流县令密信/);
  assert.match(prompt.userPrompt, /巡抚催办公文也已翻到末页/);
  assert.match(prompt.userPrompt, /【当前现场】/);
  assert.match(prompt.userPrompt, /开场在场人物：浙江总督、巡抚书吏、清流县令亲随/);
  assert.match(prompt.userPrompt, /巡抚催办公文由浙江总督持有，已经读过/);
  assert.match(prompt.userPrompt, /清流县令密信由浙江总督持有，已经读过/);
  assert.match(prompt.userPrompt, /【玩家行动呈现方式】/);
  assert.match(prompt.userPrompt, /玩家选择中包含必须传达给在场对象的命令、追问或答复/);
  assert.match(prompt.userPrompt, /不能改成点头、递物、敲案、指向或其他手势暗示/);
  assert.match(prompt.userPrompt, /【玩家行动之后必须发生的场景推进】/);
  assert.match(
    prompt.userPrompt,
    /【玩家刚刚选择的行动（已经结算；以下步骤属于同一选择，正文开头依次明确发生）】/
  );
  assert.match(prompt.userPrompt, /1\. 行动者：浙江总督。已完成：将总督封缄令牌交给清流县令亲随/);
  assert.match(prompt.userPrompt, /2\. 行动者：浙江总督。已完成：命他向清流县传达封存档房之令/);
  assert.match(prompt.userPrompt, /3\. 行动者：浙江总督。已完成：同时当面答复巡抚书吏：暂缓签发，三日内复核/);
  assert.match(prompt.userPrompt, /不能只让其他人物事后提及或转述/);
  assert.match(prompt.userPrompt, /【正文两阶段边界】/);
  assert.match(prompt.userPrompt, /第一自然段必须把上述每一步全部演完/);
  assert.match(prompt.userPrompt, /“玩家行动之后必须发生的场景推进”从第二自然段开始/);
  assert.match(prompt.userPrompt, /清流县令亲随接令后领命退出杭州总督府内厅/);
  assert.match(prompt.userPrompt, /巡抚书吏当场追问总督为何暂缓签发/);
  assert.match(prompt.userPrompt, /本场结束时仍在场人物：浙江总督、巡抚书吏/);
  assert.match(prompt.userPrompt, /不得给催办公文补写日期、落款、原话或其他内容/);
  assert.match(prompt.userPrompt, /【在场人物说话边界】/);
  assert.match(prompt.userPrompt, /巡抚书吏：自称“卑职”，称总督“部堂”或“大人”/);
  assert.match(prompt.userPrompt, /清流县令亲随：只传达县令已经报疑并等待上命/);
  assert.match(prompt.userPrompt, /【原著场面机制】/);
  assert.match(prompt.userPrompt, /让冲突通过人物动作、追问和停顿发生，不用旁白解释规则/);
  assert.doesNotMatch(prompt.userPrompt, /用急递、具名和领命把争论转成下一场的实际压力/);
  assert.doesNotMatch(prompt.userPrompt, /先提高声量|先定性|裁定发生后才允许掌权者离座/);
  assert.match(prompt.userPrompt, /可用“候上命再启”写出封存的最低限度含义/);
  assert.match(prompt.userPrompt, /不得扩写钥匙归属、册籍清单、出入禁令、具体启封人员、差员到场/);
  assert.match(prompt.userPrompt, /不得承诺复核后一定落印、再定行止或另给新期限/);
  assert.match(prompt.userPrompt, /【事实边界】/);
  assert.match(prompt.userPrompt, /幕后主使、暗账全貌和未呈到的证据都还没有查明/);
  assert.match(prompt.userPrompt, /【收束方式】/);
  assert.match(prompt.userPrompt, /本场文书保持开场状态；催问只通过人物当面对话发生/);
  assert.match(prompt.userPrompt, /【本场篇幅】\nSHORT_RESPONSE：建议 220—380 字，硬范围 160—480 字；2—7 个自然段/);
  assert.match(prompt.userPrompt, /不把每句短对白单独拆段/);
  assert.doesNotMatch(prompt.userPrompt, /复核启动方式已经确定|无须离场送达/);
  assert.doesNotMatch(
    prompt.userPrompt,
    /continuityNote|physicalDescriptionPolicy|holderRef|objectRef|documentRef|accessState|AUTHORIZED_|MANDATORY_|REQUIRED_END_CHANGE/
  );
  assert.equal(
    countOccurrences(prompt.userPrompt, "将总督封缄令牌交给清流县令亲随"),
    1
  );
  assert.equal(
    countOccurrences(prompt.userPrompt, "命他向清流县传达封存档房之令"),
    1
  );
  assert.equal(
    countOccurrences(prompt.userPrompt, "同时当面答复巡抚书吏：暂缓签发，三日内复核"),
    1
  );
  assert.equal(countOccurrences(prompt.userPrompt, "完整执行上一选择"), 0);
  assert.doesNotMatch(prompt.userPrompt, /上一选择已经推动的处置/);
  assert.ok(
    prompt.userPrompt.lastIndexOf("【玩家刚刚选择的行动")
      > prompt.userPrompt.lastIndexOf("【玩家行动之后必须发生的场景推进】")
  );
  assert.equal(prompt.userPrompt.trimEnd().endsWith("新的压力留给下一组玩家决策。"), true);
  assert.match(prompt.systemPrompt, /最近正文是已经发生的最高连续性依据/);
  assert.match(prompt.systemPrompt, /不解释后台规则/);
  assert.match(prompt.systemPrompt, /之后不再总结形势、清点尚未发生的事/);
  assert.ok(prompt.systemPrompt.length < 1100);
  assert.ok(prompt.userPrompt.length < 5200);
  assert.doesNotMatch(prompt.userPrompt, /routeKey|affordanceTemplateId|stateEffects|statePatch/);
  assert.doesNotMatch(prompt.systemPrompt, /LEGAL_NEXT_DECISION_SEEDS/);
  const playerActionBeats = fixture.settlement.event.narrativePlan.sceneBeats.filter(
    (beat) => beat.sourceType === "PLAYER_ACTION"
  );
  assert.deepEqual(
    playerActionBeats.map((beat) => beat.action),
    [
      "将总督封缄令牌交给清流县令亲随",
      "命他向清流县传达封存档房之令",
      "同时当面答复巡抚书吏：暂缓签发，三日内复核"
    ]
  );
  assert.deepEqual(
    playerActionBeats[0]!.requiredTermGroups,
    [
      ["封缄令牌", "总督令牌", "令牌"],
      ["交给", "交到", "交予", "递给", "递到", "搁到", "放到", "接过", "接下"],
      ["清流县令亲随", "县令亲随", "清流亲随", "亲随"]
    ]
  );
  assert.deepEqual(
    playerActionBeats[1]!.requiredTermGroups,
    [
      [
        "EXACT:命他",
        "EXACT:命其",
        "EXACT:命亲随",
        "EXACT:命清流县令亲随",
        "EXACT:吩咐他",
        "EXACT:吩咐亲随",
        "EXACT:吩咐清流县令亲随",
        "EXACT:责令",
        "EXACT:下令",
        "EXACT:交代他",
        "EXACT:交代亲随"
      ],
      ["封存档房", "档房封存", "封住档房"],
      ["封存", "封条", "封缄"]
    ]
  );
  assert.deepEqual(
    playerActionBeats[2]!.requiredTermGroups,
    [
      ["三日内复核", "三日期限内复核"],
      ["暂缓签发", "暂不签发", "扣下不签"],
      [
        "EXACT:答复巡抚书吏",
        "EXACT:答复书吏",
        "EXACT:告知巡抚书吏",
        "EXACT:告知书吏",
        "EXACT:告诉巡抚书吏",
        "EXACT:告诉书吏",
        "EXACT:回告巡抚书吏",
        "EXACT:回告书吏",
        "EXACT:面告巡抚书吏",
        "EXACT:面告书吏",
        "EXACT:对巡抚书吏说明",
        "EXACT:对书吏说明",
        "EXACT:向巡抚书吏说明",
        "EXACT:向书吏说明",
        "EXACT:命书吏转告",
        "EXACT:总督转向他，当面答复",
        "EXACT:总督转面答复",
        "EXACT:总督当面答复"
      ],
      ["巡抚书吏", "书吏"],
      ["复核"]
    ]
  );
  assert.equal(
    playerActionBeats.every((beat) => beat.requiredTermGroups.length > 0),
    true
  );
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

test("T02 narrator receives only physically available foreground props", () => {
  const fixture = partOneSecondTurnFixture();
  const prompt = buildSoloNarratorPrompt(fixture.context);
  const currentScene = prompt.userPrompt
    .split("【当前现场】")[1]
    ?.split("【玩家行动呈现方式】")[0] || "";

  assert.match(
    currentScene,
    /当前可用动作落点：巡抚回文匣由巡抚书吏持有，合拢、里面是空的/
  );
  assert.match(
    currentScene,
    /人物可以继续捧持、按住或收紧手指；物件持有人、开合和内容沿用上句状态/
  );
  assert.doesNotMatch(currentScene, /不得另造其中的文书|不得擅自改变持有人/);
  assert.doesNotMatch(currentScene, /总督封缄令牌/);
  assert.doesNotMatch(currentScene, /场外持有人/);
});

test("T02 narrator receives the authorized reply plus a consumed creation-texture boundary", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prompt = buildSoloNarratorPrompt(fixture.context);
  const currentScene = prompt.userPrompt
    .split("【当前现场】")[1]
    ?.split("【玩家行动呈现方式】")[0] || "";

  assert.match(
    currentScene,
    /本场唯一发生变化的文书：改桑放行回文将在本场写成，写成后由巡抚书吏持有/
  );
  assert.match(
    currentScene,
    /改桑放行回文由浙江总督在本场当面提笔写成/
  );
  assert.match(
    currentScene,
    /落字后直接称“改桑放行回文”，写成后按上句移交/
  );
  assert.match(
    currentScene,
    /普通纸张与笔墨可以短暂作为一次性过程细节出现；它们落字后就是同一份已获批文书/
  );
  assert.doesNotMatch(
    currentScene,
    /空白纸页|行牌|札纸|手本/
  );
  assert.match(
    currentScene,
    /其余现有文书只作为原状背景：巡抚催办公文、清流县令密信/
  );
  assert.match(
    currentScene,
    /本场没有续写或移交动作/
  );
  assert.match(
    currentScene,
    /本场授权的物件变化：巡抚回文匣起初由巡抚书吏持有，合拢、里面是空的；本场结束时由巡抚书吏持有，合拢、里面已有文书/
  );
  assert.match(
    currentScene,
    /浙江总督当场写成改桑放行回文并递给巡抚书吏/
  );
  assert.match(
    currentScene,
    /巡抚书吏始终捧持巡抚回文匣，由巡抚书吏本人启开匣盖、收入改桑放行回文并重新合拢/
  );
  assert.doesNotMatch(
    currentScene,
    /不得让浙江总督拿取、开启、合拢或推递巡抚回文匣/
  );
  assert.doesNotMatch(
    prompt.userPrompt,
    /共同具名|联署|署名|画押|姓名在上|名字写在/
  );
  assert.doesNotMatch(
    prompt.userPrompt,
    /让关系变化通过递交或拒绝一件有政治含义的物件完成/
  );
  assert.doesNotMatch(
    prompt.userPrompt,
    /用人物的追问、回答、停顿、递交、拒绝和在场反应呈现冲突/
  );
  assert.match(
    prompt.userPrompt,
    /巡抚幕僚：只在巡抚已经授权的范围内争时限、复核权和责任记录/
  );
  assert.match(
    prompt.userPrompt,
    /要求派员到场参与复核，并在复核发生后把到场查验经过据实记入复核记录/
  );
});
test("Recent Canon keeps the named actor with a closing pronoun gesture", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const context = structuredClone(fixture.context);
  context.sections.recentCanon.items = [{
    entryId: "canon-t01-next",
    chronologicalOrder: 2,
    narrative: [
      "书吏双手仍捧着那只合拢的空回文匣，十指收紧了一线，没有退。",
      "他低头道：“卑职不敢催问部堂决断，只是抚院催取回文，上头要的是落印，不是暂缓。”",
      "他把回文匣往前微微一送，又收住，没有再往前递。"
    ].join("")
  }];
  const prompt = buildSoloNarratorPrompt(context);
  const recentCanon = prompt.userPrompt
    .split("【最近正文】")[1]
    ?.split("【当前现场】")[0] || "";

  assert.match(recentCanon, /^(\r?\n)?书吏双手仍捧着那只合拢的空回文匣/);
  assert.match(recentCanon, /他把回文匣往前微微一送，又收住，没有再往前递/);
  assert.notEqual(
    recentCanon.trim(),
    "他把回文匣往前微微一送，又收住，没有再往前递。"
  );
});


test("Narrator budget grants a bounded short-scene extension only for an authorized actor arrival", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.narrativePlan.authorizedActorArrivals.push("巡抚幕僚");
  const prompt = buildSoloNarratorPrompt(context);
  assert.match(
    prompt.userPrompt,
    /【本场篇幅】\nSHORT_RESPONSE：建议 220—420 字，硬范围 160—520 字；2—7 个自然段/
  );
});

test("Narrator parser preserves an exact two-paragraph short scene", () => {
  const prose = [
    "总督把令牌交给亲随，命他传达封存档房之令；亲随接令后退出内厅。",
    "巡抚书吏仍候在案前，追问三日内复核的范围与方式。"
  ].join("\n\n");
  const draft = parseNarratorDraft(prose);
  assert.equal(draft.rawProse, prose);
  assert.equal(draft.actionNarrative, prose.split("\n\n")[0]);
  assert.equal(draft.worldResponseNarrative, prose.split("\n\n")[1]);
  assert.equal(draft.resultNarrative, prose.split("\n\n")[0]);
  assert.equal(draft.nextSituationNarrative, prose.split("\n\n")[1]);
});

test("Narrator gate requires every settled player-action beat in the first prose phase", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到亲随手中，命他回清流县传令封存档房。亲随领命退出内厅。",
    "巡抚书吏等门帘落下才躬身道：“大人既示暂缓，三日之内如何复核，还请给卑职一个书面说法。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) =>
      issue.code === "COMMITTED_EVENT_NOT_RENDERED"
      && issue.message.includes("当面答复巡抚书吏")
    ),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects a new governor answer after the world response begins", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "书吏垂手候在原处，等总督对这番催问作答。",
    "总督听完便告诉他：先查经手人名，查完再行知会。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "PLAYER_ACTION_AFTER_WORLD_RESPONSE"),
    true,
    JSON.stringify(validation.issues)
  );
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
  assert.doesNotMatch(prompt.userPrompt, /NAME_HOLDER_AND_AUTHORIZED_TEXT_ONLY/);
  assert.doesNotMatch(prompt.userPrompt, /AUTHORIZED_STATE_FIELDS_ONLY_NO_NEW_APPEARANCE/);
});

test("Narrator keeps the full final canon paragraph so motive is not reduced to a prop movement", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  context.sections.recentCanon.items[0]!.narrative =
    "县令亲随刚刚说过只敢报疑。巡抚书吏追问三日内要怎样书面回复。说罢，他把回文匣往胸前收了收，只等总督答复。";
  const prompt = buildSoloNarratorPrompt(context);
  assert.match(prompt.userPrompt, /刚刚说过只敢报疑/);
  assert.match(prompt.userPrompt, /追问三日内要怎样书面回复/);
  assert.match(prompt.userPrompt, /把回文匣往胸前收了收/);
});

test("Narrator receives the semantic scene transition but not machine material-state policy", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = `${event.actionText}并把责任逐项写入改桑执行回文。`;
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.transitionAllowed = true;
  event.narrativePlan.sceneEnd.timeLabel = "嘉靖三十五年五月初九巳时";
  event.narrativePlan.sceneEnd.locationLabel = "杭州总督府签押房";
  const prompt = buildSoloNarratorPrompt(context);
  assert.match(prompt.userPrompt, /故事才可转到嘉靖三十五年五月初九巳时的杭州总督府签押房/);
  assert.doesNotMatch(prompt.userPrompt, /FRESH WRITING MATERIAL-STATE BOUNDARY|墨迹只能写|不得在转场前写成/);
  assert.match(prompt.userPrompt, /行动者：浙江总督。已完成：将总督封缄令牌交给清流县令亲随/);
  assert.ok(
    prompt.userPrompt.lastIndexOf("【玩家刚刚选择的行动")
      > prompt.userPrompt.lastIndexOf("【玩家行动之后必须发生的场景推进】")
  );
});

test("Narrator renders an unquoted institutional action indirectly", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = "由总督府定复核清单，巡抚和县令只能派见证人参加。";
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.playerSpeechMode = "INDIRECT_ONLY";
  event.narrativePlan.authorizedPlayerSpeech = [];
  const prompt = buildSoloNarratorPrompt(context);
  assert.match(prompt.userPrompt, /【玩家行动呈现方式】/);
  assert.match(prompt.userPrompt, /不让浙江总督说引号台词/);
  assert.match(prompt.userPrompt, /必须让玩家刚刚选择的行动在正文中明确完成/);
  assert.match(prompt.userPrompt, /不能只写成准备、意向、暗示或由其他人物转述/);
  assert.match(prompt.userPrompt, /【玩家刚刚选择的行动（已经结算；以下步骤属于同一选择，正文开头依次明确发生）】/);
  event.narrativePlan.sceneBeats = [{
    beatId: "PLAYER-ACTION-1",
    sourceType: "PLAYER_ACTION",
    action: event.actionText,
    requiredTermGroups: [],
    mustAppear: true
  }];
  assert.match(
    buildSoloNarratorPrompt(context).userPrompt,
    /行动者：浙江总督。已完成：由总督府定复核清单，巡抚和县令只能派见证人参加/
  );
  assert.doesNotMatch(prompt.userPrompt, /玩家亲自写明了以下原话/);
});

test("Narrator allows only a player-authored exact quote", () => {
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const settlement = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "CUSTOM",
      actionText: "总督把令牌交给亲随，并明确说：“持此去清流，封存档房。”"
    },
    1
  );
  assert.equal(settlement.event.narrativePlan.playerSpeechMode, "EXACT_QUOTE_ALLOWED");
  assert.deepEqual(
    settlement.event.narrativePlan.authorizedPlayerSpeech,
    ["持此去清流，封存档房。"]
  );
});

test("Narrator gate rejects the live choppy sample and its invented governor quote", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将令牌搁在案边，推向清流县令亲随那一侧。",
    "“持此去清流，封存档房。人不离档，候本督另文。”",
    "亲随双手接过令牌，指节微白，低头应了一声，退后两步，转身出了内厅。脚步声沿廊下远了。",
    "巡抚书吏一直站在案前未动。他等那脚步声断绝，才开口：“部堂，催办公文是抚院衙门签发的，限期回文。如今暂缓签发——下官回去如何禀报？”",
    "总督没有立刻答他。",
    "书吏往前半步，声音压低，却更紧：“三日复核，复核什么、如何复核，抚院要一个说法。部堂若只口说暂缓，中丞那边，下官交不了差。”",
    "“三日。”总督说。",
    "“三日之内，可有书面回文？”",
    "书吏盯着案上那封催办公文，又看一眼总督的手。",
    "“部堂，下官斗胆——复核的范围与方式，还请明示，容下官笔录带回。否则抚院只听得一句‘暂缓’，必以为是总督府压案不办。”",
    "他说完，没有退，也没有再追，只是站着等。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "NARRATIVE_PARAGRAPH_BUDGET_VIOLATION"),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_SPEECH"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate accepts a compact scene that renders an unquoted action indirectly", () => {
  const fixture = partOneFixture();
  const validation = validateNarratorDraft(
    parseNarratorDraft(partOneNarration(fixture)),
    fixture.context
  );
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator treats an action aimed at an absent register as an order, not an on-site prop scene", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = "原册留在档房，换新封条；总督、县令、巡抚三方各留封样。";
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.playerSpeechMode = "INDIRECT_ONLY";
  event.narrativePlan.authorizedPlayerSpeech = [];
  event.narrativePlan.sceneStart.documentStates = [{
    documentRef: "document.qingliu_register_original",
    label: "清流县册原件",
    accessState: "NOT_PRESENT",
    holderRef: null,
    continuityNote: "原件仍在清流县档房。"
  }];
  const prompt = buildSoloNarratorPrompt(context);
  assert.match(prompt.userPrompt, /清流县册原件不在当前现场/);
  assert.doesNotMatch(prompt.userPrompt, /documentRef|accessState|continuityNote/);
  event.narrativePlan.sceneBeats = [{
    beatId: "PLAYER-ACTION-1",
    sourceType: "PLAYER_ACTION",
    action: event.actionText,
    requiredTermGroups: [],
    mustAppear: true
  }];
  assert.match(
    buildSoloNarratorPrompt(context).userPrompt,
    /行动者：浙江总督。已完成：原册留在档房，换新封条；总督、县令、巡抚三方各留封样/
  );
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

test("Narrator gate recognizes the live T02 threat to write a separate account", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  const visibilityMove = {
    beatId: "PAYOFF-P1-XUNFU-VISIBILITY-LIVE-T02",
    sourceType: "DUE_CONSEQUENCE" as const,
    sourceId: "PCR-P1-XUNFU-COUNTERMOVE",
    consequenceId: "PC-P1-XUNFU-VISIBILITY-LIVE-T02",
    actorRefs: ["actor.xunfu_aide"],
    action: "巡抚一方要求先看已经允许披露的材料范围；若仍被排除在外，便要以拒绝协作为由另立自己的叙述。",
    requiredTermGroups: [
      ["巡抚", "巡抚一方", "抚院"],
      ["材料", "披露", "能看的", "允准披露"],
      [
        "另立",
        "叙述",
        "另具一稿",
        "另写一稿",
        "另具一份",
        "另写一份",
        "自具一稿",
        "把今日情形写进去"
      ]
    ],
    resultCeiling: "只能形成公开威胁，不得写成另一份奏报已经发出。"
  };
  event.authoritativeWorldMoves.push(visibilityMove);
  event.narrativePlan.presentActorLabels.push("巡抚幕僚");
  event.narrativePlan.sceneEndActorLabels.push("巡抚幕僚");
  event.narrativePlan.authorizedActorArrivals.push("巡抚幕僚");
  event.narrativePlan.sceneBeats.push({
    beatId: visibilityMove.beatId,
    sourceType: "WORLD_MOVE",
    action: visibilityMove.action,
    requiredTermGroups: visibilityMove.requiredTermGroups,
    resultCeiling: visibilityMove.resultCeiling,
    mustAppear: true
  });
  const prose = `${partOneNarration(fixture)}

内厅侧门有人掀帘进来。来人青衫便帽，向总督长揖，自报是巡抚幕僚。他站定后开口道：“部堂若不准抚院协查，抚院只好另具一稿，把今日情形写进去。卑职先问一句：部堂这边已经允准披露的材料，究竟到哪一层？今日能看的，还是不能看的？”`;
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  const issues = validation.ok ? [] : validation.issues;
  assert.equal(
    issues.some(
      (issue) =>
        issue.code === "COMMITTED_EVENT_NOT_RENDERED"
        && issue.message.includes(visibilityMove.action)
    ),
    false,
    JSON.stringify(issues)
  );
  assert.equal(
    issues.some(
      (issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_APPEARANCE"
    ),
    false,
    JSON.stringify(issues)
  );
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

test("Narrator gate recognizes a messenger bowing out through the threshold", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "清流县令亲随双手接过令牌，领命退出内厅。",
    "清流县令亲随双手接牌，退至门槛处躬身出去。廊下脚步声很快远了。"
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

test("Narrator gate recognizes the county messenger's natural shortened title", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督拿起封缄令牌，交到清流亲随手里，命他持令去清流封存档房。亲随双手收拢，躬身领命，转过门槛便出去了。总督这才转向巡抚书吏，当面答复巡抚书吏：放行文书暂缓签发，三日内复核。",
    "巡抚书吏没有退。他先看了一眼案上的催办公文，随后问道：“中丞等的是落印回文。如今暂缓，复核只限清流一县，还是连抚院已报之数一并核过？”",
    "书吏把双手拢回袖中，仍立在屏风外：“三日之内，还请部堂说明复核的范围与方式，下官才好回禀。”他的称呼仍旧恭谨，问的却不是一句客套话；回到抚院以后，暂缓的缘由落在谁名下，便从这句话起了头。",
    "厅中无人再动。催办公文仍压在案前，密信也只报了一个疑处。书吏不肯空手退下，那句催问便留在两封文书之间，等着总督给出一句能够记入责任的答复。"
  ].join("\n\n");
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

test("Narrator gate does not treat a gesture plus the messenger's later action as an explicit governor order", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督从案上取起封缄令牌，交到清流县令亲随手中，以手背朝外一推，示意他即刻返回清流县传令封存档房。亲随双手接过令牌，退步至门槛处躬身而出，脚步声沿廊下远了。",
    "总督转向巡抚书吏，将催办公文压在掌下，当面告以暂缓签发，三日内复核再议。",
    "巡抚书吏没有退。他看了一眼亲随离去的方向，又看向总督按住公文的手，随后问道：“部堂，暂缓签发，下官回去如何交代？”",
    "他把双手拢在袖中，语气仍旧恭谨：“三日之内，还请部堂给个书面回复，写明复核范围与方式，下官才好据实回禀抚台。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) =>
      issue.code === "COMMITTED_EVENT_NOT_RENDERED"
      && issue.message.includes("命他向清流县传达封存档房之令")
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

test("Narrator gate rejects unsupported register details invented as an answer", () => {
  const fixture = partOneFixture();
  const draft = parseNarratorDraft([
    partOneNarration(fixture),
    "县令亲随又说，县中户册近月屡有涂改，桑田亩数与实种不符。"
  ].join("\n\n"));
  const validation = validateNarratorDraft(draft, fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_DISCOVERY"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects invented register custody procedure and unseen hallway actors", () => {
  const fixture = partOneFixture();
  const draft = parseNarratorDraft([
    partOneNarration(fixture),
    "亲随又道，原册存于清流县衙，须大人下令调取，方敢封送。窗外廊下有人换了一次脚。"
  ].join("\n\n"));
  const validation = validateNarratorDraft(draft, fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_DISCOVERY"),
    true,
    JSON.stringify(validation.issues)
  );
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

test("Narrator gate rejects a clerk drawing a new blank memorandum from his sleeve", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "巡抚书吏从袖中抽出一张空白手本，摊在案角"
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

test("Narrator gate treats a voice lowered by half an inch as figurative degree, not physical distance", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "书吏开口时声调比先前更低半寸。他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows an incidental half-inch blocking detail without canonizing a distance", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句，也没有把催问说得更轻",
    "书吏抬起手，指尖停在案面上方半寸。他没有替巡抚加一句，也没有把催问说得更轻"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows the live reply-box movement toward the clerk's chest as blocking", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命他回县传达封存档房之令，候上命再启；同时当面答复巡抚书吏，暂缓签发，三日内复核。亲随双手接过令牌，躬身领命，退步至门边，转身出了内厅。",
    "门帘合拢后，巡抚书吏仍捧着那只空的回文匣，没有挪步。他微微欠身，语气恭谨却咬得很紧：“大人既示下暂缓，卑职不敢妄议。只是抚院催取回文，三日期限是上头定的，卑职空手回去，须得有个交代。敢请大人三日内给一份书面回复，写明复核的范围与方式，卑职据以回话，抚院那边才好等得明白。”他说完，双手将回文匣往胸前收紧了一寸，垂目候着。"
  ].join("\n\n");
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
      actionText: "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。"
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

test("review-question action supplies a bounded answer without inventing player dialogue", () => {
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const settlement = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d1",
      actionText: "把巡抚催办公文暂压在案上，示意巡抚书吏留在内厅；只问县令亲随密信是否仅为报疑、原册是否并未随信送来，再从这两项已知事实启动复核。"
    },
    1
  );
  assert.deepEqual(
    settlement.event.narrativePlan.authorizedPlayerSpeech,
    []
  );
  assert.equal(
    settlement.event.narrativePlan.playerSpeechMode,
    "INDIRECT_SPEECH_REQUIRED"
  );
  assert.ok(
    settlement.event.authoritativeObservableFacts.includes(
      "清流县令亲随当场只确认：密信仅为报疑，原册并未随信送来；除此不能再作断言"
    )
  );
  assert.ok(
    settlement.event.narrativePlan.sceneBeats.some((beat) =>
      beat.action.startsWith("清流县令亲随当场只确认")
      && beat.mustAppear
    )
  );
  const createdConsequence = settlement.proposedState.pendingConsequences.find(
    (item) => settlement.event.createdPendingConsequenceIds.includes(item.consequenceId)
  );
  assert.equal(
    createdConsequence?.ruleAssetId,
    "PCR-P1-XUNFU-COUNTERMOVE"
  );
  assert.match(
    createdConsequence?.payoffBeat.action || "",
    /参加下一轮复核/
  );
  assert.doesNotMatch(
    createdConsequence?.payoffBeat.action || "",
    /清流县试办|压价买田/
  );
});

test("Narrator gate rejects an unspoken second governor question", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = "只问县令亲随：“密信只是报疑，原册没有随信送来，可是如此？”";
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.playerSpeechMode = "EXACT_QUOTE_ALLOWED";
  event.narrativePlan.authorizedPlayerSpeech = [
    "密信只是报疑，原册没有随信送来，可是如此？"
  ];
  const prose = partOneNarration(fixture).replace(
    "清流县令亲随双手接过令牌，领命退出内厅。",
    "总督问道：“密信只是报疑，原册没有随信送来，可是如此？”亲随只确认了这两项。总督追问一句，亲随便不再开口。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_ACTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate allows narration that the governor did not ask a second question", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  event.actionText = "只问县令亲随：“密信只是报疑，原册没有随信送来，可是如此？”";
  event.narrativePlan.actionAlreadyOccurred = event.actionText;
  event.narrativePlan.playerSpeechMode = "EXACT_QUOTE_ALLOWED";
  event.narrativePlan.authorizedPlayerSpeech = [
    "密信只是报疑，原册没有随信送来，可是如此？"
  ];
  const prose = partOneNarration(fixture).replace(
    "清流县令亲随双手接过令牌，领命退出内厅。",
    "总督问道：“密信只是报疑，原册没有随信送来，可是如此？”亲随只确认了这两项。总督没有追问。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_ACTION"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate does not attribute a clerk's quoted request to a governor who stays silent", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。",
    "巡抚书吏先开口道：“大人可否给卑职一个书面字据，好让卑职回去交差？”总督未答。巡抚书吏一直在门内等候。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_SPEECH"
        || issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_COMMITMENT"
    ),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects an NPC demand for a new handling ledger absent from the world move", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。",
    "巡抚书吏先开口道：“抚院亦当与闻复核，留一份本方经手底册。”巡抚书吏一直在门内等候。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some(
      (issue) => issue.code === "UNAUTHORIZED_PART_ONE_NPC_DOCUMENT_DEMAND"
    ),
    true,
    JSON.stringify(validation.issues)
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
test("Narrator gate rejects the governor sending forward a reply box held by the xunfu clerk", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "浙江总督将回文匣往前一送，又收住；内厅只剩茶盏轻触案面的声音。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"
        && issue.message.includes("浙江总督将回文匣往前一送")
    ),
    true,
    JSON.stringify(validation.issues)
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

test("Narrator gate rejects inserting an unchanged document into the empty reply box", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "巡抚书吏将催办公文夹入回文匣，重新合拢匣盖；内厅只剩茶盏轻触案面的声音。"
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

test("Narrator gate allows the authorized new holder to stow the seal token without changing custody", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "话说完，他看着阶下的人把这道命令听全",
    "清流县令亲随把封缄令牌收入袖中。话说完，他看着阶下的人把这道命令听全"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate allows the authorized holder to retrieve the seal token from neutral blocking", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "浙江总督把手按在案沿",
    "浙江总督从案后取出封缄令牌，递向清流县令亲随，随后把手按在案沿"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
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

test("Narrator gate rejects an unlisted bailiff used as offstage atmosphere", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "厅中一时只剩窗外差役换班的脚步声。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_ACTION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects a document-location contradiction within one paragraph", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "催办公文与密信并不同案，两样东西却又压在同一张案上。"
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

test("Narrator gate does not confuse a superior's urging document with the superior acting", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "浙江总督把手按在案沿",
    "浙江总督将巡抚催办公文往案上一压，朝巡抚书吏抬了抬手"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_ACTION"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate does not confuse the xunfu reply box with the xunfu acting", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "书吏捧持巡抚回文匣，启开匣盖，将改桑放行回文折好收入，重新合拢，退后半步躬身。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_ACTION"),
    false,
    JSON.stringify(validation.issues)
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

test("Narrator gate allows neutral non-causal appearance texture for an authorized unnamed actor", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  plan.sceneStartActorLabels.push("巡抚幕僚");
  plan.sceneEndActorLabels.push("巡抚幕僚");
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。",
    "巡抚幕僚青衫便帽，面相清瘦，向总督行了一揖。巡抚书吏一直在门内等候。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(
    validation.ok
      ? false
      : validation.issues.some(
          (issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_APPEARANCE"
        ),
    false,
    validation.ok ? "" : JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects appearance details that create new evidence or authority", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const plan = context.sections.partOneSettlement.items[0]!.narrativePlan;
  plan.sceneStartActorLabels.push("巡抚幕僚");
  plan.sceneEndActorLabels.push("巡抚幕僚");
  const prose = partOneNarration(fixture).replace(
    "巡抚书吏一直在门内等候。",
    "巡抚幕僚青衫便帽，腰间悬着巡抚关防腰牌，向总督行了一揖。巡抚书吏一直在门内等候。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some(
      (issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_APPEARANCE"
    ),
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

test("Narrator gate treats 须大人下令 as modal grammar, not a personal name", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "他没有替巡抚加一句",
    "他只道：“原册未曾随信送来，须大人下令。”他没有替巡抚加一句"
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

test("Narrator gate rejects an invented physical distance between known documents", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "两封文书并置，中间隔着半尺案面。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"),
    true,
    JSON.stringify(validation.issues)
  );
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

test("Narrator gate does not attribute a clerk quote after he looks at the governor's hand", () => {
  const fixture = partOneFixture();
  const event = fixture.settlement.event;
  const reactionText = event.authoritativeNpcReactions
    .map((reaction) => reaction.action)
    .join("。");
  const paragraphs = partOneNarration(fixture).split(/\n\s*\n/);
  paragraphs[1] = [
    "书吏没有立即接话。他看了一眼被按住的公文，又看了一眼总督的手，才开口：",
    `“${reactionText}”`
  ].join("");
  const validation = validateNarratorDraft(
    parseNarratorDraft(paragraphs.join("\n\n")),
    fixture.context
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_SPEECH"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate does not start player-speech attribution inside a clerk's gaze object", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督从案上取了封缄令牌，搁在清流县令亲随面前，吩咐他即刻回县，传令封存档房，一册一卷不许擅动。亲随双手接过，退至门槛处躬身退出。脚步声沿廊下远了。",
    "总督随即转向巡抚书吏，说催办文书暂缓签发，三日内复核。",
    "书吏没有立刻接话。他低头看了一眼案上那封催办公文，又抬眼看了看总督搁笔的位置，才开口：“部堂明示，三日复核，是复哪一宗？是单复清流一县所报，还是并复巡抚衙门移文所列款项？”",
    "总督没有答。",
    "书吏往前半步，声音压低却更紧：“非是下官敢催。抚院要的是落印移文。敢请部堂示下复核范围与复核方式，下官据实回禀？”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_SPEECH"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("short-response budget accepts a complete 298-character scene without padding", () => {
  const fixture = partOneFixture();
  const context = structuredClone(fixture.context);
  const event = context.sections.partOneSettlement.items[0]!;
  const prose = [
    "总督从案上取起那面封缄令牌，交到清流县令亲随手中，命他立即回县传达封存档房之令。亲随双手接过，低头领命，退至门槛处躬身一礼，转身出了内厅。脚步声沿廊下渐远。",
    "总督转向巡抚书吏，以掌按住那封催办公文，明言暂缓签发，三日内复核。",
    "书吏没有立即接话。他看了一眼被按住的公文，又看了一眼总督的手，才开口：“部堂，催办文书上写的是限期，不是可缓可急的商量。暂缓签发，下官回去如何交代？”",
    "总督没有改口。",
    "书吏往前半步，压低声音：“三日之内，还请部堂给一份书面回复，写明复核的范围与方式。下官好拿回去销差——不然，抚院那边只当杭州这边压着不办。”"
  ].join("\n\n");
  assert.ok(prose.length >= 180 && prose.length < 300, `unexpected fixture length ${prose.length}`);
  const validation = validateNarratorDraft(parseNarratorDraft(prose), context);
  assert.equal(
    validation.issues.some((issue) => issue.code === "NARRATIVE_STYLE_BUDGET_VIOLATION"),
    false,
    JSON.stringify(validation.issues)
  );
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

test("Narrator gate catches governor speech when attribution follows the quote", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "“三日内复核。”总督打断了书吏。内厅只剩茶盏轻触案面的声音"
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

test("Narrator gate rejects invented archive-sealing procedure beyond the settled order", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "只把已经作出的处置说得清楚：",
    "只把已经作出的处置说得清楚：钥匙由县令亲收，所有册籍一律不得挪动，候总督府差员到场再行启封。"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PROCEDURE"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects the live shadow sample that lets the clerk repeat an unrendered player answer", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命他即刻返回清流，传令封存档房，候上命再启。亲随双手接过，躬身领命，退步至门边，转身出了内厅。",
    "巡抚书吏一直候在侧旁，见那人出门，上前半步，躬身道：“总督大人，巡抚部院催取回文，限已明定。如今暂缓签发，书吏不敢自专，须得回禀。敢问大人，暂缓缘由可否书吏一并带回？三日之内复核，复核何项、以何方式，还望大人示下，俾书吏据实回复，免得部院再行催取。”",
    "他说得恭谨，脚下却未退。总督没有即刻接话。书吏便又补了一句：“书吏知大人有斟酌之处。只是巡抚部院要的是书面回文，空口转述，书吏担不起。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "COMMITTED_EVENT_NOT_RENDERED"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects the live shadow sample that invents archive procedure and a document date", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命他即刻返回清流县，传令封存档房，听候总督衙门复核。亲随双手接过，躬身领命，退至门边转身出去，脚步声很快没了。",
    "总督转面答复巡抚书吏：暂缓签发，三日内复核。",
    "书吏听完，躬身应是，却未退去。他停了一息，抬头道：“总督大人，卑职奉巡抚之命催取回文，不敢空手而返。三日期限之内，还望大人写明复核范围与方式，卑职好据实禀复。”",
    "他顿了顿，声音放低半分：“催办公文上写的是五月初八。今日已是初八。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PROCEDURE"),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_DOCUMENT_CONTENT"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate accepts the bounded live shadow scene after semantic attribution and roster review", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命他回清流县传令：即刻封存档房，候上命再启。亲随双手接过，躬身领命，退步至门边，转身出去了。亲随退下后，总督与巡抚书吏仍在厅中，催办公文摊在案上。总督转向他，当面答复：暂缓签发，三日内复核。",
    "书吏没有立刻应声。他低头看了一眼案上那封催办公文，又抬眼看了看总督，才开口道：“制台既示暂缓，下官不敢不遵。只是下官奉巡抚大人之命催取回文，空手回去难以复命——斗胆请问制台，暂缓签发所为何事？再者，三日之限，还望制台给一份书面回复，写明复核的范围与方式，下官好据实禀报巡抚大人。”",
    "总督没有接话。书吏便站着等。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate accepts the exact fresh-run T01 reply when the governor turns to the named clerk", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命其回清流传令：封存档房，候上命再启。亲随双手接过，躬身领命，退步至门槛，转身出了内厅。总督遂转向巡抚书吏，当面答复：暂缓签发，三日内复核。",
    "书吏并未退去。他躬身候了片刻，抬头道：“部堂既示暂缓，卑职不敢强请落印。只是抚院催取回文，卑职空手回去难以交差。敢问大人，暂缓缘由可否赐知一二？三日之内复核，所复是何范围、以何方式，还望部堂给卑职一个书面说明，卑职据此回禀，抚院那边才好等候。”他说完仍站着，目光低垂，两手垂在身侧，等着。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate accepts the fresh-run T01 prose that uses 面告 and modal 蒙大人", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督从案上取过封缄令牌，交到清流县令亲随手中，命他回清流县传令：封存档房，候上命再启。亲随双手接过，躬身领命。总督随即面告巡抚书吏：暂缓签发回文，三日内复核。",
    "亲随将令牌收入袖中，退后一步行礼，转身出了内厅。脚步声渐远，案上只剩那封催办文书与那封密信并排搁着。巡抚书吏仍捧着空回文匣，站了片刻，才开口道：\"部堂暂缓签发，卑职不敢不遵。只是抚院那边催取已久，卑职空手回去，上头必要问缘由。敢请大人示知——三日之内复核何事、以何方式复核，卑职才好据实回话。若蒙大人给一纸书面，卑职便有了交代。\""
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate does not attribute a clerk quote to a governor who explicitly stays silent", () => {
  const fixture = partOneFixture();
  const prose = [
    "浙江总督从案上取过封缄令牌，递向清流县令亲随，命他回清流传话：县衙档房即刻封存，候上命再启。亲随双手接过令牌，拢入袖中，躬身领命。总督随即转向巡抚书吏，告知他：催办回文暂缓签发，三日内复核再议。",
    "亲随退后一步，长揖行礼，转身出内厅去了。脚步声过门槛，渐远不闻。厅中只剩总督与巡抚书吏两人，案上那封催办公文仍摊着，回文匣空合在书吏掌中。书吏将匣子换到左手，右手垂下，躬了躬身子，却没有退。他抬头看总督，语气仍恭谨：\"大人，卑职奉抚院催取回文，不敢空手而归。暂缓签发，可有缘由可禀？抚院若问，卑职总要有话回。\"总督没有开口。书吏等了片刻，又道：\"三日之期，大人若肯给卑职一纸书面，写明复核何项、以何方式，卑职据此复抚院，便不算白跑。\"他把回文匣往胸前收了收，指尖扣在匣盖上，仍站着不动。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
});

test("Narrator gate classifies the exact failed T02 output at the correct layers", () => {
  const fixture = partOneSecondTurnFixture();
  const prose = [
    "总督将那封催办公文重新合拢，搁在案角，没有取笔。书吏的目光跟着那只手移到案面，又移开，等到的不是朱批，也不是回文底稿。总督以手势示意：签发暂缓，须待清流县回报封存结果后再议；三日限期之内若有延误，责在总督本衙，不另开回文推诿。书吏躬身应了一声，却没有退。",
    "片刻后他开口，语气仍恭谨：“部堂既有此意，卑职不敢多问。只是卑职回去复命，抚院那边须有个交代——巡抚大人说，复核一事，抚院也要派人同看，经手底簿上须留本方一笔。”",
    "总督未答。书吏便又补了一句，声音压得平：“若部堂这边尚不能示下可看材料的范围，抚院也只能据实另叙，说总督府未予协作。”",
    "厅外传来脚步声。一个青衫幕僚跨过门槛，向总督行过半礼，不待书吏引介便站到书吏侧后方，从袖中取出一页折好的手折，双手呈向案面，没有说话。书吏看了那手折一眼，回身向总督欠了欠身：“这是抚院幕宾赵先生，巡抚大人差来同卑职一道候回文的。”赵幕僚将手折往前又递了半寸，指尖抵在案沿上，仍不收回。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "UNSUPPORTED_PART_ONE_DISCOVERY"
        && issue.message.includes("经手底簿")
    ),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "UNSUPPORTED_PART_ONE_DISCOVERY"
        && issue.message.includes("等到的不是朱批")
    ),
    false,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"),
    false,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_ACTOR_IDENTITY"),
    true,
    JSON.stringify(validation.issues)
  );
  const missingBeats = validation.issues.filter(
    (issue) => issue.code === "COMMITTED_EVENT_NOT_RENDERED"
  );
  assert.equal(missingBeats.length, 1, JSON.stringify(validation.issues));
  assert.match(missingBeats[0]!.message, /PLAYER_ACTION/);
});

test("Narrator gate accepts a bounded T02 response with personal liability and an unnamed xunfu aide", () => {
  const fixture = partOneSecondTurnFixture();
  const prose = [
    "总督把催办公文合拢，仍压在案角，当面告知巡抚书吏：继续暂缓签发，待清流县回报封存结果后再议；三日之内若有延误，责在本督。",
    "书吏躬身听完，随即把抚院的要求说清：巡抚一方要参加复核；待复核发生时，也须如实注明抚院一方经手。",
    "廊外脚步声近，一名巡抚幕僚进了内厅，只向总督行礼，并不自报姓名。他开口追问大人准许披露哪些材料；若仍不许抚院与闻，抚院只得另叙今日总督府拒绝协作。话说完，书吏捧着那只仍旧合拢的空回文匣，手指在匣沿略略收紧；幕僚与书吏都留在原处，等总督下一步处置。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate accepts the bounded T02 limited-trial reply on the authorized document", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "总督提笔写成改桑放行回文，文中写明只准清流县先办一批，并把民田不得压价买田这条一并写进回文。写罢将回文交给巡抚书吏；书吏接过，启开原本空着的回文匣，将回文纳入匣中，又合拢匣盖。",
    "巡抚书吏捧定回文匣，当面传话：抚院要参与复核；复核发生时，也须如实注明巡抚一方经手。廊外随即进来一名未报姓名的巡抚幕僚，追问部堂准许披露哪些材料；若仍不许抚院与闻，抚院便要自行具文回话，叙明总督府拒绝协作。话说完，书吏的手指在匣沿略略收紧，两人都留在原处等候。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate accepts the exact fresh-run T02 reply-box choreography", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "总督将巡抚催办公文搁在案侧，提笔写成改桑放行回文，文中只准清流县先办一批改桑，并写明不得趁急难压价买田。写罢搁笔，将回文递向书吏。书吏双手接过，捧持巡抚回文匣，启开匣盖，将改桑放行回文折好收入，重新合拢，退后半步躬身。",
    "书吏尚未告辞，内厅侧门被人推开，一名巡抚幕僚入内，向总督行过礼，目光落在书吏手中合拢的回文匣上，随即开口：抚院还有一句话——既准了清流先办一批，复核时须派员到场，到场查验经过据实记入复核记录，不能只凭总督府单方出文了事。幕僚顿了顿，又道：抚院想知道，大人准许披露的材料范围到何处。若仍将抚院排除在外，抚院不便协办，只好另立一份经过叙述，呈上去时各说各话，于大局未必相宜。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate accepts the exact live T02 incidental writing substrate", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "浙江总督没有再看书吏，将两封文书移到案侧，提笔在空白笺纸上写成改桑放行回文，写明清流县先办一批，并写明不得趁急难压价买田。笔搁下，他将回文推至案沿。书吏右手仍按匣盖，左手启开匣口，将改桑放行回文收入，重新合拢，退后半步躬身接住。",
    "书吏没有转身。他双手捧匣，又躬了一躬，声音比先前低了半分：“大人，卑职临行前另有抚院口信传禀。抚院说，改桑既已放行，复核一节，抚院要派员到场参与查验，到场经过须据实记入复核记录，不能只凭总督府单方出具。”他顿了顿，目光仍落在地面，“抚院还说，清流县令密信既已呈到部堂案上，抚院愿先看大人允准披露的材料范围。若此项仍将抚院排除在外——”厅门方向传来脚步声。一名青衫幕僚侧身入内，向总督行过礼，站到书吏身侧，接过话头，语气平而缓：“部堂，抚院的意思是，复核若不容抚院与闻，日后各衙门各有各的叙述，于公事反而不便。抚院叫卑职带一句话：协与不协，只看部堂今日肯不肯让抚院的人到场。”幕僚说完，与书吏一并垂手立着，等总督的回应。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate treats the latest live T02 gaze toward a closed reply box as texture", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "总督没有答书吏的话，只从案上取过一张素纸，铺在催办文书旁，蘸墨落笔。字不多，写的是准清流县先办一批改桑，并写明不得趁急难压价买田。写罢将纸折好，搁在案沿，朝书吏抬了抬手。书吏会意，捧回文匣上前，单手启开匣盖，将折好的回文收入匣中，重新合拢，双手捧稳，退后半步躬了躬身。",
    "书吏还没走，帘外有人报进来。来人穿青布直裰，腰间系着巡抚衙门的牌绳，进门先向总督行了一礼，再朝书吏点了点头，才开口道：“部堂，抚台有话交代卑职带回。抚台说，清流先办一批，抚台不拦；但复核一事，抚台要派员到场，到场查验经过须据实记入复核记录，不能只凭总督衙门一方的单子。”他顿了顿，把目光从总督脸上移到那只已经合拢的回文匣上，声音压低了半分：“另外，抚台请部堂先示下，已经允许披露的材料范围究竟到哪一步。若抚院仍被排除在外，抚台只好以拒绝协作另立叙述，届时呈上去的，就不只是回文了。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate rejects the exact live T02 actor-custody and future-choice leaks without misclassifying its writing substrate", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "总督将巡抚催办公文搁在案侧，另取一张纸，提笔写改桑放行回文。回文里只准清流县先办一批，末后另起一行，写明不得趁急难压价买田。写毕，将回文折好，放入巡抚回文匣中，合拢匣盖，推向巡抚书吏。书吏双手接过，退后半步，并未即时告退。",
    "书吏捧匣躬身道：“部堂，卑职奉巡抚大人之命催取回文，如今回文虽已写就，却仍注明三日复核。卑职不敢擅专——巡抚大人有话：复核一事，巡抚衙门须得与闻，经手之时亦须如实注明巡抚一方在场。”他顿了顿，声音仍恭谨，语气却不退，“若部堂仍将巡抚排除在外，巡抚大人另有一句话：材料范围若不先示，巡抚便只能以未获协作为由，自行具文呈报，另立一说。”",
    "话音未落，门外靴声响，一人由廊下转入内厅，青直身，行至书吏身侧站定，向总督长揖——巡抚幕僚到了。幕僚不待书吏再开口，便道：“部堂，回文既已写就，匣中便是定局。然三日复核之期，巡抚大人须有姓名在上。若复核时巡抚一方不得与闻，这回文便只是部堂一面之词，巡抚衙门难以画押复命。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"
        && issue.message.includes("放入巡抚回文匣中")
    ),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "UNSUPPORTED_PART_ONE_DISCOVERY"
        && issue.message.includes("另取一张纸")
    ),
    false,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "NARRATIVE_NEXT_DECISION_LEAKAGE"
        && /姓名在上|画押/.test(issue.message)
    ),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate classifies a pre-existing reply and next-decision signature as separate T02 failures", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "总督将回文铺回案上，提笔在改桑放行回文末尾补入一行：清流县先办一批，不得趁急难压价买田。搁笔，将回文递向书吏。书吏双手接过，启开回文匣，将回文收入，合拢匣盖。",
    "巡抚幕僚入内说道：“巡抚这边总要先看过，才好署名协办。若材料不便与阅，中丞也只好另具一说。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"
        && /铺回案上|末尾补入/.test(issue.message)
    ),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "NARRATIVE_NEXT_DECISION_LEAKAGE"
        && issue.message.includes("署名协办")
    ),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "COMMITTED_EVENT_NOT_RENDERED"
        && issue.message.includes("PLAYER_ACTION")
    ),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects a blank-paper substitute, unauthorized clerk reading and delivery promise", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "总督提笔在空笺上落字，写明清流县先办一批改桑，并写明不得趁急难压价买田。写罢将笺纸递向书吏。书吏双手接过，略看一遍，启开所捧回文匣，将笺纸收入，合拢匣盖，退后半步躬身道：“卑职这就回禀巡抚大人。”",
    "廊外脚步声近，一名未报姓名的巡抚幕僚进了内厅，要求抚院派员参与复核，并在复核发生后把到场查验经过据实记入复核记录。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "UNAUTHORIZED_PART_ONE_DOCUMENT_HANDLING"
        && issue.message.includes("空笺")
    ),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "UNAUTHORIZED_PART_ONE_DOCUMENT_HANDLING"
        && issue.message.includes("略看")
    ),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "UNAUTHORIZED_PART_ONE_NPC_COMMITMENT"
        && issue.message.includes("这就回禀")
    ),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects a corrupted reform-policy term from a live T02 turn", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "总督提笔写成改桑放行回文，文中写明准清流县先办一批改桑为田，并把民田不得压价买田这条一并写进回文。写罢将回文交给巡抚书吏；书吏接过，启开原本空着的回文匣，将回文纳入匣中，又合拢匣盖。",
    "巡抚书吏捧定回文匣，当面传话：抚院要参与复核；复核发生时，也须如实注明巡抚一方经手。廊外随即进来一名未报姓名的巡抚幕僚，追问部堂准许披露哪些材料；若仍不让抚院与闻，抚院便要自行具文回话，叙明总督府拒绝协作。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "NARRATIVE_FORBIDDEN_STYLE_PHRASE"
        && issue.message.includes("改桑为田")
    ),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate treats moving the established reply box half an inch as blocking, not state", () => {
  const fixture = partOneLimitedTrialSecondTurnFixture();
  const prose = [
    "总督提笔写成改桑放行回文，文中写明只准清流县先办一批，并把民田不得压价买田这条一并写进回文。写罢将回文交给巡抚书吏；书吏接过，启开原本空着的回文匣，将回文纳入匣中，又合拢匣盖。",
    "巡抚书吏当面传话：抚院要参与复核；复核发生时，也须如实注明巡抚一方经手。廊外随即进来一名未报姓名的巡抚幕僚，追问部堂准许披露哪些材料；若仍不许抚院与闻，抚院便要另叙总督府拒绝协作。书吏捧着已经合拢的回文匣，又往前递了半寸，便停在那里等候。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"),
    false,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate accepts a live turn that keeps the focal governor present and resolves the clerk pronoun", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命他速回清流，传令封存档房，候上命再启，不得擅动。亲随双手接过，躬身领命，退步至门边，转身出去了。亲随退下后，巡抚书吏仍立在案前。总督告知他：暂缓签发，三日内复核。",
    "书吏抬眼，停了一息，躬身道：“部堂明断，卑职不敢妄议。只是抚院催取回文，三日之期，卑职须得有话回禀。”他顿了顿，“敢问部堂，暂缓缘由可否见告？三日之内复核，所复者是何范围、以何方式，抚院这边要有书面回话，卑职才好销差。”",
    "总督没有即刻答言。书吏垂目，又道：“卑职非敢催逼。只是抚院公文既到，部堂若只批暂缓，不说缘由，不说复核何事，抚院那边便只当寻常延宕——三日之后若仍无回文，卑职再来，便不是一个人来了。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("Narrator gate rejects the exact live T01 sample across quantity, action and roster layers", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命其即刻返回清流，传令封存档房，候上命再启。亲随双手接过，躬身领命，退步至门帘处转身出去，脚步声很快消失在廊下。",
    "内厅里只剩巡抚书吏。他一直候在侧旁，此时上前半步，拱手道：“部堂，卑职奉巡抚大人之命催取回文，公文在此已候了两日。部堂既示下暂缓签发、三日内复核，卑职不敢擅退，只是回署复命须有个交代。敢请部堂明示，暂缓缘由何在？三日之内复核，所核是何范围、以何方式？若蒙部堂给一纸书面说明，卑职好据实回禀，巡抚大人那边也不至再生疑窦。”",
    "他说完仍垂手立着，目光落在案上那封催办公文上，没有去拿，也没有退。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_QUANTITY"),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "COMMITTED_EVENT_NOT_RENDERED"),
    true,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "PART_ONE_CONTINUITY_CONTRADICTION"
        && issue.message.includes("在场人数")
    ),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects repeated backend role labels as the clerk's first-person self-reference", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命他返回清流县传令：封存档房，候上命再启。亲随双手接过，躬身领命，退步至门边，转身出了内厅。",
    "总督随即答复巡抚书吏：催办公文暂缓签发，三日内复核。",
    "书吏方才看着亲随出门的背影，闻言转过身来，躬身道：“总督大人，书吏奉巡抚部院差遣取回文，公文在此，大人既已阅过，缘何暂缓签发？书吏不敢空手返报。若暂缓，还请大人示知缘由，并于三日内给一个书面回复，写明复核的范围与方式，书吏好据实回禀巡抚部院。”",
    "他顿了顿，又补了一句：“三日期限，书吏在杭州候文。”"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "NARRATIVE_CHARACTER_VOICE_VIOLATION"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate accepts seven natural dialogue paragraphs but rejects an invented higher pressure source", () => {
  const fixture = partOneFixture();
  const prose = [
    "总督将封缄令牌交到清流县令亲随手中，命他回清流传令：县衙档房即刻封存，候上命再启。亲随双手接过，躬身领命，退步至门帘处转身一揖，掀帘出去了。帘子晃了两晃，廊下脚步声渐远。",
    "总督转面答复巡抚书吏：催办公文暂缓签发，三日内复核。",
    "书吏原候在一旁，闻言上身微前倾，并不退步。他略停了停，压住声气道：“大人，卑职奉巡抚之命催取回文，不敢自专。暂缓缘由，还望大人示知一二，卑职好回去禀复。”",
    "总督没有接话。",
    "书吏又道：“三日之限，卑职回去可以转禀。只是巡抚要问：复核范围是哪几项，以何种方式核——是大人行文，还是另差委员？若没有书面回复，卑职空手回去，巡抚那边不好交代。”",
    "他顿了顿，把声音再放低半分：“大人，卑职多一句嘴——巡抚催得急，不是巡抚一个人的意思。”",
    "帘外没有风。总督案上那封催办文书压着密信，纸角相叠。书吏仍弓着腰，等在那里。"
  ].join("\n\n");
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "NARRATIVE_PARAGRAPH_BUDGET_VIOLATION"),
    false,
    JSON.stringify(validation.issues)
  );
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNSUPPORTED_PART_ONE_PRESSURE_SOURCE"),
    true,
    JSON.stringify(validation.issues)
  );
});

test("Narrator gate rejects an added promise about what happens after review", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "总督没有替尚未完成的封存和复核预写结果",
    "总督当面答复，复核之后再定落印。总督没有替尚未完成的封存和复核预写结果"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(
    validation.issues.some((issue) => issue.code === "UNAUTHORIZED_PART_ONE_PLAYER_COMMITMENT"),
    true,
    JSON.stringify(validation.issues)
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

test("Narrator gate does not treat an actor mentioned after shadow texture as the remaining roster", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音",
    "厅中安静下来，只剩他站立的影子压在地砖上，等着总督给出一个能写在纸上的答复"
  );
  const validation = validateNarratorDraft(parseNarratorDraft(prose), fixture.context);
  assert.equal(validation.ok, true, validation.ok ? "" : JSON.stringify(validation.issues));
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

test("Narrator gate rejects re-anchoring the deadline to the clerk's current sentence", () => {
  const fixture = partOneFixture();
  const prose = partOneNarration(fixture).replace(
    "内厅只剩茶盏轻触案面的声音。",
    "三日之限从这句话起便压在厅中。内厅只剩茶盏轻触案面的声音。"
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

function partOneSecondTurnFixture() {
  const first = partOneFixture();
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const route = first.workingSet.decisionAffordances.find(
    (candidate) => candidate.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-03"
  )!;
  const settlement = settlePartOneAction(
    pkg,
    first.settlement.proposedState,
    {
      source: "RECOMMENDED",
      decisionKernelId: route.decisionKernelId,
      affordanceTemplateId: route.affordanceTemplateId,
      label: route.title,
      actionText: route.actionText,
      targetRef: route.targetRef
    },
    2
  );
  const nextWorkingSet = buildPartOneRuntimeWorkingSet(pkg, settlement.proposedState, 2);
  const context = structuredClone(first.context);
  context.sections.partOneRuntime.items = [nextWorkingSet];
  context.sections.partOneSettlement.items = [settlement.event];
  context.actionResolution.actionStarted = settlement.event.actionText;
  context.actionResolution.summary = settlement.event.actionText;
  context.actionResolution.immediateObservableResult =
    settlement.event.authoritativeObservableFacts;
  context.actionResolution.factsModelMayStateAsConfirmed =
    settlement.event.authoritativeObservableFacts;
  return {
    ...first,
    context,
    settlement
  };
}

function partOneLimitedTrialSecondTurnFixture() {
  const first = partOneFixture();
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const route = first.workingSet.decisionAffordances.find(
    (candidate) => candidate.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-01"
  )!;
  const settlement = settlePartOneAction(
    pkg,
    first.settlement.proposedState,
    {
      source: "RECOMMENDED",
      decisionKernelId: route.decisionKernelId,
      affordanceTemplateId: route.affordanceTemplateId,
      label: route.title,
      actionText: route.actionText,
      targetRef: route.targetRef
    },
    2
  );
  const nextWorkingSet = buildPartOneRuntimeWorkingSet(pkg, settlement.proposedState, 2);
  const context = structuredClone(first.context);
  context.sections.partOneRuntime.items = [nextWorkingSet];
  context.sections.partOneSettlement.items = [settlement.event];
  context.actionResolution.actionStarted = settlement.event.actionText;
  context.actionResolution.summary = settlement.event.actionText;
  context.actionResolution.immediateObservableResult =
    settlement.event.authoritativeObservableFacts;
  context.actionResolution.factsModelMayStateAsConfirmed =
    settlement.event.authoritativeObservableFacts;
  return {
    ...first,
    context,
    settlement
  };
}

function partOneNarration(
  fixture: ReturnType<typeof partOneFixture>
) {
  const event = fixture.settlement.event;
  const reactionText = event.authoritativeNpcReactions
    .map((reaction) => reaction.action)
    .join("。");
  const factText = event.narrativePlan.sceneBeats
    .filter((beat) => beat.sourceType === "CONFIRMED_EFFECT" && beat.mustAppear)
    .map((beat) => beat.action)
    .join("。");
  const factClause = factText ? `${factText}。` : "";
  return [
    `浙江总督把手按在案沿，没有再解释密信里尚未查清的疑处，只把已经作出的处置说得清楚：${event.actionText}。清流县令亲随双手接过令牌，领命退出内厅。话说完，他看着阶下的人把这道命令听全，没有再添别的吩咐。${factClause}`,
    `巡抚书吏一直在门内等候。总督的话落下后，他先垂眼停了片刻，随后依照巡抚的原话回禀：${reactionText}。他没有替巡抚加一句，也没有把催问说得更轻，只把“为何暂缓”“三日之内”“范围与方式”说得字字分明。`,
    `内厅只剩茶盏轻触案面的声音。总督没有替尚未完成的封存和复核预写结果，巡抚书吏也没有退下；案前隔着的，仍是已经发出的命令和必须书面说明的责任。书吏垂手候在原处，等总督对这番催问作答。`
  ].join("\n\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}
