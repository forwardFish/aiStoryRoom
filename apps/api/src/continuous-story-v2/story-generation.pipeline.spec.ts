import assert from "node:assert/strict";
import { compileStoryContextV2, hashStoryTextV2, type StoryContextSourceV2 } from "./story-context";
import {
  StoryGenerationErrorV2,
  StoryGenerationPipelineV2,
  type StoryModelClientV2,
  type StoryModelRequestV2,
  type StoryModelResponseV2
} from "./story-generation.pipeline";
import { StoryNarrativeProvider } from "./story-narrative.provider";

const playerAction = "封存清流县原始田册，请两名经手书吏当面对印；暂不公开老书吏的姓名。";
const recentCanon = "雨声压住了签押房外的脚步。浙江总督把两份数字相反的田册并排放在灯下，先记下送册时辰，又让门房把巡抚的催问留在外厅。";
const staticAffordanceSentinel = "STATIC_CARD_SHOULD_NOT_REACH_WRITER";

function contextSource(
  itemId: string,
  sourceType: StoryContextSourceV2["sourceType"],
  content: string,
  priority: StoryContextSourceV2["priority"] = "P0"
): StoryContextSourceV2 {
  return {
    itemId,
    sourceType,
    sourceId: itemId,
    title: itemId,
    content,
    visibility: "PRIVATE",
    knownByRoleIds: ["role-governor"],
    basedOnWorldSequence: 3,
    inclusionReason: "pipeline test",
    priority,
    mustPreserve: priority === "P0"
  };
}

const compiled = compileStoryContextV2({
  identity: {
    runId: "run-pipeline",
    templateKey: "sangtian_v1_2",
    engineVersion: "continuous_story_v2",
    roleId: "role-governor",
    actorTurnId: "turn-governor-2",
    macroStageKey: "s1",
    worldSequence: 3,
    turnRevision: 2,
    controlEpoch: 1
  },
  purpose: "RESULT",
  audience: {
    roleName: "浙江总督",
    publicIdentity: "统筹浙江军政的封疆大吏",
    authority: ["调取县册", "传讯书吏", "秘密递奏"],
    cannotDo: ["替巡抚作出回答", "使用未获知的商会密谈"],
    privateGoal: "在执行急令前保住复核权",
    knowledgeBoundary: ["知道两份田册数字冲突", "不知道巡抚幕府的秘密交换"]
  },
  sources: [
    contextSource("identity", "ROLE_IDENTITY", "你是浙江总督。"),
    contextSource("authority", "ROLE_AUTHORITY", "可以调县册、传讯和秘密递奏，不能控制其他角色。"),
    contextSource("knowledge", "KNOWLEDGE_BOUNDARY", "只使用总督已经收到的公文、田册和当面证词。"),
    contextSource("scene", "CURRENT_SCENE", "嘉靖三十五年五月初八申初，杭州总督府签押房，总督与两名书吏在场。"),
    contextSource("pressure", "ACTIVE_PRESSURE", "巡抚的具名催问将在日落前送进签押房。"),
    contextSource("intent", "PLAYER_INTENT", playerAction),
    contextSource("resolution", "RULE_RESOLUTION", "原始田册已封存且封口火漆完整，两名书吏已经到场；老书吏已确认经手簿时辰被故意写早，桌上留有一枚刚换过线的钥匙，县印借用人仍未确认。"),
    contextSource("commitment", "COMMITMENT", "总督承诺日落前不在公开回文中写出老书吏姓名。"),
    contextSource("canon", "RECENT_CANON", recentCanon, "P1"),
    contextSource("affordance", "ACTION_AFFORDANCE", `${staticAffordanceSentinel}：此刻可以传讯、查印或秘密递奏；可互动角色：浙江巡抚[role-xunfu]。`, "P1")
  ],
  maxTokenEstimate: 1_600
});
assert.equal(compiled.ok, true);
if (!compiled.ok) throw new Error("test context failed to compile");
const context = compiled.snapshot;

const resultNarrative = "总督没有立刻拆开巡抚送来的催问。他先让门房把外厅的人引去喝茶，又命两名书吏各自站到长案两端。原始田册从封套里取出时，封口的火漆仍然完整；经手簿上昨夜借印的一栏却比别处颜色更深。\n\n年轻书吏先认出那是本衙常用的松烟墨，老书吏随后指出落笔的人故意把时辰写早了。总督叫人把他们的话分别记下，只在末尾按了自己的私印，没有把任何姓名写进将要公开的回文。";
const nextSituationNarrative = "申时将尽，雨势稍缓。两份证词和经手簿都留在杭州总督府签押房的长案上，老书吏仍坐在屏风后，没有被外厅来人看见。\n\n巡抚的具名短札已经送到门内，来使只肯再等一炷香；与此同时，管印小吏的座位空着，桌上却留着一枚刚换过线的钥匙。催问的期限、受保护的证人和这枚来历不明的钥匙同时压到案前，总督尚未开口，也没有再下第二道命令。";

const plan = {
  sceneGoal: "把封存和对印落实为可以追查的证据，同时保住证人",
  actionEcho: playerAction,
  beats: ["封存田册验看火漆", "两名书吏分开对印", "巡抚来使把期限压到一炷香"],
  characterReactions: [
    { actor: "年轻书吏", observableReaction: "指出墨色不同" },
    { actor: "老书吏", observableReaction: "辨认被改写的时辰" }
  ],
  confirmedConsequences: ["原始田册保持封存", "书吏证词分别落纸", "老书吏姓名没有公开"],
  secretsToWithhold: ["巡抚幕府的未知私下计划"],
  continuityAnchors: ["签押房", "两份田册", "日落期限", "不公开老书吏姓名的承诺"],
  resultEnding: "巡抚短札到门内",
  nextPressure: "来使只再等一炷香，管印小吏却不见踪影"
};

const narrative = {
  resultNarrative,
  nextSituationNarrative,
  endingState: {
    time: "嘉靖三十五年五月初八申末",
    location: "杭州总督府签押房",
    presentEntities: ["浙江总督", "两名书吏", "两份田册", "经手簿", "巡抚短札"],
    unresolvedPressure: "一炷香内答复巡抚，并查清管印小吏去向"
  },
  usedAnchorIds: ["scene", "resolution", "commitment", "canon"]
};

const narrativePass = {
  status: "PASS",
  issueCodes: [],
  unsupportedClaims: [],
  leakedFacts: [],
  missingAnchors: [],
  rewriteInstructions: []
};

