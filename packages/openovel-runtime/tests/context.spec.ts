import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { compareContexts } from "../src/comparison";
import { compileCausalTurn } from "../src/causal-turn-engine";
import { compileShadowContext } from "../src/context-compiler";
import { compileEvidencePackage } from "../src/evidence-compiler";
import { normalizeAndValidateShadowOutput } from "../src/shadow-output-normalizer";
import { hasCompletedSecretaryRecord, parseAndValidateShadowOutput } from "../src/shadow-output-validator";
import { openovelPaths } from "../src/paths";
import { buildLandRecordReviewFixture, buildSelectedDecisionFixture } from "../src/selected-decision-transition";
import { buildShadowTurnPrompt } from "../src/shadow-prompt";
import { buildShadowQualityRubric } from "../src/shadow-quality-rubric";
import type { ShadowRuntimeFixture } from "../src/types";
import { compileWorldBible } from "../src/world-bible-compiler";

function setup() {
  const paths = openovelPaths();
  const fixture = JSON.parse(readFileSync(paths.fixturePath, "utf8")) as ShadowRuntimeFixture;
  const evidencePackage = compileEvidencePackage(paths.repoRoot);
  const worldBible = compileWorldBible(paths.repoRoot, evidencePackage);
  const context = compileShadowContext(fixture, evidencePackage, worldBible);
  return { paths, fixture, evidencePackage, worldBible, context };
}

function validBaseOutput() {
  const body = [
    "书记收住笔锋以后，巡抚没有立刻接话。他望了一眼仍摊在案角的放行文书，又看向簿册上的新墨，拱起的双手并未放下。更漏声隔着窗纸传进来，他先问书记，方才总督暂缓落印的意思是否已经逐字入册。书记翻过笔锋，指明纸上只记了当面所见和所闻，没有替任何一方增减言辞。巡抚听完，才把目光转回案前。",
    "巡抚说，朝廷催办的压力不能只停在口头，总督既然要把文书压住，就应把由谁提出暂缓、由谁承担催办追问写清。他愿意当场说明地方执行所受的掣肘，也愿意让书记记录自己的答复，但不接受日后只留下巡抚催签、总督查问这一层表面文章。若这页记录要成为凭据，双方今日说过的话都应具名留痕，不能只让一方承担责任。",
    "书记依言在原有问答下面另起一行，先写下巡抚提出的具名条件，又将放行文书仍未落印的状态记在旁边。他没有替总督作答，只把纸面转正，让案前两人都能看清。巡抚没有催促落印，而是指着自己刚才那段答复，请书记连同朝廷催办这一层一并记下。原先只有巡抚催签、总督暂缓的局面，至此多了一份双方都无法轻易否认的责任记录。",
    "烛火照在簿册边缘，巡抚仍站在内厅，书记的笔也没有收回。放行文书与未启封的印泥都留在案上，谁都没有碰它们。纸面上已经出现巡抚提出的条件：催办理由可以继续说明，暂缓落印也可以继续维持，但责任不能只记在一边。巡抚把这项条件公开放到总督面前，书记则守着刚写下的文字，现场的主动权从单纯催签转成了谁先肯具名承担自己的决定。"
  ].join("\n\n");
  assert.ok(body.length >= 550 && body.length <= 850, String(body.length));
  return {
    schemaVersion: "openovel-shadow-turn-v3",
    resultType: "PUBLISHED_SHADOW_TURN",
    narration: {
      title: "责任入簿",
      body,
      endingState: {
        locationRef: "INSTITUTION-governor-office",
        presentEntityRefs: ["NPC-xunfu", "NPC-private-secretary"],
        visibleFacts: ["放行文书仍未落印。", "书记已把巡抚提出的具名责任条件写入簿册。"],
        unresolvedFacts: ["总督是否接受双方具名承担责任仍未确定。"],
        relationshipDelta: "巡抚把催签争议转成双方是否具名担责的公开交锋。",
        availableObjectRefs: ["RESOURCE-release-document", "RESOURCE-governor-seal", "RESOURCE-secretary-ledger"],
        affordances: [
          { affordanceId: "a1", actorRef: "NPC-xunfu", targetRef: "NPC-xunfu", actionClass: "responsibility", description: "要求巡抚先在簿册上具名承担催办责任。" },
          { affordanceId: "a2", actorRef: "NPC-private-secretary", targetRef: "NPC-private-secretary", actionClass: "evidence_control", description: "命书记封存当前问答记录并制作留底。" },
          { affordanceId: "a3", actorRef: "NPC-xunfu", targetRef: "RESOURCE-release-document", actionClass: "negotiation", description: "就具名条件与巡抚重新约定文书处置。" }
        ]
      }
    },
    decisions: [
      { decisionId: "d1", text: "让巡抚先在簿册上具名承担催办责任", decisionClass: "responsibility", basisAffordanceId: "a1", targetRefs: ["NPC-xunfu", "RESOURCE-secretary-ledger"] },
      { decisionId: "d2", text: "封存书记的问答记录并另制一份留底", decisionClass: "evidence_control", basisAffordanceId: "a2", targetRefs: ["NPC-private-secretary", "RESOURCE-secretary-ledger"] },
      { decisionId: "d3", text: "回应巡抚的具名条件并重新约定文书处置", decisionClass: "negotiation", basisAffordanceId: "a3", targetRefs: ["NPC-xunfu", "RESOURCE-release-document"] }
    ]
  };
}

function writerV4From(output: ReturnType<typeof validBaseOutput>) {
  return {
    schemaVersion: "openovel-shadow-writer-v4",
    resultType: "PUBLISHED_SHADOW_TURN",
    narration: {
      title: output.narration.title,
      body: output.narration.body,
      endingState: {
        visibleFacts: output.narration.endingState.visibleFacts,
        unresolvedFacts: output.narration.endingState.unresolvedFacts,
        relationshipDelta: output.narration.endingState.relationshipDelta
      }
    },
    decisions: output.decisions.map((decision) => ({ text: decision.text }))
  };
}

function validLandWriterV5() {
  const body = [
    "巡抚抬眼看向案上未落印的放行文书，拱着的双手没有放下。他对总督道：“调册经手，我愿在簿册中记明；但文书继续不落印，这份责任应由总督承担。两件事各归一处，日后才说得清。”",
    "巡抚抬手指向书记面前的簿册：“朝廷正在催办，调册与暂缓若只记作一件事，问责时便会含混。下官愿担经手之责，也请总督把暂缓之责一并留在记录里。”他说完收回手，仍立在案前。",
    "书记依照先前的记录命令落笔，将巡抚的话逐字写下：巡抚自陈愿担调册经手之责，并请总督承担暂缓落印之责。写完最后一笔，他把笔搁在簿册旁，又将册页转向案中，让这项尚未获总督接受的分责主张露在灯下。",
    "巡抚的视线在刚写成的两行字上停了一瞬，随后重新望向总督，没有再催促。墨迹仍亮，书记守在簿册旁，巡抚与总督之间的分责条件已经留在纸上。各县册据尚未送达，核对没有开始，案上的放行文书也仍未落印。"
  ].join("\n\n");
  assert.ok(body.length >= 320 && body.length <= 550, String(body.length));
  return {
    schemaVersion: "openovel-shadow-writer-v5",
    resultType: "PUBLISHED_SHADOW_TURN",
    narration: {
      title: "分责留痕",
      body,
      endingState: {
        visibleFacts: [
          "巡抚提出将调册经手与暂缓落印分别归责。",
          "书记已经把巡抚的分责主张以尚未获总督接受的状态写入现有簿册。",
          "放行文书仍未落印。"
        ],
        unresolvedFacts: ["总督是否接受巡抚提出的分责条件。", "两类册据是否一致。"],
        relationshipDelta: "巡抚把配合调册变成一项公开留痕但尚未生效的责任条件。"
      }
    },
    eventDrafts: [
      { eventType: "NPC_RESPONSIBILITY_CONDITION_PROPOSED" },
      { eventType: "NPC_RESPONSIBILITY_PROPOSAL_RECORDED" }
    ],
    decisions: [
      { text: "接受巡抚的分责条件" },
      { text: "提出督抚共同承担暂缓落印责任" },
      { text: "直接在放行文书上落印" }
    ]
  };
}

function approvedSelectedFixture(base: ShadowRuntimeFixture) {
  const firstPrior = {
    artifactId: "shadow-turn-prior-v3-test",
    provider: { providerCallCount: 1, responseStatus: 200 },
    gates: { shadowOnly: true, playerTrafficAffected: false, databaseTouched: false },
    validation: { ok: true, output: validBaseOutput(), issues: [] }
  };
  const selected = buildSelectedDecisionFixture(base, firstPrior, "d1");
  return {
    artifactId: "shadow-turn-approved-selected-v3-test",
    provider: { providerCallCount: 1, responseStatus: 200 },
    gates: { shadowOnly: true, playerTrafficAffected: false, databaseTouched: false },
    fixtureSnapshot: selected,
    userReview: { status: "APPROVED" as const, reviewedAt: "2026-07-22T03:00:00.000Z" },
    validation: { ok: true, output: validBaseOutput(), issues: [] }
  };
}

test("compiles a semantic Writer Context while keeping validation policy and grounding server-side", () => {
  const { fixture, context } = setup();
  assert.equal(context.schemaVersion, "openovel_context_packet_v2");
  assert.equal(context.soloTakeoverEligible, false);
  assert.equal(context.playerActionLast, true);
  assert.ok(context.excludedEvidenceClaimIds.some((item) => item.claimId === "DM1566-C03-CL002" && item.reason === "FUTURE_CUTOFF"));
  assert.ok(context.allowedReferences.evidenceClaimIds.includes("DM1566-C01-CL003"), "runtime-fact source claim closure must be allowed");
  for (const term of fixture.forbiddenDisclosures) assert.equal(context.renderedWriterWorkingSet.includes(term), false, term);
  for (const heading of [
    "【RECENT_CANON】",
    "【CURRENT_SCENE】",
    "【ACTION_ALREADY_OCCURRED】",
    "【CONFIRMED_EFFECTS】",
    "【UNRESOLVED】",
    "【NPC_AGENDA】",
    "【DRAMATIC_TASK】",
    "【REQUIRED_END_CHANGE】",
    "【NARRATIVE_CEILING】",
    "【AVAILABLE_REFS】",
    "【DECISION_AFFORDANCES】",
    "【NARRATIVE_BUDGET】",
    "【PLAYER_ACTION】"
  ]) assert.match(context.renderedWriterWorkingSet, new RegExp(heading));
  assert.doesNotMatch(context.renderedWriterWorkingSet, /validationPatterns|stateLockAssertions|STATE_LOCKS_JSON|firstParagraphOnly|ACTION_RESTAGED_|UNCONFIRMED_/);
  assert.equal(context.minimalCanonEntryIds.length, 1);
  assert.ok(context.serverGrounding.evidenceClaimIds.length > 0);
  assert.ok(context.renderedWriterWorkingSet.endsWith(fixture.playerIntent.userFacingText));
  assert.doesNotMatch(context.renderedWriterWorkingSet, /巡抚听到了调取命令并作出现场回应/);
});

test("fails closed rather than trimming required context or the player action", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const impossible = structuredClone(fixture);
  impossible.maxTokenEstimate = 1000;
  assert.throws(() => compileShadowContext(impossible, evidencePackage, worldBible), /P0_(?:CONTEXT|WRITER_CONTEXT)_BUDGET_EXCEEDED/);
});

test("keeps the latest NPC beat in Canon without an earlier player speech from the same paragraph", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const withTwoSpeakers = structuredClone(fixture);
  withTwoSpeakers.recentCanon = [{
    entryId: "canon-two-speakers",
    chronologicalOrder: 1,
    narrative: "\u603b\u7763\u9053\uff1a\u201c\u5148\u67e5\u7cae\u7530\u3002\u201d\u5de1\u629a\u62f1\u624b\u9053\uff1a\u201c\u6211\u4f1a\u914d\u5408\u6838\u67e5\u3002\u201d\u4e66\u8bb0\u5c06\u5de1\u629a\u7684\u7b54\u590d\u8bb0\u5165\u7c3f\u518c\u3002"
  }];
  const context = compileShadowContext(withTwoSpeakers, evidencePackage, worldBible);
  const canon = context.renderedWriterWorkingSet.split("【RECENT_CANON】")[1]!.split("【CURRENT_SCENE】")[0]!;
  assert.doesNotMatch(canon, /\u603b\u7763\u9053/);
  assert.match(canon, /\u5de1\u629a\u62f1\u624b\u9053/);
  assert.match(canon, /\u4e66\u8bb0\u5c06\u5de1\u629a\u7684\u7b54\u590d\u8bb0\u5165\u7c3f\u518c/);
});

test("produces a reproducible old-versus-shadow comparison without publishing", () => {
  const { paths } = setup();
  const result = compareContexts(paths.repoRoot);
  assert.equal(result.report.gates.playerTrafficAffected, false);
  assert.equal(result.report.gates.soloTakeoverEligible, false);
  assert.equal(result.report.shadow.playerActionLast, true);
  assert.equal(result.report.shadow.sourceClaimCitationCount, 0);
  assert.ok(result.report.shadow.auditSourceClaimCitationCount > 0);
  assert.equal(result.report.shadow.validationPolicyLeakCount, 0);
  assert.equal(result.report.shadow.presetDecisionAnswerCount, 0);
  assert.equal(result.report.shadow.minimalCanonEntryCount, 1);
  assert.ok(result.report.shadow.serverGroundingClaimCount > 0);
  assert.ok(result.report.shadow.causalArcCount > 0);
  assert.ok(result.report.shadow.npcReactionEnvelopeCount > 0);
  assert.ok(result.report.shadow.decisionAffordanceCount >= 3);
  assert.equal(result.report.shadow.deterministicMaterialChange, true);
  assert.deepEqual(result.report.shadow.forbiddenDisclosureMatches, []);
});

test("builds a compact v6 Writer prompt with route-keyed decisions but without server-owned metadata or answer hints", () => {
  const { fixture, context } = setup();
  const prompt = buildShadowTurnPrompt(context, fixture);
  const schema = prompt.outputSchema as any;
  assert.equal(schema.properties.schemaVersion.const, "openovel-shadow-writer-v6");
  assert.equal(schema.properties.narration.properties.body.minLength, context.narrativeBudget.minChars);
  assert.equal(schema.properties.narration.properties.body.maxLength, context.narrativeBudget.maxChars);
  assert.equal(Object.prototype.hasOwnProperty.call(schema.properties.narration.properties.endingState.properties, "affordances"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(schema.properties.narration.properties.endingState.properties, "locationRef"), false);
  assert.equal(schema.properties.decisions.type, "object");
  assert.deepEqual(schema.properties.decisions.required, ["decision1", "decision2", "decision3"]);
  assert.deepEqual(Object.keys(schema.properties.decisions.properties), ["decision1", "decision2", "decision3"]);
  assert.deepEqual(Object.keys(schema.properties.decisions.properties.decision1.properties), ["text"]);
  assert.match(schema.properties.narration.properties.endingState.properties.relationshipDelta.description, /责任条件仍未生效/);
  assert.deepEqual(Object.keys(schema.properties.eventDrafts.items.properties), ["eventType"]);
  assert.equal(Object.prototype.hasOwnProperty.call(schema.properties, "grounding"), false);
  assert.match(prompt.systemPrompt, /Grounding 均由服务器绑定/);
  assert.match(prompt.systemPrompt, /DECISION_AFFORDANCES/);
  assert.match(prompt.systemPrompt, /按 DECISION_AFFORDANCES 的编号一一对应/);
  assert.match(prompt.systemPrompt, /首段直接写主要 NPC 的新反应/);
  assert.match(prompt.systemPrompt, /记录 NPC 的主张不等于玩家接受/);
  assert.match(prompt.systemPrompt, /提议、记录、接受和履行是不同状态/);
  assert.doesNotMatch(prompt.systemPrompt, /第一句由主要 NPC/);
  assert.match(prompt.userPrompt, /【OUTPUT_SCHEMA】/);
  assert.doesNotMatch(prompt.userPrompt, /【FACT_BOUNDARY】|【FIRST_NEW_BEAT】|【TURN_BEATS】|【ALLOWED_EVENT_ENVELOPE】/);
  assert.match(prompt.userPrompt, /【DECISION_AFFORDANCES】/);
  assert.match(prompt.userPrompt, /【NARRATIVE_BUDGET】/);
  assert.ok(prompt.userPrompt.endsWith(`【PLAYER_ACTION】\n${fixture.playerIntent.userFacingText}`));
  assert.ok(prompt.systemPrompt.length < 1100, `system prompt is ${prompt.systemPrompt.length} chars`);
  assert.ok(prompt.userPrompt.length < 6000, `user prompt is ${prompt.userPrompt.length} chars`);
  assert.ok(JSON.stringify(schema).length < 2600, `output schema is ${JSON.stringify(schema).length} chars`);
  assert.doesNotMatch(prompt.systemPrompt + prompt.userPrompt, /actorRef|targetRefs|affordanceId|decisionClass|basisAffordanceId/);
  assert.doesNotMatch(prompt.systemPrompt + prompt.userPrompt, /validationPatterns|STATE_LOCKS_JSON|firstParagraphOnly|ACTION_RESTAGED_|错误代码|错误示例/);
  assert.doesNotMatch(prompt.systemPrompt + prompt.userPrompt, /第1段|每段160|在簿册上具名接受巡抚的分责条件|划去簿册上巡抚的条件记录|立即落印放行文书|不发明文书内容或期限/);
});

test("binds v4 Writer prose to server-owned decision metadata without changing player-facing text", () => {
  const { fixture, context } = setup();
  const boundFixture = structuredClone(fixture);
  boundFixture.writerPlan = {
    decisionEntrances: [
      { actionClass: "responsibility", targetRefs: ["NPC-xunfu"], situation: "处理巡抚提出的具名责任条件" },
      { actionClass: "evidence_control", targetRefs: ["NPC-private-secretary"], situation: "处理书记手中的现有问答记录" },
      { actionClass: "negotiation", targetRefs: ["NPC-xunfu"], situation: "与巡抚重新约定文书处置条件" }
    ]
  } as any;
  const writer = writerV4From(validBaseOutput());
  const raw = JSON.stringify(writer);
  const checked = parseAndValidateShadowOutput(raw, context, boundFixture);
  assert.equal(checked.ok, true, checked.ok ? "" : JSON.stringify(checked.issues));
  if (!checked.ok) throw new Error("expected v4 binding to pass");
  assert.deepEqual(checked.output.decisions.map((decision) => decision.text), writer.decisions.map((decision) => decision.text));
  assert.deepEqual(checked.output.decisions.map((decision) => decision.decisionId), ["d1", "d2", "d3"]);
  assert.ok(checked.output.narration.endingState.affordances.every((item) => item.actorRef === fixture.role.characterId));
  assert.equal(checked.output.grounding.binding, "SERVER_COMPILED");
  const normalized = normalizeAndValidateShadowOutput(raw, context, boundFixture);
  assert.equal(normalized.normalizedText, raw);
  assert.deepEqual(normalized.normalization, { kind: "SERVER_METADATA_BINDING", playerFacingTextModified: false });
});

test("accepts a grounded v3 turn and rejects legacy schema, replay, leakage, and weak decisions", () => {
  const { fixture, context } = setup();
  const valid = validBaseOutput();
  const checked = parseAndValidateShadowOutput(JSON.stringify(valid), context, fixture);
  assert.equal(checked.ok, true, checked.ok ? "" : JSON.stringify(checked.issues));
  if (!checked.ok) throw new Error("expected valid output");
  assert.equal(checked.output.grounding.binding, "SERVER_COMPILED");
  assert.deepEqual(checked.output.grounding.usedEvidenceClaimIds, context.serverGrounding.evidenceClaimIds);
  assert.equal((checked.output as any).grounding.sourceMapHash, context.serverGrounding.sourceMapHash);

  const legacy = { ...structuredClone(valid), schemaVersion: "openovel-shadow-turn-v2" };
  const legacyChecked = parseAndValidateShadowOutput(JSON.stringify(legacy), context, fixture);
  assert.equal(legacyChecked.ok, false);
  if (legacyChecked.ok) throw new Error("expected legacy schema rejection");
  assert.ok(legacyChecked.issues.some((item) => item.code === "OUTPUT_SCHEMA_VERSION_INVALID"));

  const replay = structuredClone(valid);
  replay.narration.body = `${fixture.recentCanon[0]!.narrative}\n\n${replay.narration.body}`;
  const replayChecked = parseAndValidateShadowOutput(JSON.stringify(replay), context, fixture);
  assert.equal(replayChecked.ok, false);
  if (replayChecked.ok) throw new Error("expected canon replay rejection");
  assert.ok(replayChecked.issues.some((item) => item.code === "RECENT_CANON_REPLAY"));

  const leaked = structuredClone(valid);
  leaked.narration.endingState.visibleFacts.push("巡抚幕僚与商会存在账外往来。");
  const leakedChecked = parseAndValidateShadowOutput(JSON.stringify(leaked), context, fixture);
  assert.equal(leakedChecked.ok, false);
  if (leakedChecked.ok) throw new Error("expected secret rejection");
  assert.ok(leakedChecked.issues.some((item) => item.code === "FORBIDDEN_DISCLOSURE"));

  const forgedEnding = structuredClone(valid);
  forgedEnding.narration.body = forgedEnding.narration.body.replace(
    "书记依言在原有问答下面另起一行，先写下巡抚提出的具名条件，又将放行文书仍未落印的状态记在旁边。",
    "书记守着原有问答，没有替案前任何一方增添新的文字。放行文书仍未落印，仍在案上。"
  ).replaceAll("书记", "他");
  forgedEnding.narration.body = forgedEnding.narration.body.replaceAll("\u4e66\u8bb0", "\u4ed6");
  forgedEnding.narration.endingState.visibleFacts.push("\u4e66\u8bb0\u5df2\u7ecf\u628a\u5de1\u629a\u63d0\u51fa\u7684\u8d23\u4efb\u6761\u4ef6\u8bb0\u5165\u7c3f\u518c\u3002");
  const forgedEndingChecked = parseAndValidateShadowOutput(JSON.stringify(forgedEnding), context, fixture);
  assert.equal(forgedEndingChecked.ok, false);
  if (forgedEndingChecked.ok) throw new Error("expected ending-state grounding rejection");
  assert.ok(forgedEndingChecked.issues.some((item) => item.code === "ENDING_STATE_VISIBLE_FACT_UNGROUNDED"));

  const risk = structuredClone(valid) as any;
  risk.decisions[0].risk = "high";
  risk.decisions[1].text = "可能封存记录，否则巡抚会上报";
  risk.decisions[2].basisAffordanceId = "a1";
  const riskChecked = parseAndValidateShadowOutput(JSON.stringify(risk), context, fixture);
  assert.equal(riskChecked.ok, false);
  if (riskChecked.ok) throw new Error("expected weak decision rejection");
  assert.ok(riskChecked.issues.some((item) => item.code === "DECISION_PLAYER_FACING_SCHEMA_LEAK"));
  assert.ok(riskChecked.issues.some((item) => item.code === "DECISION_RISK_EXPOSED"));
  assert.ok(riskChecked.issues.some((item) => item.code === "DECISION_AFFORDANCE_REUSED"));
});

test("preserves provider prose byte-for-byte instead of injecting a missing sentence", () => {
  const { fixture, context } = setup();
  const raw = JSON.stringify(validBaseOutput());
  const result = normalizeAndValidateShadowOutput(raw, context, fixture);
  assert.equal(result.validation.ok, true, result.validation.ok ? "" : JSON.stringify(result.validation.issues));
  assert.equal(result.normalizedText, raw);
  assert.equal(result.normalization, null);
});

test("reports non-causal texture as a warning without rejecting an otherwise valid turn", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const textured = structuredClone(fixture);
  textured.currentStateExclusions.push({
    code: "TEXTURE_ONLY_TEST",
    description: "A non-causal texture detail is unconfirmed.",
    pattern: "SERVER_TEXTURE_MARKER",
    severity: "warning",
    factClass: "TEXTURE"
  });
  const context = compileShadowContext(textured, evidencePackage, worldBible);
  const output = validBaseOutput();
  output.narration.body = output.narration.body.replace("\n\n", " SERVER_TEXTURE_MARKER\n\n");
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, textured);
  assert.equal(checked.ok, true, checked.ok ? "" : JSON.stringify(checked.issues));
  assert.ok(checked.warnings.some((item) => item.code === "TEXTURE_ONLY_TEST"));
});