const decisionDrafts = {
  decisions: [
    {
      id: "trace-key-holder",
      label: "先查清钥匙是谁换过线",
      description: "把巡抚来使留在外厅，派人带着钥匙去核对门房与管印房的出入记录，先固定昨夜借印人的身份。",
      objective: "查明昨夜借用县印的人",
      target: { type: "EVIDENCE", id: "key-thread", label: "换过线的钥匙" },
      method: "派人拿钥匙核对门房和管印房记录，并分开询问当值人员",
      leverageKeys: [],
      visibility: "PRIVATE",
      riskTolerance: "MEDIUM",
      fallback: { method: "若记录缺失，就封住管印房并逐一核对当值名册", triggerOn: "PRIMARY_BLOCKED" },
      condition: null,
      concreteCost: "巡抚来使可能因等待过久而认定总督故意拖延",
      expectedCountermove: "借印者可能在身份暴露前销毁门房记录",
      authorityBasis: "总督有权查验本衙门房和印信出入记录",
      basisFactKeys: [],
      effectHooks: ["VERIFY_KEY_CUSTODY", "PRESSURE_ENVOY_WAIT"]
    },
    {
      id: "answer-without-witness",
      label: "先给巡抚一封不点名的回文",
      description: "承认县册数字存在冲突，请巡抚同意在明日午前联合复核，但只附经手簿页码，不写出老书吏姓名。",
      objective: "争取联合复核时间并履行保护证人的承诺",
      target: { type: "ROLE", id: "role-xunfu", label: "浙江巡抚" },
      method: "写具名回文说明冲突和复核期限，只提交页码与封存印记",
      leverageKeys: [],
      visibility: "LIMITED",
      riskTolerance: "LOW",
      fallback: null,
      condition: null,
      concreteCost: "暂时放弃立刻追问管印小吏，可能让借印者获得转移证据的时间",
      expectedCountermove: "巡抚可能拒绝延期并要求立刻交出证人",
      authorityBasis: "总督可以用具名回文请求改变复核程序和期限",
      basisFactKeys: [],
      effectHooks: ["CREATE_INTERACTION_REQUEST", "PRESERVE_WITNESS_COMMITMENT"]
    }
  ]
};

const decisionPass = { status: "PASS", issueCodes: [], invalidCandidateIds: [], rewriteInstructions: [] };

class ScriptedModelClient implements StoryModelClientV2 {
  readonly requests: StoryModelRequestV2[] = [];

  constructor(private readonly responses: Array<unknown | Error>) {}

  async generate(request: StoryModelRequestV2): Promise<StoryModelResponseV2> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("scripted response missing");
    return {
      content: JSON.stringify(next),
      provider: "scripted",
      modelName: "story-test-model",
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    };
  }
}

function combinedStoryTurn(
  story: typeof narrative,
  decisionSet: typeof decisionDrafts
): typeof narrative & { decisions: typeof decisionDrafts.decisions } {
  return { ...story, decisions: decisionSet.decisions };
}