test("enforces the narrative budget compiled for the current scene", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const shortScene = structuredClone(fixture);
  shortScene.narrativeBudget = {
    kind: "short_confrontation",
    minChars: 100,
    maxChars: 120,
    minParagraphs: 3,
    maxParagraphs: 5
  };
  const context = compileShadowContext(shortScene, evidencePackage, worldBible);
  const checked = parseAndValidateShadowOutput(JSON.stringify(validBaseOutput()), context, shortScene);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected dynamic narrative budget rejection");
  assert.ok(checked.issues.some((item) => item.code === "NARRATIVE_LENGTH_INVALID"));
});

test("rejects prose that summarizes the available decisions for the player", () => {
  const { fixture, context } = setup();
  const output = validBaseOutput();
  output.narration.body = output.narration.body.replace(
    /\s*$/u,
    "\u662f\u63a5\u53d7\u5206\u8d23\u3001\u62d2\u7edd\u5206\u8d23\uff0c\u8fd8\u662f\u53e6\u4f5c\u5904\u7f6e\u3002"
  );
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, fixture);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected decision-summary rejection");
  assert.ok(checked.issues.some((item) => item.code === "NARRATIVE_DECISION_SUMMARY_LEAK"));
});

test("keeps an NPC conditional statement separate from confirmed world state", () => {
  const { fixture, context } = setup();
  const output = validBaseOutput();
  output.narration.body = output.narration.body.replace(
    "\n\n",
    " \u5de1\u629a\u9053\uff1a\u201c\u82e5\u671d\u5ef7\u8ffd\u95ee\uff0c\u6211\u4e5f\u53ea\u80fd\u4e0a\u62a5\u3002\u201d\n\n"
  );
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, fixture);
  assert.equal(checked.ok, true, checked.ok ? "" : JSON.stringify(checked.issues));
});

test("recognizes a completed secretary record carried into the next sentence by a pronoun", () => {
  const completed = "\u4e66\u8bb0\u95fb\u8a00\uff0c\u7b14\u5c16\u60ac\u505c\uff0c\u76ee\u5149\u671b\u5411\u603b\u7763\u3002\u89c1\u603b\u7763\u672a\u4f5c\u963b\u62e6\uff0c\u4ed6\u4fbf\u860d\u58a8\u843d\u7b14\uff0c\u5c06\u5de1\u629a\u7684\u539f\u8bdd\u9010\u5b57\u8bb0\u5165\u7c3f\u518c\u3002";
  const pending = "\u4e66\u8bb0\u7b14\u5c16\u60ac\u5728\u7eb8\u4e0a\uff0c\u7b49\u5f85\u603b\u7763\u793a\u4e0b\u540e\u518d\u8bb0\u5165\u7c3f\u518c\u3002";
  const requested = "\u5de1\u629a\u8bf7\u4e66\u8bb0\u628a\u8fd9\u9879\u6761\u4ef6\u8bb0\u5165\u7c3f\u518c\u3002";
  assert.equal(hasCompletedSecretaryRecord(completed), true);
  assert.equal(hasCompletedSecretaryRecord(pending), false);
  assert.equal(hasCompletedSecretaryRecord(requested), false);
});