async function main() {
// PROMPT-001/002/003: the normal foreground path asks DeepSeek once. The
// response writes the story first and then derives decisions from that final
// story state; planning and both publication gates remain deterministic-local.
const client = new ScriptedModelClient([combinedStoryTurn(narrative, decisionDrafts)]);
const pipeline = new StoryGenerationPipelineV2(client);
const output = await pipeline.generate({ context, actionResolutionId: "resolution-3" });
assert.deepEqual(client.requests.map((request) => request.step), ["WRITER"]);
assert.deepEqual(output.promptExecutions.map((record) => record.pipelineStep), [
  "PLANNER",
  "WRITER",
  "NARRATIVE_VERIFIER",
  "DECISION_VERIFIER"
]);
const writerRequest = client.requests[0];
assert.ok(!writerRequest.userPrompt.includes(staticAffordanceSentinel));
assert.ok(!writerRequest.userPrompt.includes("mainCards"));
assert.ok(!writerRequest.userPrompt.includes("allowedNextDecisions"));
assert.ok(!writerRequest.userPrompt.includes("deterministicSafetyDraft"));
assert.ok(writerRequest.userPrompt.trim().endsWith(playerAction), "current player action must be the Writer prompt tail");
assert.ok(writerRequest.userPrompt.includes(recentCanon), "Writer must receive complete recent canon");
assert.match(writerRequest.userPrompt, /下一局势不是另开一宗新事件/);
assert.match(writerRequest.userPrompt, /巡抚的具名催问将在日落前送进签押房/);
assert.match(writerRequest.systemPrompt, /正文完整结束后.*nextSituationNarrative.*生成下一步 decisions/);
assert.match(writerRequest.userPrompt, /正文完成后生成决策的角色边界/);
assert.equal(output.finalStoryTextHash, hashStoryTextV2(nextSituationNarrative));
assert.ok(output.promptExecutions
  .filter((record) => record.pipelineStep === "PLANNER" || record.pipelineStep.endsWith("VERIFIER"))
  .every((record) => record.provider === "deterministic-local"));
assert.ok(output.decisions.every((decision) => decision.actionKey === null));
assert.deepEqual(output.decisions.map((decision) => decision.label), ["先查清钥匙是谁换过线", "先给巡抚一封不点名的回文"]);
assert.ok(output.decisions.every((decision) => decision.intentDraft.method.length > 0));
assert.ok(output.promptExecutions.every((record) => record.contextSnapshotHash === context.identity.snapshotHash));

// A concise but complete human-readable result is accepted on the first Writer
// call when the combined result and next situation form a full story beat.
const compactNaturalResult = "总督命人把原始田册继续封在签押房，并让两名书吏隔案陈述。因为封口火漆仍然完整，所以两人的话只能从经手簿的时辰对照。\n\n老书吏指出登记时辰被故意写早，但总督没有把他的姓名写入给巡抚的回文；这份保护证人的承诺因此仍然有效。";
assert.ok(compactNaturalResult.length >= 90 && compactNaturalResult.length < 120);
const compactNaturalNarrative = {
  ...narrative,
  resultNarrative: compactNaturalResult
};
const compactNaturalClient = new ScriptedModelClient([combinedStoryTurn(compactNaturalNarrative, decisionDrafts)]);
const compactNaturalOutput = await new StoryGenerationPipelineV2(compactNaturalClient).generate({
  context,
  actionResolutionId: "resolution-compact-natural",
  maxQualityAttempts: 1
});
assert.equal(compactNaturalClient.requests.filter((request) => request.step === "WRITER").length, 1);
assert.equal(compactNaturalClient.requests.length, 1);
assert.equal(compactNaturalOutput.narrative.resultNarrative, compactNaturalResult);

// An unnamed but contextually identifiable group remains grounded when the
// story and target use natural Chinese word order differently.
const missingClerkNarrative = {
  ...narrative,
  nextSituationNarrative: `${nextSituationNarrative}\n\n门房又报，两名改桑书吏今晨失踪，家人正在县衙外等消息。`
};
const missingClerkDecisions = {
  decisions: decisionDrafts.decisions.map((decision, index) => index === 0 ? {
    ...decision,
    label: "先去找失踪的两名改桑书吏",
    description: "派人分别去两名改桑书吏家中和常去的客栈询问，先确认他们最后一次被人看见的地点。",
    objective: "找到失踪的两名改桑书吏",
    target: { type: "PERSON", id: "missing-clerks", label: "失踪的两名改桑书吏" },
    method: "从两名改桑书吏的家人、保甲和常去客栈查找最后行踪"
  } : decision)
};
const missingClerkContext = {
  ...context,
  items: [
    ...context.items,
    {
      ...context.items[0],
      itemId: "resolution-missing-clerks",
      sourceId: "resolution-missing-clerks",
      sourceType: "RULE_RESOLUTION" as const,
      title: "已经确认的失踪书吏",
      content: "两名改桑书吏今晨失踪，家人正在县衙外等消息。"
    }
  ],
  renderedWorkingSet: `${context.renderedWorkingSet}\n\n两名改桑书吏今晨失踪，家人正在县衙外等消息。`
};
const missingClerkClient = new ScriptedModelClient([missingClerkNarrative, missingClerkDecisions]);
await new StoryGenerationPipelineV2(missingClerkClient).generate({
  context: missingClerkContext,
  actionResolutionId: "resolution-missing-clerks"
});

// When the model returns three choices and exactly one fails a candidate-scoped
// hard rule, publish the two independently verified survivors. The product
// contract is 2-4 real choices; a third fake choice must not add another remote call.
const threeDecisionDrafts = {
  decisions: [
    ...decisionDrafts.decisions,
    {
      ...decisionDrafts.decisions[1],
      id: "summon-xunfu-in-person",
      target: { type: "ROLE", id: "other-governor", label: "闽浙总督" },
      label: "请巡抚明早到总督府当面对册",
      description: "派具名差役把短札送到巡抚案前，请他明早携原始催办册来总督府，当着两名书吏逐项核对数字。",
      objective: "让巡抚当面对照两套数字",
      method: "派具名差役送札，请巡抚携原始催办册到总督府与两名书吏逐项核对"
    }
  ]
};
const partialDecisionFailure = {
  status: "FAIL",
  issueCodes: ["DECISION_METHOD_NOT_SPECIFIC"],
  invalidCandidateIds: ["trace-key-holder"],
  rewriteInstructions: ["trace-key-holder: 方法不够具体"]
};
const partialDecisionClient = new ScriptedModelClient([narrative, threeDecisionDrafts, decisionDrafts]);
const partialDecisionOutput = await new StoryGenerationPipelineV2(partialDecisionClient).generate({
  context,
  actionResolutionId: "resolution-partial-decisions"
});
assert.deepEqual(partialDecisionOutput.decisions.map((decision) => decision.id), ["trace-key-holder", "answer-without-witness"]);
assert.equal(partialDecisionClient.requests.filter((request) => request.step === "DECISION_DESIGNER").length, 1);

// Invented supporting names are removed across the entire draft, not one field
// at a time. A name introduced beside a role in the result must not survive as
// a bare name in the next situation or ending state. Quantity cleanup must also
// keep natural Chinese rather than producing phrases such as "第数日".
const inventedNamesNarrative = {
  ...narrative,
  resultNarrative: resultNarrative
    .replace("年轻书吏先认出", "亲信差役赵四先认出")
    .replace("老书吏随后指出", "邻居张老栓随后指出"),
  nextSituationNarrative: nextSituationNarrative
    .replace("申时将尽", "第二日申时将尽")
    .replace("老书吏仍坐在屏风后", "赵四退下后，张老栓仍坐在屏风后"),
  endingState: {
    ...narrative.endingState,
    time: "第二日申末",
    presentEntities: ["浙江总督", "亲信差役赵四", "邻居张老栓", "两份田册"],
    unresolvedPressure: "赵四与张老栓的证词仍待核实"
  }
};
const inventedNamesClient = new ScriptedModelClient([inventedNamesNarrative, decisionDrafts]);
const inventedNamesOutput = await new StoryGenerationPipelineV2(inventedNamesClient).generate({
  context,
  actionResolutionId: "resolution-invented-names"
});
const cleanedNarrative = JSON.stringify(inventedNamesOutput.narrative);
assert.ok(!cleanedNarrative.includes("赵四"));
assert.ok(!cleanedNarrative.includes("张老栓"));
assert.ok(!cleanedNarrative.includes("第数日"));
assert.ok(cleanedNarrative.includes("次日"));
assert.ok(cleanedNarrative.includes("总督亲信差役"));
assert.ok(cleanedNarrative.includes("那位邻居"), cleanedNarrative);
// Role-plus-surname forms and unsupported ordinal counts are normalized before
// they become canon; cleanup must remain natural Chinese.
const surnameAndOrdinalNarrative = {
  ...narrative,
  resultNarrative: narrative.resultNarrative.replace("年轻书吏先认出", "那幕僚姓陈先认出"),
  nextSituationNarrative: narrative.nextSituationNarrative.replace(
    "巡抚的具名短札已经送到门内",
    "第三封密信、第四封密信与巡抚具名短札一起送到门内"
  )
};
const surnameAndOrdinalClient = new ScriptedModelClient([surnameAndOrdinalNarrative, decisionDrafts]);
const surnameAndOrdinalOutput = await new StoryGenerationPipelineV2(surnameAndOrdinalClient).generate({
  context,
  actionResolutionId: "resolution-surname-ordinal"
});
const cleanedSurnameOrdinal = JSON.stringify(surnameAndOrdinalOutput.narrative);
assert.ok(!cleanedSurnameOrdinal.includes("姓陈"));
assert.ok(cleanedSurnameOrdinal.includes("那名幕僚"));
assert.ok(!cleanedSurnameOrdinal.includes("第数封"));
assert.ok(cleanedSurnameOrdinal.includes("某封密信"));
assert.ok(cleanedSurnameOrdinal.includes("其余密信"));

// Unlicensed character backstory and anachronistic historical claims require a
// Writer rewrite rather than being published as persuasive-looking fiction.
const anachronisticNarrative = {
  ...narrative,
  resultNarrative: narrative.resultNarrative.replace(
    "年轻书吏先认出",
    "那名幕僚在总督府执掌书启多年，随后认出"
  ),
  nextSituationNarrative: narrative.nextSituationNarrative.replace(
    "管印小吏的座位空着",
    "来函声称官印必须满文汉文并刻，但管印小吏的座位空着"
  )
};
const anachronisticClient = new ScriptedModelClient([anachronisticNarrative, narrative, decisionDrafts]);
await new StoryGenerationPipelineV2(anachronisticClient).generate({
  context,
  actionResolutionId: "resolution-anachronistic",
  maxQualityAttempts: 2
});
const historicalRepairPrompt = anachronisticClient.requests.filter((request) => request.step === "WRITER")[1].userPrompt;
assert.ok(historicalRepairPrompt.includes("RESULT_INTRODUCED_CHARACTER_BACKSTORY"));
assert.ok(historicalRepairPrompt.includes("NEXT_SITUATION_HISTORICAL_ANACHRONISM"));

// A label that joins two independently selectable orders is not a human choice;
// it is a bundle. It must be rewritten before publication.
const compoundDecisionDrafts = {
  decisions: decisionDrafts.decisions.map((decision, index) => index === 0 ? {
    ...decision,
    label: "催巡抚尽快回文，并派人盯住管印房"
  } : decision)
};
const compoundDecisionClient = new ScriptedModelClient([narrative, compoundDecisionDrafts, decisionDrafts]);
await new StoryGenerationPipelineV2(compoundDecisionClient).generate({
  context,
  actionResolutionId: "resolution-compound-decision",
  maxQualityAttempts: 2
});
const compoundDesignerPrompts = compoundDecisionClient.requests.filter((request) => request.step === "DECISION_DESIGNER");
assert.equal(compoundDesignerPrompts.length, 2);
assert.ok(compoundDesignerPrompts[1].userPrompt.includes("DECISION_MULTIPLE_PRIMARY_ACTIONS:trace-key-holder"));

// Decisions must be understandable and executable from the exact story ending.
// Vague people, face-to-face actions against an absent person, and modern slang
// all trigger a DecisionDesigner rewrite before anything reaches the player.
const unreadableDecisionDrafts = {
  decisions: [
    {
      ...decisionDrafts.decisions[0],
      id: "question-absent-person",
      label: "当面审问那名涉事人",
      description: "直接把那名涉事人扣在签押房盘问，逼他说明田册数字为何被改。",
      objective: "问清田册数字被改的原因",
      target: { type: "PERSON", id: "model-person-id", label: "涉事人" },
      method: "当面盘问那名涉事人并核对田册"
    },
    {
      ...decisionDrafts.decisions[1],
      id: "report-with-slang",
      label: "把田册涂改的事捅上去",
      description: "先向巡抚递一封密札，说明田册和经手簿存在矛盾，请他立刻派人共同查验。",
      objective: "让巡抚介入核验田册",
      method: "向浙江巡抚递送密札说明田册疑点"
    },
    decisionDrafts.decisions[0]
  ]
};
const unreadableDecisionClient = new ScriptedModelClient([narrative, unreadableDecisionDrafts, decisionDrafts]);
await new StoryGenerationPipelineV2(unreadableDecisionClient).generate({
  context,
  actionResolutionId: "resolution-unreadable-decisions",
  maxQualityAttempts: 2
});
const readableRepairPrompts = unreadableDecisionClient.requests.filter((request) => request.step === "DECISION_DESIGNER");
assert.equal(readableRepairPrompts.length, 2);
assert.ok(readableRepairPrompts[1].userPrompt.includes("DECISION_LABEL_MODERN_SLANG:report-with-slang"));
assert.ok(readableRepairPrompts[1].userPrompt.includes("DECISION_PERSON_TARGET_AMBIGUOUS:question-absent-person"));
assert.ok(readableRepairPrompts[1].userPrompt.includes("DECISION_PERSON_NOT_PRESENT:question-absent-person"));

// Exact counts invented by the Writer are rejected and rewritten. Mechanical
// substitutions such as “一批田亩” or “几人” destroy the story's meaning and
// must never be used to disguise an unsupported claim.
const inventedQuantitiesNarrative = {
  ...narrative,
  resultNarrative: narrative.resultNarrative.replace(
    "总督没有立刻拆开巡抚送来的催问。",
    "总督带三个人进了签押房，又让四个差役在门外等了半个时辰，案上还写着数百亩差额。总督没有立刻拆开巡抚送来的催问。"
  )
};
const inventedQuantitiesClient = new ScriptedModelClient([inventedQuantitiesNarrative, narrative, decisionDrafts]);
const inventedQuantitiesOutput = await new StoryGenerationPipelineV2(inventedQuantitiesClient).generate({
  context,
  actionResolutionId: "resolution-invented-quantities",
  maxQualityAttempts: 2
});
const quantityWriterRequests = inventedQuantitiesClient.requests.filter((request) => request.step === "WRITER");
assert.equal(quantityWriterRequests.length, 2);
assert.ok(quantityWriterRequests[1].userPrompt.includes("RESULT_INTRODUCED_EXACT_QUANTITY"));
assert.ok(quantityWriterRequests[1].userPrompt.includes("数百亩"));
assert.ok(quantityWriterRequests[1].userPrompt.includes("不得换成另一组数字"));
assert.equal(inventedQuantitiesOutput.narrative.resultNarrative, narrative.resultNarrative);
assert.ok(!inventedQuantitiesOutput.narrative.resultNarrative.includes("一批田亩"));
assert.ok(!inventedQuantitiesOutput.narrative.resultNarrative.includes("几个人"));

// A complete scene may contain an interior dialogue pause. Only a story that
// actually ends on an ellipsis is a truncation failure.
const dialoguePauseNarrative = {
  ...narrative,
  resultNarrative: narrative.resultNarrative.replace("年轻书吏先认出", "年轻书吏嗫嚅：“这……这墨色不对。”随后认出")
};
const dialoguePauseClient = new ScriptedModelClient([dialoguePauseNarrative, decisionDrafts]);
await new StoryGenerationPipelineV2(dialoguePauseClient).generate({ context, actionResolutionId: "resolution-dialogue-pause" });
assert.deepEqual(dialoguePauseClient.requests.map((request) => request.step), [
  "WRITER", "DECISION_DESIGNER"
]);

// A Writer may return the underlying entity id for a scoped context anchor
// such as `commitment:<id>`. That remains grounded in the authorized workset
// and must not trigger another expensive Writer call.
const suffixAnchorContext = {
  ...context,
  items: [
    ...context.items,
    { ...context.items[0], itemId: "commitment:commitment-42", title: "commitment:commitment-42" }
  ]
};
const suffixAnchorNarrative = { ...narrative, usedAnchorIds: ["commitment-42"] };
const suffixAnchorClient = new ScriptedModelClient([suffixAnchorNarrative, decisionDrafts]);
await new StoryGenerationPipelineV2(suffixAnchorClient).generate({
  context: suffixAnchorContext,
  actionResolutionId: "resolution-suffix-anchor"
});
assert.equal(suffixAnchorClient.requests.filter((request) => request.step === "WRITER").length, 1);
// Paragraphing and explicit causality are publication rules inside the Writer
// repair loop, not late failures that leave a submitted player turn stuck.
const flatNarrative = { ...narrative, resultNarrative: resultNarrative.replace(/\n\n+/g, "") };
const proseRepairClient = new ScriptedModelClient([
  flatNarrative,
  narrative,
  decisionDrafts
]);
const proseRepairOutput = await new StoryGenerationPipelineV2(proseRepairClient).generate({
  context,
  actionResolutionId: "resolution-prose-repair",
  maxQualityAttempts: 2
});
assert.equal(proseRepairClient.requests.filter((request) => request.step === "WRITER").length, 1);
assert.ok(proseRepairOutput.narrative.resultNarrative.split(/\n\n+/).length >= 2);

// A Writer must not smuggle the next menu into prose with paired "若" clauses.
// Remove only that sentence locally so a usable DeepSeek response does not need
// another full remote Writer call.
const disguisedMenuNarrative = {
  ...narrative,
  nextSituationNarrative: "外厅差役又扬声催问，巡抚还等着回文。你望向案上催文，密奏已经递出，但眼前这份回文仍需答复。\n\n若此时签押认可副本，便坐实正本有误；若驳回，则须另作解释。\n\n差役的脚步声已经移近厅门，门帘轻响，他仍在等你开口。"
};
const disguisedMenuClient = new ScriptedModelClient([disguisedMenuNarrative, decisionDrafts]);
const disguisedMenuOutput = await new StoryGenerationPipelineV2(disguisedMenuClient).generate({
  context,
  actionResolutionId: "resolution-disguised-menu",
  maxQualityAttempts: 1
});
assert.equal(disguisedMenuClient.requests.filter((request) => request.step === "WRITER").length, 1);
assert.ok(!disguisedMenuOutput.narrative.nextSituationNarrative.includes("若此时签押"));
assert.ok(disguisedMenuOutput.narrative.nextSituationNarrative.includes("差役的脚步声"));

const actuallyTruncated = { ...narrative, nextSituationNarrative: `${nextSituationNarrative.slice(0, -1)}，总督提笔……` };
const truncatedClient = new ScriptedModelClient([actuallyTruncated]);
let truncatedError: StoryGenerationErrorV2 | null = null;
try {
  await new StoryGenerationPipelineV2(truncatedClient).generate({ context, actionResolutionId: "resolution-truncated", maxQualityAttempts: 1 });
} catch (error) {
  if (error instanceof StoryGenerationErrorV2) truncatedError = error;
  else throw error;
}
assert.ok(truncatedError?.issueCodes.includes("NEXT_SITUATION_TRUNCATED_OR_ELLIPSIS"));

// Agent decisions are role-grounded model judgments over the reviewed choices, never a turn-index rotation.
const persistedAgentRows: any[] = [];
const agentProvider = new StoryNarrativeProvider({
  promptExecutionRecord: {
    createMany: async ({ data }: { data: any[] }) => { persistedAgentRows.push(...data); return { count: data.length }; }
  }
} as any);
const agentRequests: StoryModelRequestV2[] = [];
const agentResponses = [
  { candidateId: "unknown-option", rationale: "这项输出故意选择了不存在的候选，用来验证系统会拒绝机械或越界结果。" },
  { candidateId: "answer-without-witness", rationale: "巡抚来使只再等一炷香，而保护证人的承诺仍有效；先给有限回文能守住承诺并争取复核时间。" }
];
agentProvider.generate = async (request: StoryModelRequestV2) => {
  agentRequests.push(request);
  return { content: JSON.stringify(agentResponses.shift()), provider: "scripted", modelName: "agent-test-model" };
};
const agentChoice = await agentProvider.decideAgent({
  context,
  contextRecordId: "context-agent-1",
  finalStory: nextSituationNarrative,
  candidates: output.decisions,
  getCurrentIdentity: () => context.identity
});
assert.equal(agentChoice.candidateId, "answer-without-witness");
assert.deepEqual(agentRequests.map((request) => request.step), ["AGENT_DECIDER", "AGENT_DECIDER"]);
assert.ok(agentRequests.every((request) => request.userPrompt.trim().endsWith(nextSituationNarrative)));
assert.deepEqual(persistedAgentRows.map((row) => row.status), ["FAILED", "SUCCESS"]);
assert.ok(persistedAgentRows.every((row) => row.pipelineStep === "AGENT_DECIDER"));

// Opening prose is completed before options, and the designer reads the exact full opening shown to the player.
const openingCompiled = compileStoryContextV2({
  identity: { ...context.identity, actorTurnId: "turn-opening", turnRevision: 1 },
  purpose: "OPENING",
  audience: context.audience,
  sources: [
    contextSource("opening-identity", "ROLE_IDENTITY", "你是浙江总督。"),
    contextSource("opening-authority", "ROLE_AUTHORITY", "可以传讯、查验公文和秘密递奏。"),
    contextSource("opening-knowledge", "KNOWLEDGE_BOUNDARY", "从县令密信中得知县册改痕可能牵出田契暗账线索，但手里没有暗账、抄件或田契实物。"),
    { ...contextSource("opening-world", "WORLD_BIBLE", "嘉靖朝的杭州官署依靠公文、印信和人证办事。"), visibility: "PUBLIC" as const, knownByRoleIds: [] },
    contextSource("opening-scene", "CURRENT_SCENE", "杭州总督府签押房，案上有清流县呈送的县册正本和巡抚衙门留存的副本，两册数字冲突；巡抚的催问即将送到。"),
    contextSource("opening-pressure", "ACTIVE_PRESSURE", "日落前必须回应改桑急令。"),
    contextSource("opening-affordance", "ACTION_AFFORDANCE", "可查县册、询问书吏或秘密递奏；可互动角色：浙江巡抚[role-xunfu]。", "P1")
  ],
  maxTokenEstimate: 1_200
});
assert.equal(openingCompiled.ok, true);
if (!openingCompiled.ok) throw new Error("opening context failed to compile");
const openingNarrative = {
  resultNarrative: "杭州总督府签押房里，巡抚的催问公文刚被送到案前。浙江总督翻开公文，又看向已经摊开的两份田册：它们说的是同一件改桑差事，数字却互相冲突；因为日落前必须回话，屋里的人都在等他先判断哪一份更可信。\n\n外厅来使没有进门，只托门房再问何时能取回文。总督没有回答，也没有叫人去查；他只把两份册子留在案前，县册数字不一致与日落期限便同时压在眼前。",
  nextSituationNarrative: "窗外的日影继续西移。两份县册停在有改痕的一页，却还不能断言是谁动过；与此同时，只有总督知道的田契暗账线索也可能解释这处矛盾，但一旦过早公开，暗中留下线索的人便会察觉。\n\n巡抚来使仍在外厅等候，日落期限没有改变。因为案上两份数字互相冲突的县册始终无法给出同一个答案，外厅又传来一声催问；总督尚未开口，也没有发出任何命令。",
  endingState: {
    time: "日落前",
    location: "杭州总督府签押房",
    presentEntities: ["浙江总督", "两份田册", "巡抚催问公文", "田契暗账线索"],
    unresolvedPressure: "日落前必须回应浙江巡抚，但两份田册数字互相冲突，田契暗账线索又不能轻易公开"
  },
  usedAnchorIds: ["opening-scene", "opening-pressure", "opening-knowledge"]
};
const openingDecisionDrafts = {
  decisions: [
    {
      ...decisionDrafts.decisions[0],
      id: "compare_opening_registers",
      label: "先把眼前两份田册逐页核对",
      description: "让在场书吏只核对页码、改痕和经手记录，先找出数字从哪一页开始不同，不向外厅透露暗账线索。",
      objective: "查清两份田册数字冲突从何处出现",
      target: { type: "EVIDENCE", id: "opening-registers", label: "两份田册" },
      method: "在签押房逐页核对两份田册的页码、改痕和经手记录",
      concreteCost: "巡抚来使要继续等候，可能把拖延回报给浙江巡抚",
      expectedCountermove: "经手书吏可能不肯承认改痕，或称旧页已经遗失"
    },
    {
      ...decisionDrafts.decisions[1],
      id: "answer_xunfu_first",
      label: "先给浙江巡抚回一封短札",
      description: "只说明县册数字互相冲突，请他把日落期限稍往后放，不提尚未公开的田契暗账线索。",
      objective: "争取核对田册的时间",
      target: { type: "ROLE", id: "role-xunfu", label: "浙江巡抚" },
      method: "写一封具名短札说明数字冲突并请求延后回文",
      concreteCost: "浙江巡抚可能认定总督故意拖延急令",
      expectedCountermove: "浙江巡抚可能拒绝延期并再次催逼"
    }
  ]
};

const invalidOpeningNarrative = {
  ...openingNarrative,
  resultNarrative: `${openingNarrative.resultNarrative}\n\n总督当即命差役赶赴仁和县，限县令回报。`,
  nextSituationNarrative: `${openingNarrative.nextSituationNarrative}\n\n案上又出现了一份《嘉兴府急催单》。`
};
invalidOpeningNarrative.nextSituationNarrative += "\n\n总督必须决定，是先批复还是先派查。";
const openingClient = new ScriptedModelClient([invalidOpeningNarrative, openingNarrative, openingDecisionDrafts]);
const openingOutput = await new StoryGenerationPipelineV2(openingClient).generate({
  context: openingCompiled.snapshot,
  actionResolutionId: null,
  maxQualityAttempts: 2
});
const openingWriterRequests = openingClient.requests.filter((request) => request.step === "WRITER");
assert.equal(openingWriterRequests.length, 2);
assert.ok(openingWriterRequests[1].userPrompt.includes("OPENING_RESULT_STEALS_FIRST_DECISION"));
assert.ok(openingWriterRequests[1].userPrompt.includes("INTRODUCED_NAMED_LOCATION_OR_DOCUMENT"));
assert.ok(openingWriterRequests[1].userPrompt.includes("仁和县"));
assert.ok(openingWriterRequests[1].userPrompt.includes("《嘉兴府急催单》"));
assert.ok(openingWriterRequests[1].userPrompt.includes("不得换成别的府县或文书标题"));
const fullOpening = `${openingOutput.narrative.resultNarrative}\n\n${openingOutput.narrative.nextSituationNarrative}`;
assert.ok(openingWriterRequests[0].userPrompt.trim().endsWith("不得写成背景摘要。"));
const openingDesignerRequest = openingClient.requests.find((request) => request.step === "DECISION_DESIGNER");
assert.ok(openingDesignerRequest?.userPrompt.trim().endsWith(fullOpening));
assert.equal(openingOutput.finalStoryTextHash, hashStoryTextV2(fullOpening));
assert.ok(!fullOpening.includes("仁和县"));
assert.ok(!fullOpening.includes("《嘉兴府急催单》"));
assert.ok(!fullOpening.includes("总督必须决定，是先批复还是先派查"));

// A harmless unsupported waiting duration is deterministically de-quantified
// instead of paying for another full Writer call. Material counts and stakes
// still fail the hard gate and require a fresh story draft.
const exactWaitingOpening = {
  ...openingNarrative,
  nextSituationNarrative: openingNarrative.nextSituationNarrative.replace("仍在外厅等候", "已在外厅等了一个时辰")
};
const exactWaitingClient = new ScriptedModelClient([exactWaitingOpening, openingDecisionDrafts]);
const exactWaitingOutput = await new StoryGenerationPipelineV2(exactWaitingClient).generate({
  context: openingCompiled.snapshot,
  actionResolutionId: null
});
assert.equal(exactWaitingClient.requests.filter((request) => request.step === "WRITER").length, 1);
assert.ok(!exactWaitingOutput.narrative.nextSituationNarrative.includes("一个时辰"));
assert.ok(exactWaitingOutput.narrative.nextSituationNarrative.includes("等了一阵"));

// OPENING cannot invent completed player actions, put an unplaced NPC in the
// room, or turn a person into an "object". All three are publication failures,
// and the retry feedback must tell the Writer what was wrong.
const malformedOpeningNarrative = {
  ...openingNarrative,
  resultNarrative: openingNarrative.resultNarrative.replace(
    "浙江总督翻开公文",
    "幕僚已在外间等候。浙江总督刚对照过第三遍，随后翻开公文；他断定这并非笔误，手指还碰了碰腰间玉佩"
  ),
  nextSituationNarrative: openingNarrative.nextSituationNarrative + "\n\n他手里仍无那名书吏实物。"
};
const malformedOpeningClient = new ScriptedModelClient([malformedOpeningNarrative, openingNarrative, openingDecisionDrafts]);
await new StoryGenerationPipelineV2(malformedOpeningClient).generate({
  context: openingCompiled.snapshot,
  actionResolutionId: null,
  maxQualityAttempts: 2
});
const malformedOpeningRequests = malformedOpeningClient.requests.filter((request) => request.step === "WRITER");
assert.equal(malformedOpeningRequests.length, 2);
assert.match(malformedOpeningRequests[1].userPrompt, /INVENTED_PRIOR_ACTION/);
assert.ok(malformedOpeningRequests[1].userPrompt.includes("OPENING_RESULT_INTRODUCED_UNPLACED_ACTOR"));
assert.ok(malformedOpeningRequests[1].userPrompt.includes("NEXT_SITUATION_MALFORMED_PERSON_AS_EVIDENCE"));
assert.ok(malformedOpeningRequests[1].userPrompt.includes("RESULT_INTRODUCED_UNSUPPORTED_PROP"));
assert.ok(malformedOpeningRequests[1].userPrompt.includes("RESULT_UNSUPPORTED_CERTAINTY"));
assert.ok(!malformedOpeningClient.requests.at(-1)?.userPrompt.includes("第三遍"));

// A grounded location may be preceded by ordinary sentence words. The verifier
// must recognize the authorized suffix instead of paying for a false retry such
// as reading "左首是清流县" as an invented county name.
const groundedLocationNarrative = {
  ...openingNarrative,
  resultNarrative: openingNarrative.resultNarrative.replace(
    "两份田册",
    "两份田册；左首是清流县呈送的县册正本"
  )
};
const groundedLocationContext = {
  ...openingCompiled.snapshot,
  items: openingCompiled.snapshot.items.map((item) => item.sourceType === "CURRENT_SCENE"
    ? { ...item, content: `${item.content} 清流县呈送的县册正本已经在案上。` }
    : item)
};
const groundedLocationClient = new ScriptedModelClient([groundedLocationNarrative, openingDecisionDrafts]);
await new StoryGenerationPipelineV2(groundedLocationClient).generate({
  context: groundedLocationContext,
  actionResolutionId: null
});
assert.equal(groundedLocationClient.requests.filter((request) => request.step === "WRITER").length, 1);

// A visible option cannot bundle "read" and "destroy" into one choice. Those
// are two different player commitments and must be offered separately.
const sequencedDecisionDrafts = {
  decisions: openingDecisionDrafts.decisions.map((decision, index) => index === 0 ? {
    ...decision,
    id: "read_then_burn_letter",
    label: "取出密信再读一遍，然后烧掉",
    description: "先重新阅读县令密信，再把原件烧掉，以免信件被外人拿到，但从此失去原件。",
    objective: "记住线索并销毁密信原件",
    target: { type: "EVIDENCE", id: "county-letter", label: "县令密信" },
    method: "取出县令密信，阅读后烧毁"
  } : decision)
};
const sequencedDecisionClient = new ScriptedModelClient([openingNarrative, sequencedDecisionDrafts, openingDecisionDrafts]);
await new StoryGenerationPipelineV2(sequencedDecisionClient).generate({
  context: openingCompiled.snapshot,
  actionResolutionId: null,
  maxQualityAttempts: 2
});
const sequencedDesignerRequests = sequencedDecisionClient.requests.filter((request) => request.step === "DECISION_DESIGNER");
assert.equal(sequencedDesignerRequests.length, 2);
assert.ok(sequencedDesignerRequests[1].userPrompt.includes("DECISION_MULTIPLE_PRIMARY_ACTIONS:read_then_burn_letter"));
// A decision must not invent an executor, hide that the player is lying, or
// promise an investigation result before a journey can physically finish.
const unrealisticDecisionDrafts = {
  decisions: openingDecisionDrafts.decisions.map((decision, index) => index === 0 ? {
    ...decision,
    id: "pretend_execution_done",
    label: "先回巡抚，说改桑已按令执行",
    description: "直接回文说改桑已经照令办妥，先压下催促，但不告诉玩家这是尚未被事实支持的说法。",
    objective: "让巡抚停止催促",
    method: "回文确认改桑已经执行"
  } : {
    ...decision,
    id: "impossible_overnight_probe",
    label: "马上派心腹书办连夜赶往清流县",
    description: "让新找来的心腹书办赶去清流县田契档房，要求他在日落回文前拿到暗账证据。",
    objective: "在日落回文前拿到暗账证据",
    target: { type: "LOCATION", id: "qingliu-county", label: "清流县" },
    method: "派心腹书办连夜赶往清流县调查"
  })
};
const unrealisticDecisionClient = new ScriptedModelClient([openingNarrative, unrealisticDecisionDrafts, openingDecisionDrafts]);
await new StoryGenerationPipelineV2(unrealisticDecisionClient).generate({
  context: openingCompiled.snapshot,
  actionResolutionId: null,
  maxQualityAttempts: 2
});
const unrealisticDesignerRequests = unrealisticDecisionClient.requests.filter((request) => request.step === "DECISION_DESIGNER");
assert.equal(unrealisticDesignerRequests.length, 2);
assert.ok(unrealisticDesignerRequests[1].userPrompt.includes("DECISION_UNMARKED_DECEPTION:pretend_execution_done"));
assert.ok(unrealisticDesignerRequests[1].userPrompt.includes("DECISION_INTRODUCED_EXECUTOR:impossible_overnight_probe"));
assert.ok(unrealisticDesignerRequests[1].userPrompt.includes("DECISION_TEMPORALLY_IMPOSSIBLE:impossible_overnight_probe"));
// A clue must never be upgraded into physical evidence that the governor can
// touch or use. The Writer must repair the story before DecisionDesigner runs.
const unheldEvidenceNarrative = {
  ...openingNarrative,
  nextSituationNarrative: openingNarrative.nextSituationNarrative.replace(`田契暗账线索`, `案上的田契暗账抄件`),
  endingState: {
    ...openingNarrative.endingState,
    presentEntities: [...openingNarrative.endingState.presentEntities, `田契暗账抄件`]
  }
};
const unheldEvidenceWriterClient = new ScriptedModelClient([unheldEvidenceNarrative, openingNarrative, openingDecisionDrafts]);
const repairedUnheldEvidenceStory = await new StoryGenerationPipelineV2(unheldEvidenceWriterClient).generate({
  context: openingCompiled.snapshot,
  actionResolutionId: null,
  maxQualityAttempts: 2
});
const unheldWriterRequests = unheldEvidenceWriterClient.requests.filter((request) => request.step === `WRITER`);
assert.equal(unheldWriterRequests.length, 2);
assert.ok(unheldWriterRequests[1].userPrompt.includes(`NEXT_SITUATION_CONTRADICTS_EVIDENCE_POSSESSION`));
assert.ok(unheldWriterRequests[1].userPrompt.includes(`手里没有暗账、抄件或田契实物`));
assert.ok(!`${repairedUnheldEvidenceStory.narrative.resultNarrative}${repairedUnheldEvidenceStory.narrative.nextSituationNarrative}`.includes(`暗账抄件`));

// A truthful denial is not possession. The verifier must not loop merely
// because the prose says the governor has no ledger or deed in hand, and
// "他想起县令密信" must not be mistaken for an invented county name.
const deniedEvidenceNarrative = {
  ...openingNarrative,
  resultNarrative: openingNarrative.resultNarrative + "\n\n他想起县令密信中的暗账线索，但手里没有暗账、抄件或田契实物，因此只能先从眼前县册判断。",
  endingState: {
    ...openingNarrative.endingState,
    time: "嘉靖某年三月廿七日申时三刻"
  }
};
const deniedEvidenceClient = new ScriptedModelClient([deniedEvidenceNarrative, openingDecisionDrafts]);
const deniedEvidenceOutput = await new StoryGenerationPipelineV2(deniedEvidenceClient).generate({
  context: openingCompiled.snapshot,
  actionResolutionId: null
});
assert.equal(deniedEvidenceClient.requests.filter((request) => request.step === "WRITER").length, 1);
assert.equal(deniedEvidenceOutput.narrative.endingState.time, "当日午后");
assert.ok(deniedEvidenceOutput.narrative.resultNarrative.includes("手里没有暗账、抄件或田契实物"));
// Decisions are checked against the same possession boundary. A menu cannot
// offer to inspect evidence that exists only as a reported clue.
const unheldEvidenceDecisions = {
  decisions: openingDecisionDrafts.decisions.map((decision, index) => index === 0 ? {
    ...decision,
    id: `read_unheld_ledger`,
    label: `先翻开案上的暗账抄件`,
    description: `先从案上拿起暗账抄件逐页查看，找出与县册改痕相同的笔迹，再决定是否告诉巡抚。`,
    objective: `从暗账抄件里确认县册为何被改`,
    target: { type: `EVIDENCE`, id: `unheld-ledger-copy`, label: `暗账抄件` },
    method: `翻阅案上的暗账抄件并与两份县册的改痕对照`
  } : decision)
};
const unheldEvidenceDecisionClient = new ScriptedModelClient([openingNarrative, unheldEvidenceDecisions, openingDecisionDrafts]);
const repairedUnheldEvidenceDecisions = await new StoryGenerationPipelineV2(unheldEvidenceDecisionClient).generate({
  context: openingCompiled.snapshot,
  actionResolutionId: null,
  maxQualityAttempts: 2
});
const unheldDecisionRequests = unheldEvidenceDecisionClient.requests.filter((request) => request.step === `DECISION_DESIGNER`);
assert.equal(unheldDecisionRequests.length, 2);
assert.ok(unheldDecisionRequests[1].userPrompt.includes(`DECISION_USES_UNHELD_EVIDENCE:read_unheld_ledger`));
assert.ok(unheldDecisionRequests[1].userPrompt.includes(`从当前实际持有的县册、公文或县令密信渠道出发`));
assert.ok(repairedUnheldEvidenceDecisions.decisions.every((decision) => !decision.label.includes(`暗账抄件`)));

// A narrative person must never retain or masquerade as a registered role id.
// The visible person label remains grounded in the final story while the hidden
// id is normalized to a stable PERSON namespace and cannot bind to another role.
const personIdCollisionDecisions = {
  decisions: decisionDrafts.decisions.map((decision, index) => index === 0 ? {
    ...decision,
    id: "question-old-clerk",
    label: "先当面问老书吏经手簿的事",
    description: "把老书吏留在屏风后单独询问，请他说明经手簿墨色和改写时辰的依据。",
    objective: "核实经手簿被改写的经过",
    target: { type: "PERSON", id: "role-xunfu", label: "老书吏" },
    method: "单独询问老书吏经手簿的墨色和改写时辰"
  } : decision)
};
const personIdCollisionClient = new ScriptedModelClient([narrative, personIdCollisionDecisions]);
const personIdCollisionOutput = await new StoryGenerationPipelineV2(personIdCollisionClient).generate({
  context,
  actionResolutionId: "resolution-person-id-collision"
});
const normalizedPersonDecision = personIdCollisionOutput.decisions.find((decision) => decision.id === "question-old-clerk");
assert.ok(normalizedPersonDecision);
assert.match(normalizedPersonDecision.intentDraft.target.id, /^person:[a-f0-9]{16}$/);
assert.equal(normalizedPersonDecision.intentDraft.target.label, "老书吏");
assert.equal(normalizedPersonDecision.targetRoleId, null);
assert.equal(normalizedPersonDecision.targetRoleName, null);

// Hidden ids for evidence and every other non-role target are server-owned too.
// A model copying a role id must not trigger a full story regeneration loop.
const evidenceIdCollisionDecisions = {
  decisions: decisionDrafts.decisions.map((decision, index) => index === 0 ? {
    ...decision,
    target: { type: "EVIDENCE", id: "role-xunfu", label: "换过线的钥匙" }
  } : decision)
};
const evidenceIdCollisionClient = new ScriptedModelClient([narrative, evidenceIdCollisionDecisions]);
const evidenceIdCollisionOutput = await new StoryGenerationPipelineV2(evidenceIdCollisionClient).generate({
  context,
  actionResolutionId: "resolution-evidence-id-collision"
});
assert.match(evidenceIdCollisionOutput.decisions[0].intentDraft.target.id, /^evidence:[a-f0-9]{16}$/);
assert.equal(evidenceIdCollisionClient.requests.filter((request) => request.step === "DECISION_DESIGNER").length, 1);

// A final ending has no fake next-choice phase and therefore stops after narrative verification.
const endingClient = new ScriptedModelClient([narrative]);
const endingOutput = await new StoryGenerationPipelineV2(endingClient).generate({
  context,
  actionResolutionId: "resolution-ending",
  generateDecisions: false
});
assert.deepEqual(endingClient.requests.map((request) => request.step), ["WRITER"]);
assert.ok(endingClient.requests[0].userPrompt.includes("# 这是本角色的最终回合"));
assert.deepEqual(endingOutput.decisions, []);

// A fabricated role target is rejected by the deterministic registry even if the model verifier says PASS; only a regenerated grounded set can publish.
const inventedRoleDecisions = {
  decisions: decisionDrafts.decisions.map((decision, index) => index === 1 ? {
    ...decision,
    id: "ask-invented-governor",
    label: "请闽浙总督派人来复核",
    description: "把经手簿送往一个当前局势中从未出现的总督衙门，请对方立即派人复核。",
    target: { type: "ROLE", id: "other-governor", label: "闽浙总督" }
  } : decision)
};
const decisionRepairClient = new ScriptedModelClient([
  narrative,
  inventedRoleDecisions,
  decisionDrafts
]);
const repairedDecisionOutput = await new StoryGenerationPipelineV2(decisionRepairClient).generate({
  context,
  actionResolutionId: "resolution-decision-repair",
  maxQualityAttempts: 2
});
assert.equal(decisionRepairClient.requests.filter((request) => request.step === "DECISION_DESIGNER").length, 2);
assert.deepEqual(repairedDecisionOutput.decisions.map((decision) => decision.id), ["trace-key-holder", "answer-without-witness"]);
const repairedDesignerPrompt = decisionRepairClient.requests.filter((request) => request.step === "DECISION_DESIGNER")[1].userPrompt;
assert.ok(repairedDesignerPrompt.includes("DECISION_ROLE_TARGET_NOT_IN_CONTEXT:ask-invented-governor"));
assert.ok(repairedDesignerPrompt.trim().endsWith(nextSituationNarrative));

// Player-facing labels must sound like something a person would actually say,
// not like a regulation title or an AI-generated policy memo.
const bureaucraticDecisionDrafts = {
  decisions: decisionDrafts.decisions.map((decision, index) => index === 0 ? {
    ...decision,
    label: "立即设立联合复核程序，把执行速度与证据复核同时纳入总督衙门控制"
  } : {
    ...decision,
    label: "以联合复核章程需协商一致为由，预先拒绝巡抚从外县调派新书吏"
  })
};
const plainSpeechRepairClient = new ScriptedModelClient([
  narrative,
  bureaucraticDecisionDrafts,
  decisionDrafts
]);
const plainSpeechOutput = await new StoryGenerationPipelineV2(plainSpeechRepairClient).generate({
  context,
  actionResolutionId: "resolution-plain-speech-repair",
  maxQualityAttempts: 2
});
assert.deepEqual(plainSpeechOutput.decisions.map((decision) => decision.label), ["先查清钥匙是谁换过线", "先给巡抚一封不点名的回文"]);
const plainSpeechDesignerPrompts = plainSpeechRepairClient.requests.filter((request) => request.step === "DECISION_DESIGNER");
assert.equal(plainSpeechDesignerPrompts.length, 2);
assert.match(plainSpeechDesignerPrompts[1].userPrompt, /DECISION_LABEL_(?:LENGTH_INVALID|NOT_PLAIN_SPEECH)/);
assert.ok(plainSpeechDesignerPrompts[1].userPrompt.trim().endsWith(nextSituationNarrative));

// PROMPT-004: a failed verifier stops publication; no decision generation or fixed fallback follows.
const rejectedClient = new ScriptedModelClient([
  narrative,
  { ...narrativePass, status: "FAIL", issueCodes: ["UNSUPPORTED_SECRET"], leakedFacts: ["巡抚私下计划"] }
]);
let rejectedError: StoryGenerationErrorV2 | null = null;
try {
  await new StoryGenerationPipelineV2(rejectedClient, { remoteSemanticReview: true }).generate({ context, actionResolutionId: "resolution-4", maxQualityAttempts: 1 });
} catch (error) {
  if (error instanceof StoryGenerationErrorV2) rejectedError = error;
  else throw error;
}
assert.ok(rejectedError);
assert.equal(rejectedError.code, "NARRATIVE_REJECTED");
assert.ok(rejectedError.recoverable);
assert.ok(rejectedError.issueCodes.includes("UNSUPPORTED_SECRET"));
assert.deepEqual(rejectedClient.requests.map((request) => request.step), ["WRITER", "NARRATIVE_VERIFIER"]);
assert.equal(rejectedError.promptExecutions.length, 4);

// A transient stage failure retries only that stage against the same context; earlier stages and rules are not repeated.
const retryClient = new ScriptedModelClient([new Error("transient writer timeout"), combinedStoryTurn(narrative, decisionDrafts)]);
const retried = await new StoryGenerationPipelineV2(retryClient).generate({ context, actionResolutionId: "resolution-retry", maxStepAttempts: 2 });
assert.deepEqual(retryClient.requests.map((request) => request.step), [
  "WRITER",
  "WRITER"
]);
const writerAttempts = retried.promptExecutions.filter((record) => record.pipelineStep === "WRITER");
assert.deepEqual(writerAttempts.map((record) => [record.attempt, record.status]), [[1, "FAILED"], [2, "SUCCESS"]]);
assert.ok(writerAttempts.every((record) => record.contextSnapshotHash === context.identity.snapshotHash));

// Provider failures are recoverable generation failures, not deterministic player-visible prose.
const failedClient = new ScriptedModelClient([new Error("provider timeout")]);
let providerError: StoryGenerationErrorV2 | null = null;
try {
  await new StoryGenerationPipelineV2(failedClient).generate({ context, actionResolutionId: "resolution-5", maxStepAttempts: 1 });
} catch (error) {
  if (error instanceof StoryGenerationErrorV2) providerError = error;
  else throw error;
}
assert.ok(providerError);
assert.equal(providerError.code, "MODEL_CALL_FAILED");
assert.deepEqual(failedClient.requests.map((request) => request.step), ["WRITER"]);
assert.equal(providerError.promptExecutions.at(-1)?.status, "FAILED");

// A world update after narrative verification supersedes the old snapshot before decisions are designed.
const staleClient = new ScriptedModelClient([narrative]);
let staleError: StoryGenerationErrorV2 | null = null;
try {
  await new StoryGenerationPipelineV2(staleClient).generate({
    context,
    actionResolutionId: "resolution-6",
    getCurrentIdentity: () => ({ ...context.identity, worldSequence: context.identity.worldSequence + 1 })
  });
} catch (error) {
  if (error instanceof StoryGenerationErrorV2) staleError = error;
  else throw error;
}
assert.ok(staleError);
assert.equal(staleError.code, "CONTEXT_SUPERSEDED");
assert.deepEqual(staleClient.requests.map((request) => request.step), ["WRITER"]);
assert.equal(staleError.promptExecutions.at(-1)?.status, "SUPERSEDED");

console.log("continuous story v2 prompt isolation pipeline: PASS");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