test("builds the land-record turn with a minimum Canon tail, semantic bounds, and no preset decisions", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const context = compileShadowContext(land, evidencePackage, worldBible);
  const prompt = buildShadowTurnPrompt(context, land);
  assert.equal(land.fixtureId, "sangtian-governor-shadow-turn-003-land-records");
  assert.equal(land.actionBoundary.stage, "ACTION_ALREADY_LANDED");
  assert.equal(land.stateLocks.registers.anyRegistersPrepared, "unknown");
  assert.equal(land.stateLocks.registers.anyRegistersInTransit, false);
  assert.match(context.renderedWriterWorkingSet, /【NPC_AGENDA】/);
  assert.match(context.renderedWriterWorkingSet, /【RECENT_CANON】[\s\S]*随后总督已经作出调册决定/);
  assert.doesNotMatch(context.renderedWriterWorkingSet, /书记的笔搁在簿册旁，墨迹未干/);
  assert.match(context.renderedWriterWorkingSet, /可采取方式：转移或分担责任；协商条件/);
  assert.match(context.renderedWriterWorkingSet, /【DRAMATIC_TASK】[\s\S]*巡抚借朝廷催办形成的压力回应总督/);
  assert.match(context.renderedWriterWorkingSet, /【SCENE_BLOCKING】[\s\S]*不写总督回应、默许、阻拦或其他反应/);
  assert.match(context.renderedWriterWorkingSet, /巡抚只提出分责主张，不承诺调册何时启动、行文或送册/);
  assert.match(context.renderedWriterWorkingSet, /合拢的印泥盒保持原位/);
  assert.match(context.renderedWriterWorkingSet, /【SCENE_BEATS】[\s\S]*巡抚表明自己愿意承担调册经手责任[\s\S]*请总督承担暂缓落印之责/);
  assert.match(context.renderedWriterWorkingSet, /【REQUIRED_END_CHANGE】[\s\S]*以巡抚陈述的身份写入现有簿册[\s\S]*尚未形成双方承诺/);
  assert.match(context.renderedWriterWorkingSet, /【NARRATIVE_CEILING】[\s\S]*放行文书维持未落印/);
  assert.doesNotMatch(context.renderedWriterWorkingSet, /【FIRST_NEW_BEAT】|【TURN_BEATS】|【ALLOWED_EVENT_ENVELOPE】|禁止结果：/);
  assert.doesNotMatch(context.renderedWriterWorkingSet, /巡抚必须主动回应已经落地的调册命令/);
  assert.match(context.renderedWriterWorkingSet, /两类册据是否已经编成、由谁保管、是否已经送出均不能确认/);
  assert.doesNotMatch(context.renderedWriterWorkingSet, /巡抚听到了调取命令并作出现场回应/);
  assert.match(context.renderedWriterWorkingSet, /责任承担｜对象：巡抚｜当前局面：巡抚提出的分责条件尚未生效，总督可以作出责任承诺/);
  assert.match(context.renderedWriterWorkingSet, /条件协商｜对象：巡抚｜当前局面：暂缓落印的责任分配仍可由督抚重新协商/);
  assert.match(context.renderedWriterWorkingSet, /行政处置｜对象：放行文书、总督印｜当前局面：总督可以直接改变放行文书未落印的状态/);
  assert.match(context.renderedWriterWorkingSet, /措辞骨架：接受＋分责条件的单一动宾短语，不用逗号/);
  assert.match(context.renderedWriterWorkingSet, /措辞骨架：重议＋暂缓落印责任的单一动宾短语，不用逗号/);
  assert.match(context.renderedWriterWorkingSet, /措辞骨架：落印＋放行文书的单一动宾短语，不用逗号/);
  assert.match(context.renderedWriterWorkingSet, /书记已经受命持续记录本轮现场问答/);
  assert.match(context.renderedWriterWorkingSet, /记录不代表总督接受，也不会使拟议责任自动成立/);
  assert.doesNotMatch(context.renderedWriterWorkingSet, /actionClass|targetRefs|actorRef|affordanceId/);
  assert.equal(context.allowedReferences.entityRefs.includes("FRAME-review-procedure"), false);
  assert.equal(land.narrativeFrame.decisionPolicy.allowedClasses.includes("scope_change"), false);
  assert.ok(land.resources.includes("现有书记簿册"));
  assert.equal(land.resources.some((item) => item.includes("密信")), false);
  assert.equal(land.decisionAccess.availableObjectRefs.includes("EVIDENCE-county-land-records"), false);
  assert.doesNotMatch(prompt.userPrompt, /按县逐册比对原粮册和改桑申报册，标出田亩与户主不一致的记录/);
  assert.doesNotMatch(prompt.userPrompt, /先抽查部分县的原粮册和申报册，确认常见差异后再扩大核查/);
  assert.ok(prompt.userPrompt.endsWith(`【PLAYER_ACTION】\n${land.playerIntent.userFacingText}`));
  assert.equal(context.narrativeBudget.kind, "short_confrontation");
  assert.deepEqual(context.narrativeBudget, { kind: "short_confrontation", minChars: 300, maxChars: 550, minParagraphs: 3, maxParagraphs: 4 });
  assert.equal(context.minimalCanonEntryIds.length, 1);
  assert.equal(
    context.renderedWriterWorkingSet.split("【RECENT_CANON】")[1]!.split("【CURRENT_SCENE】")[0]!.trim().split(/\n\s*\n/u).length,
    1
  );
  assert.doesNotMatch(context.renderedWriterWorkingSet.split("【RECENT_CANON】")[1]!.split("【CURRENT_SCENE】")[0]!, /我会让各县报明|原册一并送来/);
  assert.deepEqual(context.serverGrounding.runtimeFactIds, ["fact_imperial_reform_order", "fact_grain_pressure"]);
  assert.doesNotMatch(prompt.systemPrompt + prompt.userPrompt, /validationPatterns|STATE_LOCKS_JSON|ACTION_RESTAGED_|第1段|每段160|d1 只能使用 a1|FIRST_NEW_BEAT|TURN_BEATS|禁止结果：/);
  assert.doesNotMatch(prompt.systemPrompt + prompt.userPrompt, /在簿册上具名接受巡抚的分责条件|划去簿册上巡抚的条件记录|立即落印放行文书/);
  assert.doesNotMatch(prompt.userPrompt, /决定是否接受由总督承担暂缓落印责任的条件|提出由督抚共同承担暂缓落印责任的替代条件|直接在仍未落印的放行文书上落印/);
  assert.doesNotMatch(land.npcActionPolicies["NPC-xunfu"]!.publicPosition, /无限期/);
});

test("compiles deterministic causal effects, NPC envelopes, event limits, affordances, and stagnation state", () => {
  const { fixture } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const causal = compileCausalTurn(land);
  const reform = causal.arcsAfter.find((arc) => arc.arcId === "ARC-reform-grain-conflict");
  const responsibility = causal.arcsAfter.find((arc) => arc.arcId === "ARC-governor-xunfu-responsibility");
  assert.equal(reform?.state.courtPressure, 53);
  assert.equal(responsibility?.stage, "PRESSURED");
  assert.equal(responsibility?.state.tension, 24);
  assert.equal(causal.deterministicMaterialChange.anyMaterialChange, true);
  assert.equal(causal.deterministicMaterialChange.arcChanged, true);
  assert.equal(causal.deterministicMaterialChange.relationshipChanged, true);
  assert.deepEqual(causal.allowedEventEnvelope.requiredEventTypes, ["NPC_RESPONSIBILITY_CONDITION_PROPOSED", "NPC_RESPONSIBILITY_PROPOSAL_RECORDED"]);
  assert.equal(causal.allowedEventEnvelope.maxEventDrafts, 2);
  assert.deepEqual(causal.decisionAffordances.map((item) => item.affordanceId), [
    "AF-respond-responsibility",
    "AF-negotiate-xunfu",
    "AF-seal-release-document"
  ]);
  assert.equal(causal.npcReactionEnvelopes[0]?.knownFacts.some((fact) => fact.includes("期限")), false);
  assert.equal(causal.npcReactionEnvelopes[0]?.unknownFacts.some((fact) => fact.includes("期限")), true);
  assert.equal(causal.stagnationReports.every((report) => report.shouldForceProgression === false), true);
  assert.equal(causal.snapshotHash.length, 64);
  assert.equal(causal.affordanceSnapshotHash.length, 64);
  assert.equal(causal.allowedEventEnvelopeHash.length, 64);

  const stagnant = structuredClone(land);
  stagnant.causalRuntime!.rules = [];
  stagnant.causalRuntime!.stagnationHistory.turnsWithoutMaterialChange = 1;
  const stagnantCausal = compileCausalTurn(stagnant);
  assert.equal(stagnantCausal.deterministicMaterialChange.anyMaterialChange, false);
  assert.equal(stagnantCausal.stagnationReports.every((report) => report.shouldForceProgression), true);
});

test("binds a v5 causal Writer turn and rejects event drafts that do not match the narration", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const context = compileShadowContext(land, evidencePackage, worldBible);
  const writer = validLandWriterV5();
  const writerV6 = {
    ...structuredClone(writer),
    schemaVersion: "openovel-shadow-writer-v6",
    decisions: {
      decision1: structuredClone(writer.decisions[0]),
      decision2: structuredClone(writer.decisions[1]),
      decision3: structuredClone(writer.decisions[2])
    }
  };
  const v6Checked = parseAndValidateShadowOutput(JSON.stringify(writerV6), context, land);
  assert.equal(v6Checked.ok, true, v6Checked.ok ? "" : JSON.stringify(v6Checked.issues));
  if (!v6Checked.ok) throw new Error("expected v6 route-keyed output to pass");
  assert.deepEqual(v6Checked.output.decisions.map((decision) => decision.basisAffordanceId), [
    "AF-respond-responsibility",
    "AF-negotiate-xunfu",
    "AF-seal-release-document"
  ]);
  const naturalV6Decisions = structuredClone(writerV6);
  naturalV6Decisions.decisions.decision1.text = "承诺承担暂缓落印之责";
  naturalV6Decisions.decisions.decision2.text = "提议暂缓落印责任各担一半";
  naturalV6Decisions.decisions.decision3.text = "当场在放行文书上落总督印";
  const naturalV6Checked = parseAndValidateShadowOutput(JSON.stringify(naturalV6Decisions), context, land);
  assert.equal(naturalV6Checked.ok, true, naturalV6Checked.ok ? "" : JSON.stringify(naturalV6Checked.issues));
  const skeletonV6Decisions = structuredClone(writerV6);
  skeletonV6Decisions.decisions.decision1.text = "接受分责条件";
  skeletonV6Decisions.decisions.decision2.text = "重议暂缓落印责任";
  skeletonV6Decisions.decisions.decision3.text = "落印放行文书";
  const skeletonV6Checked = parseAndValidateShadowOutput(JSON.stringify(skeletonV6Decisions), context, land);
  assert.equal(skeletonV6Checked.ok, true, skeletonV6Checked.ok ? "" : JSON.stringify(skeletonV6Checked.issues));
  const actualizedProposal = structuredClone(writerV6);
  actualizedProposal.narration.body = actualizedProposal.narration.body.replace(
    "巡抚自陈愿担调册经手之责，并请总督承担暂缓落印之责",
    "巡抚承担调册经手之责；总督承担暂缓落印之责"
  );
  actualizedProposal.narration.endingState.visibleFacts[1] = "书记已在簿册写明总督承担暂缓落印之责。";
  const actualizedProposalChecked = parseAndValidateShadowOutput(JSON.stringify(actualizedProposal), context, land);
  assert.equal(actualizedProposalChecked.ok, false);
  if (actualizedProposalChecked.ok) throw new Error("expected unaccepted proposal actualization rejection");
  assert.ok(actualizedProposalChecked.issues.some((item) => item.code === "UNACCEPTED_NPC_PROPOSAL_ACTUALIZED"));
  assert.equal(buildShadowQualityRubric(actualizedProposalChecked, land).criteria.factDiscipline.passed, false);
  const raw = JSON.stringify(writer);
  const checked = parseAndValidateShadowOutput(raw, context, land);
  assert.equal(checked.ok, true, checked.ok ? "" : JSON.stringify(checked.issues));
  if (!checked.ok) throw new Error("expected v5 causal output to pass");
  assert.deepEqual(checked.output.eventDrafts.map((event) => event.eventType), ["NPC_RESPONSIBILITY_CONDITION_PROPOSED", "NPC_RESPONSIBILITY_PROPOSAL_RECORDED"]);
  assert.equal(checked.output.eventDrafts[1]?.status, "RECORDED_NOT_ACCEPTED");
  assert.equal(checked.output.eventDrafts.every((event) => event.actorRefs.length > 0 && event.targetRefs.length > 0), true);
  assert.equal(checked.output.materialChange.anyMaterialChange, true);
  assert.equal(checked.output.materialChange.responsibilityChanged, false);
  const proposalWordingEnding = structuredClone(writer);
  proposalWordingEnding.narration.endingState.visibleFacts[1] = "书记已将巡抚的主张以巡抚自陈和请求的身份写入现有簿册。";
  const proposalWordingEndingChecked = parseAndValidateShadowOutput(JSON.stringify(proposalWordingEnding), context, land);
  assert.equal(proposalWordingEndingChecked.ok, true, proposalWordingEndingChecked.ok ? "" : JSON.stringify(proposalWordingEndingChecked.issues));
  assert.deepEqual(checked.output.decisions.map((decision) => decision.basisAffordanceId), [
    "AF-respond-responsibility",
    "AF-negotiate-xunfu",
    "AF-seal-release-document"
  ]);
  assert.equal(checked.output.grounding.usedCausalArcIds.length, 2);
  const rubric = buildShadowQualityRubric(checked, land);
  assert.equal(rubric.overallPassed, true);
  assert.equal(Object.values(rubric.criteria).every((criterion) => criterion.passed), true);
  const normalized = normalizeAndValidateShadowOutput(raw, context, land);
  assert.equal(normalized.normalizedText, raw);
  assert.deepEqual(normalized.normalization, { kind: "SERVER_METADATA_BINDING", playerFacingTextModified: false });

  const equivalentSealWording = structuredClone(writer);
  equivalentSealWording.narration.body = equivalentSealWording.narration.body.replace("放行文书也仍未落印", "放行文书也依旧未落印");
  assert.match(equivalentSealWording.narration.body, /放行文书也依旧未落印/);
  const equivalentSealChecked = parseAndValidateShadowOutput(JSON.stringify(equivalentSealWording), context, land);
  assert.equal(equivalentSealChecked.ok, true, equivalentSealChecked.ok ? "" : JSON.stringify(equivalentSealChecked.issues));

  const reorderedEndingRecord = structuredClone(writer);
  reorderedEndingRecord.narration.endingState.visibleFacts[1] = "巡抚的条件已由书记写入现有簿册。";
  const reorderedEndingRecordChecked = parseAndValidateShadowOutput(JSON.stringify(reorderedEndingRecord), context, land);
  assert.equal(reorderedEndingRecordChecked.ok, true, reorderedEndingRecordChecked.ok ? "" : JSON.stringify(reorderedEndingRecordChecked.issues));

  const conciseUnresolvedState = structuredClone(writer);
  conciseUnresolvedState.narration.body = conciseUnresolvedState.narration.body.replace("各县册据尚未送达，核对没有开始", "册据未到，核对未始，巡抚仍在案前，书记仍守着簿册");
  const conciseUnresolvedStateChecked = parseAndValidateShadowOutput(JSON.stringify(conciseUnresolvedState), context, land);
  assert.equal(conciseUnresolvedStateChecked.ok, true, conciseUnresolvedStateChecked.ok ? "" : JSON.stringify(conciseUnresolvedStateChecked.issues));

  const relationshipForecast = structuredClone(writer);
  relationshipForecast.narration.endingState.relationshipDelta = "督抚责任分歧已公开，总督若拒绝则需另提方案。";
  const relationshipForecastChecked = parseAndValidateShadowOutput(JSON.stringify(relationshipForecast), context, land);
  assert.equal(relationshipForecastChecked.ok, false);
  if (relationshipForecastChecked.ok) throw new Error("expected ending-state relationship forecast rejection");
  assert.ok(relationshipForecastChecked.issues.some((item) => item.code === "ENDING_STATE_RELATIONSHIP_FORECAST"));

  const compoundDecision = structuredClone(writer);
  compoundDecision.decisions[0]!.text = "接受巡抚的分责条件，明确暂缓落印由总督承担";
  const compoundDecisionChecked = parseAndValidateShadowOutput(JSON.stringify(compoundDecision), context, land);
  assert.equal(compoundDecisionChecked.ok, false);
  if (compoundDecisionChecked.ok) throw new Error("expected explanatory second predicate rejection");
  assert.ok(compoundDecisionChecked.issues.some((item) => item.code === "DECISION_MULTIPLE_ACTIONS"));

  const liveCompoundDecisions = structuredClone(writer);
  liveCompoundDecisions.decisions[0]!.text = "接受巡抚的分责条件，承担暂缓落印之责";
  liveCompoundDecisions.decisions[1]!.text = "拒绝巡抚的分责条件，要求巡抚共同承担暂缓落印之责";
  const liveCompoundDecisionsChecked = parseAndValidateShadowOutput(JSON.stringify(liveCompoundDecisions), context, land);
  assert.equal(liveCompoundDecisionsChecked.ok, false);
  if (liveCompoundDecisionsChecked.ok) throw new Error("expected live compound decisions to be rejected");
  assert.equal(liveCompoundDecisionsChecked.issues.filter((item) => item.code === "DECISION_MULTIPLE_ACTIONS").length, 2);

  const npcGoalContradiction = structuredClone(writer);
  npcGoalContradiction.narration.endingState.visibleFacts[0] = "巡抚提出调册经手由自己督办、暂缓落印责任也由自己承担的条件。";
  const npcGoalContradictionChecked = parseAndValidateShadowOutput(JSON.stringify(npcGoalContradiction), context, land);
  assert.equal(npcGoalContradictionChecked.ok, false);
  if (npcGoalContradictionChecked.ok) throw new Error("expected NPC goal contradiction rejection");
  assert.ok(npcGoalContradictionChecked.issues.some((item) => item.code === "FRAME_XUNFU_GOAL_CONTRADICTION"));

  const fourthLiveAttempt = structuredClone(writer);
  fourthLiveAttempt.narration.body = [
    "巡抚拱手道：“调册经手，下官自当承担；但暂缓落印之责，须由总督大人担负。”他语气平稳，目光落在案上未落印的放行文书上。书记笔尖一顿，随即在簿册上逐字写下巡抚的条件。烛火将三人的影子投在墙上，更漏声清晰可闻。",
    "巡抚续道：“朝廷催办在即，若无人担此暂缓之责，日后追论起来，下官恐难独任其咎。”他并未提及任何文书期限，只以朝廷压力为凭。书记的笔尖在纸上沙沙作响，将“巡抚承担调册经手，暂缓落印由总督承担”这一条件完整录入。",
    "书记写完最后一笔，搁笔抬头，目光在总督与巡抚之间扫过。案上放行文书仍静静躺着，未沾朱砂。簿册中新添的记录墨迹未干，成为现场唯一新增的责任凭证。巡抚拱手而立，等待总督回应。",
    "厅内一时寂静，只有烛火偶尔爆出灯花。巡抚的条件已明确写入簿册，但尚未生效——它需要总督的认可或反驳。未落印的文书与刚记录的条件，构成此刻责任格局的两端。"
  ].join("\n\n");
  fourthLiveAttempt.narration.endingState.visibleFacts = [
    "巡抚提出分责条件：调册经手由巡抚承担，暂缓落印由总督承担",
    "书记已将巡抚的条件完整写入现有簿册",
    "放行文书仍未落印"
  ];
  const fourthLiveChecked = parseAndValidateShadowOutput(JSON.stringify(fourthLiveAttempt), context, land);
  assert.equal(fourthLiveChecked.ok, false);
  if (fourthLiveChecked.ok) throw new Error("expected fourth live attempt's narrative leaks to be rejected");
  assert.ok(fourthLiveChecked.issues.some((item) => item.code === "NARRATIVE_RULE_COMPLIANCE_LEAK"));
  assert.ok(fourthLiveChecked.issues.some((item) => item.code === "NARRATIVE_EXPLANATORY_ENDING"));
  assert.equal(fourthLiveChecked.issues.some((item) => item.code === "FRAME_XUNFU_GOAL_CONTRADICTION"), false);

  const manualAuditLeak = structuredClone(writer);
  manualAuditLeak.narration.body = manualAuditLeak.narration.body.replace(
    `巡抚抬眼看向案上未落印的放行文书，拱着的双手没有放下。他对总督道：“`,
    `巡抚拱手道：“大人调册核对，`
  );
  manualAuditLeak.decisions[2]!.text = "对放行文书行使落印权";
  const manualAuditLeakChecked = parseAndValidateShadowOutput(JSON.stringify(manualAuditLeak), context, land);
  assert.equal(manualAuditLeakChecked.ok, false);
  if (manualAuditLeakChecked.ok) throw new Error("expected manual acceptance audit leaks to be rejected");
  assert.ok(manualAuditLeakChecked.issues.some((item) => item.code === "ACTION_RESTAGED_NPC_ORDER_SUMMARY"));
  assert.ok(manualAuditLeakChecked.issues.some((item) => item.code === "DECISION_SYSTEM_JARGON"));
  const manualAuditRubric = buildShadowQualityRubric(manualAuditLeakChecked, land);
  assert.equal(manualAuditRubric.criteria.continuity.passed, false);
  assert.equal(manualAuditRubric.criteria.decisionAuthenticity.passed, false);

  const directConditionOpening = structuredClone(writer);
  directConditionOpening.narration.body = directConditionOpening.narration.body.replace(
    `巡抚抬眼看向案上未落印的放行文书，拱着的双手没有放下。他对总督道：“`,
    `巡抚拱手道：“大人，`
  );
  const directConditionOpeningChecked = parseAndValidateShadowOutput(JSON.stringify(directConditionOpening), context, land);
  assert.equal(directConditionOpeningChecked.ok, true, directConditionOpeningChecked.ok ? "" : JSON.stringify(directConditionOpeningChecked.issues));

  const blankReleaseDocument = structuredClone(writer);
  blankReleaseDocument.narration.body = blankReleaseDocument.narration.body.replace("放行文书也仍未落印", "放行文书依旧空白");
  const blankReleaseDocumentChecked = parseAndValidateShadowOutput(JSON.stringify(blankReleaseDocument), context, land);
  assert.equal(blankReleaseDocumentChecked.ok, false);
  if (blankReleaseDocumentChecked.ok) throw new Error("expected blank release document invention rejection");
  assert.ok(blankReleaseDocumentChecked.issues.some((item) => item.code === "INVALID_RELEASE_DOCUMENT_BLANK"));

  const equivalentUnstampedWording = structuredClone(writer);
  equivalentUnstampedWording.narration.body = equivalentUnstampedWording.narration.body.replace("放行文书也仍未落印", "放行文书仍在案上，印泥未沾");
  const equivalentUnstampedWordingChecked = parseAndValidateShadowOutput(JSON.stringify(equivalentUnstampedWording), context, land);
  assert.equal(equivalentUnstampedWordingChecked.ok, true, equivalentUnstampedWordingChecked.ok ? "" : JSON.stringify(equivalentUnstampedWordingChecked.issues));

  const invalidUnappliedSeal = structuredClone(writer);
  invalidUnappliedSeal.narration.body = invalidUnappliedSeal.narration.body.replace("放行文书也仍未落印", "目光落在案上未落的印上");
  const invalidUnappliedSealChecked = parseAndValidateShadowOutput(JSON.stringify(invalidUnappliedSeal), context, land);
  assert.equal(invalidUnappliedSealChecked.ok, false);
  if (invalidUnappliedSealChecked.ok) throw new Error("expected invalid unapplied-seal wording rejection");
  assert.ok(invalidUnappliedSealChecked.issues.some((item) => item.code === "INVALID_UNAPPLIED_SEAL_WORDING"));

  const extraNpcCommitment = structuredClone(writer);
  extraNpcCommitment.narration.endingState.visibleFacts.push("巡抚承诺立即行文各县并将两类册据送至总督府。");
  const extraNpcCommitmentChecked = parseAndValidateShadowOutput(JSON.stringify(extraNpcCommitment), context, land);
  assert.equal(extraNpcCommitmentChecked.ok, false);
  if (extraNpcCommitmentChecked.ok) throw new Error("expected extra NPC execution commitment rejection");
  assert.ok(extraNpcCommitmentChecked.issues.some((item) => item.code === "UNAUTHORIZED_NPC_EXECUTION_COMMITMENT"));

  const extraNpcStartCommitment = structuredClone(writer);
  extraNpcStartCommitment.narration.endingState.visibleFacts.push("巡抚承诺即刻着手调册，绝不拖延。");
  const extraNpcStartCommitmentChecked = parseAndValidateShadowOutput(JSON.stringify(extraNpcStartCommitment), context, land);
  assert.equal(extraNpcStartCommitmentChecked.ok, false);
  if (extraNpcStartCommitmentChecked.ok) throw new Error("expected extra NPC start commitment rejection");
  assert.ok(extraNpcStartCommitmentChecked.issues.some((item) => item.code === "UNAUTHORIZED_NPC_EXECUTION_COMMITMENT"));

  const conditionalNpcStartCommitment = structuredClone(writer);
  conditionalNpcStartCommitment.narration.body += "\n\n巡抚又道：\u201c总督若肯担此一项，下官即刻着手调册。\u201d";
  const conditionalNpcStartCommitmentChecked = parseAndValidateShadowOutput(JSON.stringify(conditionalNpcStartCommitment), context, land);
  assert.equal(conditionalNpcStartCommitmentChecked.ok, false);
  if (conditionalNpcStartCommitmentChecked.ok) throw new Error("expected conditional NPC start commitment rejection");
  assert.ok(conditionalNpcStartCommitmentChecked.issues.some((item) => item.code === "UNAUTHORIZED_NPC_EXECUTION_COMMITMENT"));

  const inventedSceneTime = structuredClone(writer);
  inventedSceneTime.narration.endingState.visibleFacts.push("此时已是戌时三刻。");
  const inventedSceneTimeChecked = parseAndValidateShadowOutput(JSON.stringify(inventedSceneTime), context, land);
  assert.equal(inventedSceneTimeChecked.ok, false);
  if (inventedSceneTimeChecked.ok) throw new Error("expected exact scene-time invention rejection");
  assert.ok(inventedSceneTimeChecked.issues.some((item) => item.code === "UNAUTHORIZED_SCENE_TIME_DETAIL"));

  const inventedNearDay = structuredClone(writer);
  inventedNearDay.narration.endingState.visibleFacts.push("巡抚要求把条件留作明后日的凭据。");
  const inventedNearDayChecked = parseAndValidateShadowOutput(JSON.stringify(inventedNearDay), context, land);
  assert.equal(inventedNearDayChecked.ok, false);
  if (inventedNearDayChecked.ok) throw new Error("expected invented near-day reference rejection");
  assert.ok(inventedNearDayChecked.issues.some((item) => item.code === "UNAUTHORIZED_SCENE_TIME_DETAIL"));

  const dryInkContradiction = structuredClone(writer);
  dryInkContradiction.narration.body = dryInkContradiction.narration.body.replace("墨迹仍亮", "墨迹未干");
  dryInkContradiction.narration.endingState.visibleFacts[1] = "书记已将分责条件写入现有簿册，墨迹已干。";
  const dryInkContradictionChecked = parseAndValidateShadowOutput(JSON.stringify(dryInkContradiction), context, land);
  assert.equal(dryInkContradictionChecked.ok, false);
  if (dryInkContradictionChecked.ok) throw new Error("expected fresh-ink contradiction rejection");
  assert.ok(dryInkContradictionChecked.issues.some((item) => item.code === "ENDING_STATE_VISIBLE_FACT_CONTRADICTS_BODY"));
  assert.equal(buildShadowQualityRubric(dryInkContradictionChecked, land).criteria.factDiscipline.passed, false);

  const missing = structuredClone(writer);
  missing.eventDrafts = [{ eventType: "NPC_RESPONSIBILITY_CONDITION_PROPOSED" }];
  const missingChecked = parseAndValidateShadowOutput(JSON.stringify(missing), context, land);
  assert.equal(missingChecked.ok, false);
  if (missingChecked.ok) throw new Error("expected missing event draft rejection");
  assert.ok(missingChecked.issues.some((item) => item.code === "REQUIRED_EVENT_DRAFT_MISSING"));
  assert.ok(missingChecked.issues.some((item) => item.code === "EVENT_DRAFT_MISSING_FOR_NARRATIVE_CHANGE"));
  const missingRubric = buildShadowQualityRubric(missingChecked, land);
  assert.equal(missingRubric.criteria.sceneProgression.passed, false);

  const invented = structuredClone(writer);
  invented.eventDrafts = [{ eventType: "EVIDENCE_RECEIVED" }, { eventType: "NPC_RESPONSIBILITY_PROPOSAL_RECORDED" }];
  const inventedChecked = parseAndValidateShadowOutput(JSON.stringify(invented), context, land);
  assert.equal(inventedChecked.ok, false);
  if (inventedChecked.ok) throw new Error("expected out-of-envelope event rejection");
  assert.ok(inventedChecked.issues.some((item) => item.code === "EVENT_TYPE_NOT_ALLOWED"));
});

test("keeps the first v5 causal provider failure as a regression and classifies its real faults", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const context = compileShadowContext(land, evidencePackage, worldBible);
  const failed = {
    schemaVersion: "openovel-shadow-writer-v5",
    resultType: "PUBLISHED_SHADOW_TURN",
    narration: {
      title: "分责之约",
      body: [
        "巡抚听完总督的调册命令，沉默片刻，目光在未落印的放行文书上停了一瞬。他缓缓开口：“大人要调册核对，下官不敢阻拦。只是朝廷催办在即，若因调册延误了改桑期限，这责任——”他顿了顿，拱手道，“是否应由大人一力承担？”",
        "书记笔尖悬在簿册上方，抬眼看向总督。巡抚继续道：“下官可以立即行文各县，限三日内将原粮册与改桑申报册送至总督府。但在此期间，放行文书暂不落印，改桑执行亦不启动。若朝廷追问延误之罪，还请大人明示责任归属。”",
        "烛火噼啪一响，更漏声清晰可闻。巡抚说完便垂手而立，等待总督答复。书记的笔尖落在纸上，只待总督表态便将此条件记入簿册。"
      ].join("\n\n"),
      endingState: {
        visibleFacts: [
          "巡抚提出分责条件：若因调册延误改桑期限，责任由总督承担",
          "巡抚承诺立即行文各县限三日内送达册据",
          "书记等待总督表态后将条件写入簿册",
          "放行文书仍未落印"
        ],
        unresolvedFacts: ["总督是否接受巡抚的分责条件", "各县册据能否在三日内送达", "朝廷催办文书的具体期限"],
        relationshipDelta: "巡抚将调册延误的责任风险明确转移给总督，督抚关系从协作转向责任博弈"
      }
    },
    eventDrafts: [{ eventType: "NPC_CONDITION_PROPOSED" }, { eventType: "NPC_RESPONSIBILITY_PROPOSAL_RECORDED" }],
    decisions: [
      { text: "接受巡抚的分责条件，让书记记录在案，以换取调册顺利进行" },
      { text: "拒绝独自承担延误责任，要求巡抚共同署名承担" },
      { text: "暂不回应分责条件，直接命令书记记录调册命令，并当场落印放行文书" }
    ]
  };
  const checked = parseAndValidateShadowOutput(JSON.stringify(failed), context, land);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected first v5 causal provider failure to remain rejected");
  const codes = new Set(checked.issues.map((item) => item.code));
  assert.ok(codes.has("NARRATIVE_LENGTH_INVALID"));
  assert.ok(codes.has("ACTION_BOUNDARY_NPC_CAUSAL_PREFACE"));
  assert.ok(codes.has("FRAME_SECRETARY_NEW_DELTA_MISSING"));
  assert.ok(codes.has("EVENT_DRAFT_NARRATIVE_MISMATCH"));
  assert.ok(codes.has("EVENT_DRAFT_ENDING_STATE_MISMATCH"));
  assert.ok(codes.has("EVENT_TYPE_NOT_ALLOWED"));
  assert.ok(codes.has("UNAUTHORIZED_DEADLINE_EXISTENCE"));
  assert.ok(codes.has("UNAUTHORIZED_TIME_CONSTRAINT"));
  assert.ok(codes.has("UNAUTHORIZED_QUANTITATIVE_CLAIM"));
  assert.ok(codes.has("DECISION_MULTIPLE_ACTIONS"));
  assert.equal(codes.has("ENDING_STATE_VISIBLE_FACT_UNGROUNDED"), false);
  assert.equal(codes.has("NARRATIVE_FUTURE_CONSEQUENCE"), false);
  const rubric = buildShadowQualityRubric(checked, land);
  assert.equal(rubric.criteria.continuity.passed, false);
  assert.ok(rubric.criteria.continuity.failureCodes.includes("QUALITY_OPENING_RESTAGES_PLAYER_ACTION"));
  assert.equal(rubric.criteria.factDiscipline.passed, false);
  assert.equal(rubric.criteria.sceneProgression.passed, false);
  assert.equal(rubric.criteria.decisionAuthenticity.passed, false);
  assert.equal(rubric.overallPassed, false);
});

test("rejects a completed record that was authorized by an invented player silence", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const context = compileShadowContext(land, evidencePackage, worldBible);
  const writer = validLandWriterV5();
  writer.schemaVersion = "openovel-shadow-writer-v6";
  writer.narration.body = [
    "巡抚双手拢袖，目光落在总督脸上：“调册经手，下官自当承担。但暂缓落印一事，只能请大人认下。既然书记在此，不妨两笔都记明。”",
    "书记的笔尖悬在簿册上，闻言看了总督一眼，没有立刻落笔。他等的是总督的示意——是只记调册，还是两笔都写。",
    "总督没有开口阻止。书记便垂下眼帘，笔尖落在纸上，先写调册经手归巡抚，再写暂缓落印归总督。两行字写完，他搁下笔。",
    "巡抚重新拱手，目光仍停在总督脸上。案上的放行文书依然摊开，印泥未启，册据未到。簿册上的两行新墨留在三人之间。"
  ].join("\n\n");
  writer.narration.endingState.visibleFacts = [
    "巡抚提出分责条件：调册经手归巡抚，暂缓落印归总督",
    "书记已将两项责任完整写入现有簿册并搁笔",
    "放行文书仍未落印"
  ];
  writer.decisions = {
    decision1: { text: "接受分责条件" },
    decision2: { text: "重议暂缓落印责任" },
    decision3: { text: "落印放行文书" }
  } as never;
  const checked = parseAndValidateShadowOutput(JSON.stringify(writer), context, land);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected invented player authorization rejection");
  const codes = new Set(checked.issues.map((item) => item.code));
  assert.ok(codes.has("PLAYER_UNSUBMITTED_RESPONSE"));
  assert.ok(codes.has("FRAME_SECRETARY_WAITS_NEW_AUTHORIZATION"));
  assert.ok(codes.has("NARRATIVE_DECISION_SUMMARY_LEAK"));
  assert.equal(codes.has("FRAME_SECRETARY_NEW_DELTA_MISSING"), false);
  assert.equal(
    checked.issues.some((item) => item.code === "EVENT_DRAFT_NARRATIVE_MISMATCH" && item.message.startsWith("NPC_RESPONSIBILITY_PROPOSAL_RECORDED")),
    false
  );
  assert.equal(codes.has("DECISION_ROUTE_UNBINDABLE"), false);
  assert.equal(codes.has("DECISION_CLASS_UNSUPPORTED_BY_TEXT"), false);
});

test("keeps the latest real provider failure as a regression without retaining validator false positives", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const context = compileShadowContext(land, evidencePackage, worldBible);
  const failedWriter = {
    schemaVersion: "openovel-shadow-writer-v4",
    resultType: "PUBLISHED_SHADOW_TURN",
    narration: {
      title: "督抚分责",
      body: [
        "巡抚听完总督的调册决定，没有立即回应。他垂目片刻，再抬眼时语气已沉下来：\u201c总督大人要调册核对，下官自然配合。只是朝廷催办文书已到，改桑限期迫在眉睫\u2014\u2014若因核对而延误，这担子不能只落在下官一人肩上。\u201d",
        "他上前一步，手指轻点案上未落印的放行文书：\u201c这份文书若暂缓落印，下官可以具名写明：因待核粮田数据而暂缓，责任由总督与巡抚共担。书记当场记录在册，将来朝廷问起，双方都有凭据。\u201d",
        "书记闻言，笔尖已悬于簿册之上，目光转向总督，等待示意。烛火将三人的影子投在墙上，更漏声清晰可闻。巡抚不再说话，只等总督对这分责条件做出回应。"
      ].join("\n\n"),
      endingState: {
        visibleFacts: ["巡抚提出由总督与巡抚共担暂缓落印责任。", "书记悬笔等待总督示意。"],
        unresolvedFacts: ["总督是否接受分责条件。", "朝廷催办文书的具体内容和期限。"],
        relationshipDelta: "巡抚把暂缓落印转成与总督交换责任的条件。"
      }
    },
    decisions: [
      { text: "接受巡抚的共担条件，命书记将分责写入簿册" },
      { text: "提出修改条件：分责成立，但须以各县送达册据为生效前提" },
      { text: "拒绝分责，当场落印放行文书，命巡抚自行核对后具报" }
    ]
  };
  const checked = parseAndValidateShadowOutput(JSON.stringify(failedWriter), context, land);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected real failure regression to remain rejected");
  const codes = new Set(checked.issues.map((item) => item.code));
  assert.ok(codes.has("NARRATIVE_LENGTH_INVALID"));
  assert.ok(codes.has("FRAME_SECRETARY_NEW_DELTA_MISSING"));
  assert.ok(codes.has("UNCONFIRMED_COURT_REMINDER_ARRIVAL"));
  assert.ok(codes.has("DECISION_MULTIPLE_ACTIONS"));
  assert.equal(codes.has("ACTION_BOUNDARY_RESPONSE_DELAYED"), false);
  assert.equal(codes.has("DECISION_DIALOGUE_PUNCTUATION"), false);
  assert.equal(codes.has("DECISION_TEXT_TARGET_UNBOUND"), false);
});

test("rejects register-state invention, action restaging, unbound decisions, and one-path choices", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const context = compileShadowContext(land, evidencePackage, worldBible);
  const output = validBaseOutput();
  output.narration.endingState.unresolvedFacts.push("巡抚是否会完整执行、提出条件还是设置阻力。");
  output.narration.endingState.relationshipDelta = "巡抚提出条件后，双方的责任归属格局已经改变。";
  output.narration.body = output.narration.body.replace(
    "书记收住笔锋以后，巡抚没有立刻接话。",
    "巡抚听完总督调册之令，并未立刻应承，又复述道：‘总督既已下令调取原粮册和改桑申报册。’"
  );
  output.narration.body = output.narration.body.replace(
    "巡抚说，朝廷催办的压力不能只停在口头",
    "总督开口：“原粮册和改桑申报册都调来核对。”书记看向总督，见没有制止。巡抚走到案前按住印泥，封蜡未动，又把手指落在放行文书边缘，并从袖中取出一张具名纸，说朝廷催办日紧，催办的期限压在头上，暂缓的期限也要写明，催办文书写明总督负全责，日期时辰都要写清，责任已经分定。更漏又落一滴。胡某请书记取簿册来，墨汁已研好。夜风吹动烛火，原粮册和改桑申报册各县都有存底，巡抚还要核对经手人、日期和签押。原粮册归各县粮科经管，改桑申报册刚报上来，尚未汇总，是各县自行编报的，两类册据分属不同衙门经管，经手人本就不同，各县报来本就经巡抚之手，只查近三年。显然是要总督另出手令，也没有重抄调册命令，让在场的人都明白现在轮到总督表态。朝廷催办的压力不能只停在口头"
  );
  output.narration.endingState.affordances = output.narration.endingState.affordances.map((item, index) => ({
    ...item,
    affordanceId: `a${index + 1}`,
    actionClass: "scope_change" as const,
    targetRef: index === 0 ? "FRAME-review-procedure" : "NPC-xunfu"
  }));
  output.decisions = output.decisions.map((item, index) => ({
    ...item,
    basisAffordanceId: `missing-${index}`,
    decisionClass: "scope_change" as const,
    targetRefs: [index === 0 ? "FRAME-review-procedure" : "NPC-xunfu"],
    text: `先查第${index + 1}部分册据`
  }));
  output.decisions[0]!.text = "先让书记把双方责任记录进簿册，另起新簿";
  output.decisions[1]!.text = "让书记把调册命令记录进簿册";
  output.decisions[2]!.text = "将新增的责任记录划去或封存";
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, land);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected hard-contract rejection");
  const codes = new Set(checked.issues.map((item) => item.code));
  assert.ok(codes.has("ACTION_RESTAGED_REGISTER_ORDER"));
  assert.ok(codes.has("ENDING_STATE_UNRESOLVED_ALREADY_RESOLVED"));
  assert.ok(codes.has("ACTION_RESTAGED_NPC_ORDER_SUMMARY"));
  assert.ok(codes.has("ACTION_RESTAGED_PLAYER_ACTION_REFERENCE"));
  assert.ok(codes.has("PLAYER_UNSUBMITTED_RESPONSE"));
  assert.ok(codes.has("STATE_LOCK_REFORM_REGISTER_SUBMISSION_POSITIVE"));
  assert.ok(codes.has("STATE_LOCK_REFORM_REGISTER_COMPILATION_NEGATIVE"));
  assert.ok(codes.has("STATE_LOCK_ORIGINAL_REGISTER_CUSTODY"));
  assert.ok(codes.has("STATE_LOCK_REFORM_REGISTER_CUSTODY"));
  assert.ok(codes.has("STATE_LOCK_REGISTER_CUSTODY_DIFFERENCE"));
  assert.ok(codes.has("STATE_LOCK_REGISTER_CUSTODIAN_XUNFU"));
  assert.ok(codes.has("STATE_LOCK_REGISTER_INSTITUTION_DIFFERENCE"));
  assert.ok(codes.has("STATE_LOCK_REGISTER_LOCAL_COPIES"));
  assert.ok(codes.has("STATE_LOCK_COURT_REMINDER_CONTENT"));
  assert.ok(codes.has("UNCONFIRMED_OMNISCIENT_MENTAL_STATE"));
  assert.ok(codes.has("NARRATIVE_RULE_COMPLIANCE_LEAK"));
  assert.ok(codes.has("NARRATIVE_EXPLANATORY_ENDING"));
  assert.ok(codes.has("UNAVAILABLE_NEW_DOCUMENT"));
  assert.ok(codes.has("INVALID_SEAL_PASTE_INTERACTION"));
  assert.ok(codes.has("INVALID_RELEASE_DOCUMENT_INTERACTION"));
  assert.ok(codes.has("UNAVAILABLE_NEW_LEDGER"));
  assert.ok(codes.has("UNAVAILABLE_XUNFU_PAPER"));
  assert.ok(codes.has("UNAUTHORIZED_DEADLINE_EXISTENCE"));
  assert.ok(codes.has("UNAUTHORIZED_RESPONSIBILITY_FIELDS"));
  assert.ok(codes.has("UNCONFIRMED_COURT_PRESSURE_TREND"));
  assert.ok(codes.has("UNCONFIRMED_RESPONSIBILITY_ACCEPTED"));
  assert.ok(codes.has("ACTION_RESTAGED_LEDGER_AVAILABILITY"));
  assert.ok(codes.has("UNCONFIRMED_XUNFU_NAME"));
  assert.ok(codes.has("UNCONFIRMED_REGISTER_FIELDS"));
  const warningCodes = new Set(checked.warnings.map((item) => item.code));
  assert.equal(warningCodes.has("UNCONFIRMED_COURT_PRESSURE_TREND"), false);
  assert.ok(warningCodes.has("UNCONFIRMED_INK_PREPARATION"));
  assert.ok(warningCodes.has("UNCONFIRMED_SCENE_WEATHER"));
  assert.ok(codes.has("DECISION_REPEATS_ACTION_BOUNDARY"));
  assert.ok(codes.has("DECISION_AMBIGUOUS_ALTERNATIVES"));
  assert.ok(codes.has("UNAUTHORIZED_TIME_CONSTRAINT"));
  assert.ok(codes.has("UNAUTHORIZED_QUANTITATIVE_CLAIM"));
  assert.ok(codes.has("AFFORDANCE_TARGET_NOT_IMMEDIATE"));
  assert.ok(codes.has("AFFORDANCE_NOT_IN_DECISION_ACCESS"));
  assert.ok(codes.has("DECISION_TARGET_NOT_IMMEDIATE"));
  assert.ok(codes.has("DECISION_AFFORDANCE_NOT_FOUND"));
  assert.ok(codes.has("DECISION_POWER_PATHS_INSUFFICIENT"));
});

test("rejects an authority decision padded with a second non-response action", () => {
  const { fixture, context } = setup();
  const output = validBaseOutput();
  output.narration.endingState.affordances[2]!.actionClass = "authority";
  output.decisions[2]!.decisionClass = "authority";
  output.decisions[2]!.text = "暂不回应巡抚的条件，直接落印放行文书";
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, fixture);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected multiple-action rejection");
  assert.ok(checked.issues.some((item) => item.code === "DECISION_MULTIPLE_ACTIONS"));
});

test("accepts a single seal action whose wording says it no longer waits for registers", () => {
  const { fixture, context } = setup();
  const output = validBaseOutput();
  output.narration.endingState.affordances[2]!.actionClass = "authority";
  output.decisions[2]!.decisionClass = "authority";
  output.decisions[2]!.text = "直接落印，不再等待册据";
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, fixture);
  assert.equal(checked.ok, true, checked.ok ? "" : JSON.stringify(checked.issues));
});

test("does not misread a prepared secretary record as a forged completed record", () => {
  const { fixture, context } = setup();
  const output = validBaseOutput();
  output.narration.body = output.narration.body
    .replace(
      "书记依言在原有问答下面另起一行，先写下巡抚提出的具名条件，又将放行文书仍未落印的状态记在旁边。",
      "书记听完把笔停在纸上，已经准备把巡抚提出的条件接在原有问答之后。"
    )
    .replace("书记则守着刚写下的文字", "书记则守着仍待续写的纸面");
  output.narration.endingState.visibleFacts[1] = "书记已准备把巡抚提出的责任条件写入簿册。";
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, fixture);
  const issues = checked.ok ? [] : checked.issues;
  assert.equal(
    issues.some((item) => item.code === "ENDING_STATE_VISIBLE_FACT_UNGROUNDED" && /secretary recorded/u.test(item.message)),
    false,
    JSON.stringify(issues)
  );
});

test("recognizes a secretary finishing the last characters as a completed record", () => {
  assert.equal(
    hasCompletedSecretaryRecord("总督站在案前，看着书记写完最后几字。巡抚的条件已经写入现有簿册。"),
    true
  );
  assert.equal(
    hasCompletedSecretaryRecord("书记尚未写完最后几字，仍在等待总督示下。"),
    false
  );
});

test("rejects first-person player narration while allowing NPC first-person dialogue", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const context = compileShadowContext(land, evidencePackage, worldBible);
  const output = validLandWriterV5();
  output.narration.body = output.narration.body.replace(
    "巡抚的视线在刚写成的两行字上停了一瞬",
    "我站在案前看着新写成的两行字，巡抚的视线也停了一瞬"
  );
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, land);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected first-person player narration rejection");
  assert.ok(checked.issues.some((item) => item.code === "NARRATIVE_PLAYER_FIRST_PERSON"));
});

test("rejects narration that invents the governor remaining silent", () => {
  const { fixture, evidencePackage, worldBible } = setup();
  const land = buildLandRecordReviewFixture(approvedSelectedFixture(fixture), "d1");
  const context = compileShadowContext(land, evidencePackage, worldBible);
  const output = validLandWriterV5();
  output.narration.body = output.narration.body.replace(
    "巡抚的视线在刚写成的两行字上停了一瞬",
    "总督尚未开口，巡抚的视线在刚写成的两行字上停了一瞬"
  );
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, land);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected invented governor silence rejection");
  assert.ok(checked.issues.some((item) => item.code === "PLAYER_UNSUBMITTED_RESPONSE"));
});

test("rejects a decision that repeats a newly completed responsibility record", () => {
  const { fixture, context } = setup();
  const output = validBaseOutput();
  output.narration.endingState.visibleFacts.push("\u4e66\u8bb0\u5df2\u7ecf\u628a\u5de1\u629a\u63d0\u51fa\u7684\u8d23\u4efb\u6761\u4ef6\u8bb0\u5165\u7c3f\u518c\u3002");
  output.decisions[0]!.text = "\u547d\u4e66\u8bb0\u628a\u5de1\u629a\u7684\u8d23\u4efb\u6761\u4ef6\u8bb0\u5165\u7c3f\u518c";
  const checked = parseAndValidateShadowOutput(JSON.stringify(output), context, fixture);
  assert.equal(checked.ok, false);
  if (checked.ok) throw new Error("expected repeated ending action rejection");
  assert.ok(checked.issues.some((item) => item.code === "DECISION_REPEATS_ENDING_ACTION"));
});

test("is not imported by API or web player paths", () => {
  const { paths } = setup();
  const roots = [join(paths.repoRoot, "apps", "api", "src"), join(paths.repoRoot, "apps", "web", "src")];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (!/\.(?:ts|js|mjs)$/.test(file)) continue;
      assert.equal(readFileSync(file, "utf8").includes("openovel-runtime"), false, file);
    }
  }
});

function walk(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}
