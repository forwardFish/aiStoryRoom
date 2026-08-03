import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DurableEventMirror, NoopMirror } from "../src/mirror.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { StorykeeperDrain } from "../src/storykeeper.js";
import { OpenNovelRuntime } from "../src/runtime.js";
import {
  prepareSangtianDecision,
  sangtianDecisionAdapter,
} from "../src/sangtian-decisions.js";
import { recoverRuntimeRuns } from "../src/recovery.js";
import { auditOpenNovelRun } from "../src/audit.js";
import { OpenAICompatibleProvider } from "../src/provider.js";
import {
  authorizedNarrativeIntent,
  buildCausalDelta,
  enforceCausalKnowledgeBoundary,
  renderNarratorCausalDelta,
  validateRequiredNarrativeFacts,
} from "../src/causal-delta.js";
import {
  buildCausalDelta as buildRuntimeCausalDelta,
  renderNarratorCausalDelta as renderRuntimeNarratorCausalDelta,
} from "../src/causal-context.js";
import { parseOptions } from "../src/options.js";
import {
  buildForegroundUserContext,
  buildNarratorMessages,
  buildOptionsMessages,
  compileForegroundContext,
  formatContextCardContent,
  formatFrontendSection,
  getStorySnapshot,
  activateContextCards,
  projectForegroundGuidance,
  sanitizeOptionsGuidance,
  sanitizeDirectedBeat,
} from "../src/foreground.js";
import {
  projectBackstageConstraintSentence,
  projectClosedFormalDocumentClaims,
  projectClosedFormalDocumentExtent,
  projectExternalActorSpeechToAuthorizedMoves,
  projectPlayerSpeechToAuthorizedAction,
  projectUnsupportedIncidentalSentence,
  normalizeCanonicalRoleTerms,
  normalizeNarrativeSurface,
  safeNarrativePrefixForWarning,
  shadowContinuityWarnings,
  validateDurableBoundary,
  validateForegroundSurface,
} from "../src/surface-guard.js";
import { validateSurfaceIntegrity as validateV4SurfaceIntegrity } from "../src/surface-integrity.js";
import { buildTruthReviewUnits } from "../src/truth-review.js";
import type {
  OpenNovelProvider,
  EventMirror,
  MirrorEvent,
  ProviderRequest,
  ProviderResult,
  TurnEvent,
} from "../src/types.js";

const upstreamCommit = "1b4404e85d03d1e41e5d745e303372333b29c610";
const projectRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("provider hard deadline releases a stalled response body", async () => {
  const neverEndingBody = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => {}),
  });
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://provider.example/v1",
    narratorModel: "test-model",
    optionsModel: "test-model",
    storykeeperModel: "test-model",
    timeoutMs: 25,
    fetchImpl: async () => new Response(neverEndingBody, { status: 200 }),
  });
  const startedAt = Date.now();
  await assert.rejects(
    provider.generate({
      profile: "narrator",
      messages: [{ role: "user", content: "continue" }],
      temperature: 0.5,
      maxTokens: 100,
      json: false,
      stream: true,
    }),
    /Provider timed out after 25ms/,
  );
  assert.ok(Date.now() - startedAt < 1_000);
});

test("provider preserves a streamed length finish reason for the release gate", async () => {
  const body = [
    'data: {"choices":[{"delta":{"content":"只写到半句"},"finish_reason":null}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":100,"completion_tokens":2000}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://provider.example/v1",
    narratorModel: "test-model",
    optionsModel: "test-model",
    storykeeperModel: "test-model",
    timeoutMs: 1_000,
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  });
  const result = await provider.generate({
    profile: "narrator",
    messages: [{ role: "user", content: "continue" }],
    temperature: 0.5,
    maxTokens: 2_000,
    json: false,
    stream: true,
  });
  assert.equal(result.finishReason, "length");
  assert.equal(result.usage.outputTokens, 2_000);
});

test("SiliconFlow requests explicitly cap hidden thinking at the documented minimum", async () => {
  let sent: Record<string, unknown> = {};
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://api.siliconflow.com/v1",
    narratorModel: "zai-org/GLM-5.2",
    optionsModel: "zai-org/GLM-5.2",
    storykeeperModel: "zai-org/GLM-5.2",
    timeoutMs: 1_000,
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "完成。" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await provider.generate({
    profile: "narrator",
    messages: [{ role: "user", content: "continue" }],
    temperature: 0.5,
    maxTokens: 2_000,
    json: false,
    stream: false,
  });
  assert.equal(sent.enable_thinking, false);
  assert.equal(sent.thinking_budget, 128);
});

test("Options repairs relay JSON and does not pre-write results for discovery moves", () => {
  const parsed = parseOptions(
    `{
      "options": [
        {
          "label": "问亲随清流县档房何人经手、何人掌钥",
          "key": true,
          "effect": {
            "intent": "取得经手链",
            "stateHints": [{"key":"经手链","op":"flag","value":true,"presentThisTurn":true}]
          }
        },
        {"label": "叫幕僚或中军官来，商议派谁去清流"},
        {"label": "给巡抚书吏一个口信回衙"},
        {"label": "暂不答复，先调杭州府近年田亩汇总册比对"},
        {
          "label": "唤幕僚进来商议派何人去清流",
          "key": true,
          "effect": {
            "intent": "开始商议人选",
            "reversible": true,
            "stateHints": [{"key":"复核筹备","op":"flag","value":true,"presentThisTurn":true}]
          }
        },
        {"label": "起身去前厅看廊下议论米行的情形"}
      ],
      "tension": "书吏已带着"今日不落印"的原话离开。",
      "storyComplete": false
    }`,
    "T03",
    "给巡抚书吏一句口头答复。",
    [],
    "当前只有催办公文、密信和未随信送来的原册。",
  );
  assert.equal(parsed.tension, "书吏已带着\"今日不落印\"的原话离开。");
  assert.deepEqual(
    parsed.options.map((option) => option.label),
    [
      "问亲随清流县档房何人经手、何人掌钥",
      "唤幕僚进来商议派何人去清流",
      "起身去前厅看廊下议论米行的情形",
    ],
  );
  assert.equal(parsed.options[0].key, undefined);
  assert.equal(parsed.options[0].effect, undefined);
  assert.equal(parsed.options[1].key, undefined);
  assert.equal(parsed.options[1].effect?.stateHints?.[0].presentThisTurn, undefined);

  const modality = parseOptions(
    JSON.stringify({
      options: [
        { label: "命亲随返回清流，封存县档原册，不得擅动" },
        { label: "给巡抚写一句口头回话：容查后具报，今日不给放行" },
        { label: "把书吏口述的暂缓理由写下，转为书面回文" },
      ],
      tension: "答复方式",
    }),
    "T01",
    "核对密信报疑",
    [],
    "巡抚书吏和县令亲随仍在内厅。",
  );
  assert.deepEqual(modality.options.map((option) => option.label), [
    "命亲随返回清流，封存县档原册，不得擅动",
    "把书吏口述的暂缓理由写下，转为书面回文",
  ]);
});

test("player playtest exposes story, option labels, and free action without internal fields", async () => {
  const publicDir = path.join(projectRoot, "apps", "openovel-runtime", "public");
  const [html, script] = await Promise.all([
    readFile(path.join(publicDir, "index.html"), "utf8"),
    readFile(path.join(publicDir, "app.js"), "utf8"),
  ]);

  assert.match(html, /剧情正文/);
  assert.match(html, /写下你自己的行动/);
  assert.match(script, /text\/event-stream/);
  assert.match(script, /narration\.delta/);
  assert.match(script, /turn\.committed/);
  assert.match(script, /localStorage/);
  assert.match(script, /button\.textContent = String\(option\.label/);
  assert.match(script, /latestAction\?\.scrollIntoView/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(html, /stateHints|Storykeeper|Prompt|concreteCost|countermove/);
});

test("foreground capsule keeps Recent Canon authoritative and Reader Action last", async () => {
  await withRuntime(async ({ workspace, runId }) => {
    const snapshot = await getStorySnapshot(workspace.paths(runId));
    const compiled = await compileForegroundContext(workspace.paths(runId), snapshot);
    assert.match(compiled.foregroundGuidance, /## Knowledge Boundary/);
    assert.match(compiled.foregroundGuidance, /未在 Canon 出现的汇总表册/);
    assert.match(compiled.foregroundGuidance, /持久物件事实：巡抚回文匣当前为空且合拢/);
    const openingEffect = snapshot.previousOptions[0]?.effect;
    assert.match(openingEffect?.intent || "", /核对完成即停/);
    assert.equal(
      openingEffect?.knowledgeBoundary?.sourceRef,
      "EVIDENCE-P1-QINGLIU-REGISTER-ANOMALY",
    );
    assert.ok(openingEffect?.knowledgeBoundary?.allowed.some((item) => (
      item.includes("尚未独立核实")
    )));
    assert.ok(openingEffect?.knowledgeBoundary?.forbidden.some((item) => (
      item.includes("钥匙") && item.includes("封条")
    )));
    assert.doesNotMatch(openingEffect?.intent || "", /启动复核/);
    const action = "暂不落印，先问清原册为何没有随信送来。";
    const actionScope = "本回合只核实两项已知边界：密信仅为报疑，原册未随信送来。亲随不能补充档房保管、经手人或原册内容；取得原册和启动正式复核仍是下一步决定。";
    const delta = buildCausalDelta({
      turnId: "T01",
      action,
      selectedOption: {
        id: "opening_test",
        label: action,
        effect: { intent: actionScope },
      },
    });
    const message = buildForegroundUserContext(delta, compiled);
    assert.match(message, /Foreground Guidance/);
    assert.match(message, /Recent Player Canon/);
    assert.match(message, /## This Turn/);
    assert.match(message, /## Reader Action/);
    assert.match(message, /暂不落印，先问清原册为何没有随信送来/);
    assert.doesNotMatch(message, /本轮需要自然发生|具体兑现/);
    assert.doesNotMatch(message, /NPC 本轮不得补充：档房保管；经手人；原册内容/);
    assert.doesNotMatch(message, /亲随不能补充档房保管/);
    assert.doesNotMatch(message, /取得原册和启动正式复核仍是下一步决定/);
    assert.equal(
      message.trim().endsWith(action),
      true,
    );
    assert.ok(message.lastIndexOf("## This Turn") > message.lastIndexOf("## Recent Player Canon"));
    assert.ok(message.lastIndexOf("## Reader Action") > message.lastIndexOf("## Recent Player Canon"));
    assert.doesNotMatch(message, /Settlement|stateJson|Validator Rule|Section Exit Gate/);

    const prompts = buildNarratorMessages(delta, compiled);
    assert.equal(prompts.length, 2);
    assert.match(prompts[0].content, /从 Recent Player Canon 最后一刻继续/);
    assert.match(prompts[0].content, /把它圆成可发生的尝试、传话或过渡/);
    assert.match(prompts[0].content, /Reader Action 是本回合唯一的主角行动/);
    assert.match(prompts[0].content, /普通动作、目光、衣袖、灯火、案几、普通纸张和空间调度可以自由书写/);
    assert.match(prompts[0].content, /不要凭空新增具名人物、关键证据、正式文书/);
    assert.match(prompts[0].content, /不要替主角完成 Reader Action 之外的签署、承诺或重大处置/);
    assert.match(prompts[0].content, /Foreground Guidance、Durable Memory 和 This Turn 只提供约束与叙事纹理/);
    assert.doesNotMatch(prompts[0].content, /物件持有人|跨 clause|activeActor/);

    const freeAction = "让书吏把协办办法说清楚，在他说完之前公文仍不签。";
    const freeText = buildForegroundUserContext(
      buildCausalDelta({
        turnId: "T02",
        action: freeAction,
        selectedOption: null,
      }),
      compiled,
    );
    assert.match(freeText, /## Reader Action/);
    assert.match(freeText, new RegExp(freeAction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(freeText.lastIndexOf("## Reader Action") > freeText.lastIndexOf("## Recent Canon Excerpt"));

    const optionsPrompts = buildOptionsMessages(action, "书吏仍在等候。", snapshot, compiled);
    assert.match(optionsPrompts[0].content, /给出 2—4 个真正不同/);
    assert.match(optionsPrompts[0].content, /故事唯一的“现在”/);
    assert.match(optionsPrompts[0].content, /物理上、制度上和知识上都能执行/);
    assert.match(optionsPrompts[0].content, /不得引入上下文里没有出现的具名人物、机构、地点、器物或事实/);
    assert.match(optionsPrompts[0].content, /每项只包含一个主要制度动作/);
    assert.match(optionsPrompts[0].content, /不能把缺失的原册、具体疑点、证人、文书、数字/);

    await activateContextCards(
      workspace.paths(runId),
      "派总督府差役去清流监督封存",
      snapshot.foregroundGuidance,
    );
    const runnerSnapshot = await getStorySnapshot(workspace.paths(runId));
    assert.match(runnerSnapshot.foregroundGuidance, /# 总督府差役/);
    assert.match(runnerSnapshot.foregroundGuidance, /不得临时添加姓名、绰号、外貌履历或私人关系/);
  });
});

test("Narrator projection preserves guidance as non-authoritative texture", async () => {
  const sangtianGuidance = [
    "## Scene",
    "",
    "巡抚差役跪在堂下等回话。总督须面对加码给出回应。",
    "",
    "## Active Pressures",
    "",
    "- [URGENT] 巡抚威胁亲自来取回文。总督必须面对加码给出回应——不能继续只问话或等待。",
    "- [HIGH] 封存令已发但差员未派，清流档房仍在空窗期。",
    "",
    "## This Turn",
    "",
    "- T05入口节点：给巡抚答复、确定差员或调取材料——由玩家选择决定路径。",
    "",
    "## Forbidden",
    "",
    "- 不得替总督响应巡抚加码或做出选择。",
    "- 不得新增人物、文书、证据、数量、期限或办理完成结果。",
    "- shadow_warning UNVERIFIED_DURABLE_LOCATION：公文所在地尚未确认。",
  ].join("\n");
  const projected = projectForegroundGuidance(sangtianGuidance);
  assert.match(projected.text, /巡抚差役跪在堂下等回话/);
  assert.match(projected.text, /封存令已发但差员未派/);
  assert.match(projected.text, /不得替总督响应巡抚加码或做出选择/);
  assert.match(projected.text, /不得新增人物、文书、证据、数量、期限/);
  assert.match(projected.text, /shadow_warning|UNVERIFIED_DURABLE_LOCATION/);
  assert.match(projected.text, /总督须面对加码/);
  assert.match(projected.text, /总督必须面对加码/);
  assert.match(projected.text, /T05入口节点|由玩家选择/);
  assert.equal(projected.removedPlayerDirectiveClauses, 0);
  assert.equal(projected.deduplicatedContextCardSections, 0);

  const secondWorldGuidance = [
    "## Scene",
    "",
    "The envoy waits beside the airlock. The commander must answer before dawn.",
    "",
    "## Active Pressures",
    "",
    "- Reactor temperature continues to rise.",
    "- The player must choose whether to launch a probe or abandon orbit.",
  ].join("\n");
  const secondWorld = projectForegroundGuidance(secondWorldGuidance);
  assert.match(secondWorld.text, /The envoy waits beside the airlock/);
  assert.match(secondWorld.text, /Reactor temperature continues to rise/);
  assert.match(secondWorld.text, /commander must answer|player must choose/i);
  assert.equal(secondWorld.removedPlayerDirectiveClauses, 0);
});

test("Narrator projection keeps only the latest context card for one identity", () => {
  const projected = projectForegroundGuidance([
    "## Story",
    "",
    "# 浙江总督",
    "",
    "- 旧状态：尚未派人。",
    "",
    "# 浙江巡抚",
    "",
    "- 催办公文仍未取回。",
    "",
    "# 浙江总督",
    "",
    "- 新状态：差员已经确定。",
  ].join("\n"));
  assert.doesNotMatch(projected.text, /旧状态/);
  assert.match(projected.text, /新状态：差员已经确定/);
  assert.match(projected.text, /催办公文仍未取回/);
  assert.equal(projected.deduplicatedContextCardSections, 1);
});

test("foreground compilation quarantines objective claims from prior Shadow warnings", async () => {
  await withRuntime(async ({ workspace, runId }) => {
    const paths = workspace.paths(runId);
    await workspace.recordSceneEvent(runId, {
      type: "shadow_warning",
      turnId: "T01",
      code: "UNSUPPORTED_CUSTODY_ASSERTION",
      message: "正文为原册新增了无来源的既往保管保证",
      severity: "HIGH",
      blocksPlayer: false,
      details: { subject: "原册", attributed: "true", state: "未封未护" },
    });
    await writeFile(
      path.join(paths.frontendDir, "active-pressures.md"),
      "- [HIGH] 原册仍在清流，未封未护。\n- [HIGH] 清流县册原册仍在档房，经手人、钥匙、封条状态均未知。\n- [HIGH] 原册未随信送来。\n- [HIGH] 亲随称原册未曾离县，尚未核实。\n",
      "utf8",
    );
    await writeFile(
      paths.storyMemory,
      "# Story Memory\n\n- 原册仍在清流，未封未护。\n- 原册未随信送来。\n- 亲随称原册未曾离县，尚未核实。\n",
      "utf8",
    );
    const compiled = await compileForegroundContext(paths, await getStorySnapshot(paths));
    assert.doesNotMatch(compiled.foregroundGuidance, /原册仍在清流，未封未护/);
    assert.doesNotMatch(compiled.foregroundGuidance, /清流县册原册仍在档房/);
    assert.match(compiled.foregroundGuidance, /原册未随信送来/);
    assert.match(compiled.foregroundGuidance, /亲随称原册未曾离县，尚未核实/);
    assert.doesNotMatch(compiled.storyMemory, /原册仍在清流，未封未护/);
    assert.match(compiled.storyMemory, /原册未随信送来/);
    assert.match(compiled.storyMemory, /亲随称原册未曾离县，尚未核实/);
  });
});

test("directed beat remains guidance and is never lexically promoted to authority", () => {
  assert.match(
    sanitizeDirectedBeat("## This Turn\n\n- 观测舱外已经建立的警报开始倒数。"),
    /警报开始倒数/,
  );
  assert.match(
    sanitizeDirectedBeat("T02 floor T03 前置：若T02仍未答复，T03最迟让压力推进。"),
    /T02 floor T03 前置/,
  );
  assert.match(
    sanitizeDirectedBeat("总督必须在本回合给巡抚答复。"),
    /总督必须在本回合给巡抚答复/,
  );
});

test("surface guard blocks system failures but not ordinary narrative texture", () => {
  const texture = "总督没有去碰那只匣子，只把目光移到已经合拢的回文匣上。灯火照着案角，书吏的衣袖微微一动，仍旧等着回话。内厅无人催第二遍，门外驿铃却又响了起来。";
  assert.equal(validateForegroundSurface(texture, "").ok, true);
  assert.equal(shadowContinuityWarnings(texture).length, 0);
  assert.equal(
    normalizeNarrativeSurface("旧场收束。\n\n——\n\n次日，签押房。"),
    "旧场收束。\n\n次日，签押房。",
  );

  assert.equal(validateForegroundSurface('{"narration":"debug"}', "").ok, false);
  assert.equal(validateForegroundSurface("DATABASE_URL=postgres://secret", "").ok, false);
  assert.equal(validateForegroundSurface("```ovl:hud\n粮价: 高", "").ok, false);
  assert.equal(
    validateForegroundSurface('总督抬眼问道："你家县令所报，究竟是报', "").reason,
    "TRUNCATED_NARRATION",
  );
  assert.equal(
    validateForegroundSurface("总督靠回椅背。他得决定下一步——是派人取册，还是先回巡抚一个字条。", "").reason,
    "PLAYER_CHOICE_LEAK",
  );

  const risky = "总督当即落印批准了改桑放行文书，又答应承担此事全部后果。";
  const warnings = shadowContinuityWarnings(risky);
  assert.ok(warnings.some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"));
  assert.ok(warnings.every((warning) => warning.blocksPlayer === true));

  const contradiction = shadowContinuityWarnings(
    "总督说：“改桑放行，我今日就签。”随即命人半个时辰内发出封档行文。",
    "暂不签发放行文书，先问清县册疑点。",
  );
  assert.ok(contradiction.some((warning) => warning.code === "READER_ACTION_CONTRADICTION"));
  assert.ok(contradiction.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"));
  const leakedPromise = shadowContinuityWarnings(
    '"回文今晚给你。"总督搁下茶盏，语气没有什么变化，"你先坐着。"',
    "暂不签发放行文书，留下巡抚书吏，同时核对密信。",
  );
  assert.ok(leakedPromise.some((warning) => (
    warning.code === "PLAYER_COMMITMENT_WARNING"
    && warning.blocksPlayer
  )));
  assert.equal(
    shadowContinuityWarnings(
      '"回文今晚给你。"总督搁下茶盏。',
      "今晚给巡抚书吏一份回文。",
    ).some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"),
    false,
  );
  assert.ok(shadowContinuityWarnings(
    '总督道：“改桑放行回文在此。催办公文我留着，三日内另有处置。”',
    "只准清流县先办一批，并在放行回文里写明不得压价买田。",
  ).some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"));
  assert.ok(shadowContinuityWarnings(
    '总督看着亲随道：“你回去告诉县令，原册封好，不许任何人调阅。”',
    "暂不签发放行文书，留下巡抚书吏，同时核对密信中的县册疑点。",
  ).some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"));
  assert.equal(shadowContinuityWarnings(
    '总督对巡抚书吏道：“你先候着。”',
    "暂不签发放行文书，留下巡抚书吏，同时核对密信中的县册疑点。",
  ).some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"), false);
  assert.ok(shadowContinuityWarnings(
    "县令亲随低声道：商会前几日便托人问过编田的事。",
    "命亲随回县护住原册。",
    "亲随领命回县；不得新增其他角色行动。",
  ).some((warning) => warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"));
  assert.equal(shadowContinuityWarnings(
    '巡抚书吏躬身道：“中丞差卑职来取回文。大人暂缓签发，卑职回去不好交代。若总督大人要复核，请在三日限内书面回复。”\n\n他顿了顿，又说：“三日是朝廷的限期。”',
    "暂不签发放行文书，留下巡抚书吏，同时核对密信中的县册疑点。",
  ).some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"), false);
  assert.equal(shadowContinuityWarnings(
    '书吏捧匣的手没有动，低头道：“共同具名须中丞本人定夺。卑职无权代为答应，只能将总督的话原样带回。”',
    "请巡抚在放行回文上共同具名。",
  ).some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"), false);
  assert.equal(shadowContinuityWarnings(
    '巡抚幕僚抬眼看着总督，接着说道：“中丞要派员与总督一同查验清流县册，到场经过据实记入复核记录。”',
    "请巡抚在放行回文上共同具名。",
  ).some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"), false);
  assert.equal(shadowContinuityWarnings(
    '书吏道：“巡抚大人说，既准清流先办，复核须派员到场，查验经过要记入复核记录。”',
    "只准清流县先办一批。",
  ).some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"), false);
  assert.equal(shadowContinuityWarnings(
    '幕僚接着道：“这两条，总督大人还照办不照办？中丞都得替总督大人记着。”',
    "请巡抚在放行回文上共同具名。",
  ).some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"), false);
  const relayedSignatureRequest = "你把匣子里的回文带回去，请中丞在上面共同具名。";
  const signatureAction = "请巡抚在刚刚写成的改桑放行回文上共同具名。";
  assert.equal(shadowContinuityWarnings(
    `总督对书吏道：“${relayedSignatureRequest}”`,
    signatureAction,
  ).some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"), false);
  const requestWithExtraInstruction = [
    relayedSignatureRequest,
    "本督写了两条，中丞若觉得可行，便署个名。",
    "若觉得不可行，添上他的批语一并带回来。",
  ].join("");
  const extraInstructionWarnings = shadowContinuityWarnings(
    `总督对书吏道：“${requestWithExtraInstruction}”`,
    signatureAction,
  );
  const extraInstruction = extraInstructionWarnings.find(
    (warning) => warning.code === "PLAYER_ACTION_OVERREACH",
  );
  assert.ok(extraInstruction);
  const projectedSignatureRequest = projectPlayerSpeechToAuthorizedAction(
    `总督对书吏道：“${requestWithExtraInstruction}”`,
    signatureAction,
    String(extraInstruction.details?.action || ""),
  );
  assert.match(projectedSignatureRequest, /把匣子里的回文带回去，请中丞在上面共同具名/);
  assert.doesNotMatch(projectedSignatureRequest, /添上他的批语/);
  assert.equal(shadowContinuityWarnings(
    '总督看着幕僚，沉声道：“本督即刻派人启封县册。”',
    "请巡抚在放行回文上共同具名。",
  ).some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"), true);
  assert.ok(shadowContinuityWarnings(
    '巡抚书吏躬身道：“中丞还等着回话。”\n\n“中丞若问，便说总督正在核阅公文。”',
    "暂不签发放行文书，留下巡抚书吏，同时核对密信中的县册疑点。",
  ).some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"));
  const inventedCountyRelay = shadowContinuityWarnings(
    '总督转向县令亲随：“回去告诉你家县尊，先办一批，等后续公文。”',
    "只准清流县先办一批，并在给巡抚的改桑放行回文里写明不得趁急难压价买田。",
  );
  assert.ok(inventedCountyRelay.some((warning) => (
    warning.code === "PLAYER_COMMITMENT_WARNING"
    || warning.code === "PLAYER_ACTION_OVERREACH"
  )));
  assert.equal(shadowContinuityWarnings(
    '总督对亲随道：“回去告诉县令，把原册封存好。”',
    "命亲随回清流传令封存原册。",
  ).some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"), false);
  assert.ok(shadowContinuityWarnings(
    '舰长对轮机员道：“本舰长命你回去告诉领航员，保持航向，等后续航行令。”',
    "把已写成的航行令交给轮机员。",
  ).some((warning) => (
    warning.code === "PLAYER_COMMITMENT_WARNING"
    || warning.code === "PLAYER_ACTION_OVERREACH"
  )));
  const projectedNpcSpeech = projectExternalActorSpeechToAuthorizedMoves(
    '书吏道：“中丞说，复核时当许巡抚衙门派员到场，一同查验。到场经过，须据实记入复核记录，不得事后补录。”',
    "巡抚要求派员到场参与复核，并把到场查验经过据实记入复核记录。",
    "中丞说，复核时当许巡抚衙门派员到场，一同查验。到场经过，须据实记入复核记录，不得事后补录。",
    "record-timing",
  );
  assert.match(projectedNpcSpeech, /派员到场/u);
  assert.match(projectedNpcSpeech, /据实记入复核记录/u);
  assert.doesNotMatch(projectedNpcSpeech, /事后补录/u);
  assert.equal(projectExternalActorSpeechToAuthorizedMoves(
    '书吏道：“中丞说，不得事后补录。”',
    "巡抚要求派员到场参与复核。",
    "中丞说，不得事后补录。",
    "record-timing",
  ), "");
  const secondWorldNpcSpeech = projectExternalActorSpeechToAuthorizedMoves(
    '领航官道：“派员复核航线，跃迁经过须据实记入航行日志，不得事后补录。”',
    "领航官要求据实记录跃迁经过，并派员复核航线。",
    "派员复核航线，跃迁经过须据实记入航行日志，不得事后补录。",
    "record-timing",
  );
  assert.match(secondWorldNpcSpeech, /据实记入航行日志/u);
  assert.doesNotMatch(secondWorldNpcSpeech, /事后补录/u);
});

test("Sangtian normalizes only an incorrect governor vocative", () => {
  assert.equal(normalizeCanonicalRoleTerms(
    "书吏道：“敢请中堂示知复核范围。”旁人说内阁中堂仍在京师。",
    "sangtian",
    "zhejiang_governor",
  ), "书吏道：“敢请制台示知复核范围。”旁人说内阁中堂仍在京师。");
  assert.equal(normalizeCanonicalRoleTerms(
    "书吏道：“中丞，卑职奉命而来。中丞若要复核，请书面回复。”随后又道：“中丞说须三日具报。”",
    "sangtian",
    "zhejiang_governor",
  ), "书吏道：“制台，卑职奉命而来。制台若要复核，请书面回复。”随后又道：“中丞说须三日具报。”");
  assert.equal(normalizeCanonicalRoleTerms(
    "书吏道：“卑职不敢催中堂。”",
    "sangtian",
    "zhejiang_governor",
  ), "书吏道：“卑职不敢催制台。”");
  assert.equal(normalizeCanonicalRoleTerms(
    "书吏道：“须请中堂在三日期限内书面回复。”",
    "sangtian",
    "zhejiang_governor",
  ), "书吏道：“须请制台在三日期限内书面回复。”");
  assert.equal(normalizeCanonicalRoleTerms(
    "书吏道：“敢请中堂示知。”",
    "another-world",
    "zhejiang_governor",
  ), "书吏道：“敢请中堂示知。”");
});

test("backstage negative knowledge checklists are removed without rewriting natural restraint", () => {
  const narration = [
    "总督目光在薄信上停了一瞬，没有再问原册在何处、经手的是谁。",
    "亲随退回原位，巡抚书吏仍捧匣候着。",
  ].join("\n\n");
  const projected = projectBackstageConstraintSentence(narration);
  assert.doesNotMatch(projected, /原册在何处|经手的是谁/u);
  assert.match(projected, /亲随退回原位/u);
  assert.equal(
    projectBackstageConstraintSentence("总督没有再问。亲随退回原位。"),
    "",
  );
  assert.equal(
    projectBackstageConstraintSentence("总督问：原册在何处，经手的是谁？"),
    "",
  );
  assert.equal(
    projectBackstageConstraintSentence("总督没有解释为何不落印，也没有说后续何时补押。书吏仍在候着。"),
    "书吏仍在候着。",
  );
  assert.equal(
    projectBackstageConstraintSentence("纸上只有两条。没有写复核依据，没有写期限，没有写罚则。书吏仍在候着。"),
    "纸上只有两条。书吏仍在候着。",
  );
  assert.equal(
    projectBackstageConstraintSentence("纸上只写了两项。没有复核依据，没有执行细则，没有期限，没有罚则。书吏收匣候着。"),
    "纸上只写了两项。书吏收匣候着。",
  );
  assert.equal(
    projectBackstageConstraintSentence("密信只有报疑，没有原册，没有具结。书吏仍在候着。"),
    "",
  );
});

test("closed formal document extent is projected from its approved claim count", () => {
  const action = "写成改桑放行回文；正文只载两项：清流县先办一批；不得趁急难压价买田。";
  const narration = [
    "总督写得不多。十几行字，先写清流县先办一批，又添一行不得趁急难压价买田。",
    "写完，他把回文折好收入匣中。",
  ].join("\n\n");
  const projected = projectClosedFormalDocumentExtent(narration, action);
  assert.match(projected, /只写了两条/u);
  assert.doesNotMatch(projected, /十几行/u);
  assert.equal(validateDurableBoundary(
    projected,
    action,
    "",
    { protectedSubjects: [], allowedFormalArtifacts: ["改桑放行回文", "回文"] },
  ).ok, true);

  const quotedCount = projectClosedFormalDocumentExtent(
    "总督又添了“不得趁急难压价买田”八个字，随后搁笔。",
    action,
  );
  assert.match(quotedCount, /“不得趁急难压价买田”一句/u);
  assert.doesNotMatch(quotedCount, /八个字/u);

  const extraPolicy = projectClosedFormalDocumentExtent(
    "总督先写了十几行字，随后提笔写道：“清流县先办一批；不得趁急难压价买田；违者究治。”",
    action,
  );
  assert.equal(validateDurableBoundary(
    extraPolicy,
    action,
    "",
    { protectedSubjects: [], allowedFormalArtifacts: ["改桑放行回文", "回文"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");

  const secondWorld = projectClosedFormalDocumentExtent(
    "舰长写完数行字，将航行令交给轮机员。",
    "航行令中只载两项：保持航向；天亮前不得启用跃迁引擎。",
  );
  assert.match(secondWorld, /写完两行字/u);
});

test("settled closed document claims render deterministically when narration omits all of them", () => {
  const action = "写成改桑放行回文；正文只载两项：清流县先办一批；不得趁急难压价买田。";
  const omitted = [
    "总督提笔写得很快，十几息便搁了笔。",
    "他把回文折好，交给书吏收进匣中。",
  ].join("\n\n");
  const projected = projectClosedFormalDocumentClaims(omitted, action);
  assert.match(projected, /纸上只写了两项：清流县先办一批；不得趁急难压价买田/u);
  assert.equal(validateDurableBoundary(
    projected,
    action,
    "",
    { protectedSubjects: [], allowedFormalArtifacts: ["改桑放行回文", "回文"] },
  ).ok, true);

  assert.equal(projectClosedFormalDocumentClaims(
    "总督提笔写成回文，先写清流县先办一批，随后搁笔。",
    action,
  ), "");

  const spokenOutsideDocument = projectClosedFormalDocumentClaims(
    [
      "总督提笔写完责任说明，搁在自己手边。",
      "书吏道：\"若中丞有异议，须另行成文回应。\"",
    ].join("\n\n"),
    "责任说明中只写三项：巡抚要求派员参与复核；总督尚未同意；巡抚若有异议须另行成文并由督抚各自担责。",
  );
  assert.match(spokenOutsideDocument, /纸上只写了三项：巡抚要求派员参与复核；总督尚未同意；巡抚若有异议须另行成文并由督抚各自担责/u);

  const secondWorld = projectClosedFormalDocumentClaims(
    "舰长写完航行令，随即交给轮机员。",
    "航行令中只载两项：保持航向；天亮前不得启用跃迁引擎。",
  );
  assert.match(secondWorld, /纸上只写了两项：保持航向；天亮前不得启用跃迁引擎/u);
});

test("settled claim projection never repairs an already material but incorrect document", () => {
  const action = [
    "另具督抚责任说明。",
    "责任说明中只写三项：巡抚要求派员参与复核；总督尚未同意；巡抚若有异议须另行成文并由督抚各担其责。",
  ].join("\n");
  const incorrect = [
    "总督提笔写下三行。",
    "第一行：巡抚要求派员参与复核，总督尚未同意。",
    "第二行：巡抚若有异议须另行成文，不得以口传为据。",
    "第三行：督抚各担其责，复核主持权另议。",
  ].join("\n");
  assert.equal(projectClosedFormalDocumentClaims(incorrect, action), "");
  assert.equal(validateDurableBoundary(
    incorrect,
    action,
    "",
    { protectedSubjects: ["责任说明"], allowedFormalArtifacts: ["责任说明"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");
});

test("durable boundary blocks unsupported consequential facts but preserves narrative texture", () => {
  const sangtianPolicy = {
    protectedSubjects: ["粮价", "米行", "原册", "县册"],
    trackedLocations: ["清流", "清流县", "档房", "总督府"],
  };
  const known = "杭州米价连涨，已有米行闭门。原册仍在清流县档房，未经封存保护。";
  assert.equal(validateDurableBoundary(
    "三日期限已在公文上写明；总督若要复核，请在限内给巡抚衙门书面回复。",
    "暂不签发，核对密信。",
    "朝廷要求三日具报。",
    {
      protectedSubjects: ["期限"],
      trackedLocations: ["总督府", "巡抚衙门"],
    },
  ).warnings.some((warning) => warning.code === "UNSUPPORTED_DURABLE_LOCATION"), false);
  assert.equal(validateDurableBoundary(
    "总督把笺纸折作三折，交给亲随。灯影落在案角，亲随快步出了门。",
    "命亲随回清流传话封存原册。",
    known,
    sangtianPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "巡抚幕僚将一只封好的手帖推到案中，指尖压住帖角。",
    "请巡抚在放行回文上共同具名。",
    known,
    sangtianPolicy,
  ).reason, "UNAUTHORIZED_FORMAL_ARTIFACT");
  const attributedNote = validateDurableBoundary(
    "书吏从袖中取出一张小笺，平放在匣盖上。\n\n“这是中丞原话。”",
    "暂不签发，核对密信。",
    known,
    sangtianPolicy,
  );
  assert.equal(attributedNote.reason, "UNAUTHORIZED_FORMAL_ARTIFACT");
  assert.equal(validateDurableBoundary(
    "案上密信仍摊着，末尾没有具结。",
    "核对密信中的县册疑点。",
    "密信只报县册数字疑有改痕，不能据此定罪。",
    sangtianPolicy,
  ).reason, "UNSUPPORTED_DOCUMENT_AUTHENTICATION");
  assert.equal(validateDurableBoundary(
    "案上密信仍摊着，末尾没有具结。",
    "核对密信中的县册疑点。",
    "密信末尾没有具结，因此只能作为报疑线索。",
    sangtianPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督没有去拿巡抚公文末页那方朱印。",
    "暂不签发巡抚公文。",
    "巡抚公文仍在案前，朱印在砚边未动。",
    sangtianPolicy,
  ).reason, "UNSUPPORTED_DOCUMENT_AUTHENTICATION");
  assert.equal(validateDurableBoundary(
    "总督看了一眼巡抚公文末页那方朱印。",
    "暂不签发巡抚公文。",
    "巡抚公文末页已有朱印，但总督尚未另行落印。",
    sangtianPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "巡抚公文仍在案前，朱印在砚边未动。",
    "暂不签发巡抚公文。",
    "巡抚公文仍在案前，朱印在砚边未动。",
    sangtianPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督把巡抚公文按回案面，没有去碰砚台旁那方朱印。",
    "暂不签发巡抚公文。",
    "巡抚公文仍在案前，朱印在砚边未动。",
    sangtianPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "舰长把航行令压回案面，没有去碰控制台旁那枚印章。",
    "暂不签发航行令。",
    "航行令仍在舰长案前，印章单独放在控制台旁。",
    { protectedSubjects: ["航行令"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "星图边注没有签押，舰长暂不能确认来源。",
    "查看星图。",
    "星图边注的来源尚待核验。",
    { protectedSubjects: ["星图", "边注"] },
  ).reason, "UNSUPPORTED_DOCUMENT_AUTHENTICATION");
  assert.equal(projectUnsupportedIncidentalSentence(
    "书吏从袖中取出一张小笺，平放在匣盖上。\n\n“这是中丞原话。”",
    attributedNote.warnings[0]!,
  ), "");
  assert.equal(validateDurableBoundary(
    "书吏换手时，袖中露出一角空白小笺，随即又收了回去。",
    "暂不签发，核对密信。",
    known,
    sangtianPolicy,
  ).ok, true);
  const unverifiedMarketCount = validateDurableBoundary(
    "门房报称又有三家米行闭门，米价已涨三成七。",
    "命亲随回清流传话封存原册。",
    known,
    sangtianPolicy,
  );
  assert.equal(unverifiedMarketCount.ok, true);
  assert.ok(unverifiedMarketCount.warnings.some((warning) => (
    warning.code === "UNSUPPORTED_DURABLE_QUANTITY"
    && warning.blocksPlayer === false
    && warning.details?.disposition === "SHADOW_UNTIL_VERIFIED"
  )));
  assert.equal(validateDurableBoundary(
    "粮价仍在上涨，杭州城中已是人心浮动。",
    "请巡抚共同具名。",
    "杭州粮价正在上涨。",
    sangtianPolicy,
  ).reason, "UNSUPPORTED_SOCIAL_PRESSURE");
  assert.equal(validateDurableBoundary(
    "改桑书吏站在县令身后，怀里抱着一只册页匣。",
    "先决定县册原件和副本由谁呈到签押房。",
    "县册原件和副本尚未呈到签押房。",
    sangtianPolicy,
  ).reason, "UNAUTHORIZED_NEW_EVIDENCE");
  assert.equal(validateDurableBoundary(
    "总督追问：哪一年的原册，哪一页对不上？",
    "核对县册疑点。",
    known,
    sangtianPolicy,
  ).warnings.some((warning) => warning.code === "UNSUPPORTED_DURABLE_QUANTITY"), false);
  assert.equal(validateDurableBoundary(
    "亲随说原册一直没有人碰过。",
    "命亲随回清流传话封存原册。",
    known,
    sangtianPolicy,
  ).reason, "UNSUPPORTED_CUSTODY_ASSERTION");
  assert.equal(validateDurableBoundary(
    "亲随说原册仍在清流县档房，未敢擅动。",
    "暂不签发放行文书，先核对密信。",
    known,
    sangtianPolicy,
  ).reason, "UNSUPPORTED_CUSTODY_ASSERTION");
  assert.equal(validateDurableBoundary(
    "亲随说原册仍在清流，不敢离手。",
    "暂不签发放行文书，先核对密信。",
    known,
    sangtianPolicy,
  ).reason, "UNSUPPORTED_CUSTODY_ASSERTION");
  assert.equal(validateDurableBoundary(
    "亲随说原册仍在清流，未曾离县。",
    "暂不签发放行文书，先核对密信。",
    known,
    sangtianPolicy,
  ).reason, "UNSUPPORTED_CUSTODY_ASSERTION");
  assert.equal(validateDurableBoundary(
    "亲随只说原册仍在清流，别的情形并不知道。",
    "暂不签发放行文书，先核对密信。",
    "杭州米价连涨，已有米行闭门。原册没有随密信送来。",
    sangtianPolicy,
  ).reason, "UNSUPPORTED_DURABLE_LOCATION");
  const nearestLocationSubject = validateDurableBoundary(
    "亲随说密信只敢报疑，原册仍在清流，别的情形并不知道。",
    "暂不签发放行文书，先核对密信。",
    "杭州米价连涨，已有米行闭门。原册没有随密信送来。",
    { ...sangtianPolicy, protectedSubjects: [...sangtianPolicy.protectedSubjects, "密信"] },
  );
  assert.equal(nearestLocationSubject.reason, "UNSUPPORTED_DURABLE_LOCATION");
  assert.equal(nearestLocationSubject.warnings[0]?.details?.subject, "原册");
  assert.equal(nearestLocationSubject.warnings[0]?.details?.attributed, "true");
  const directCustodyAssertion = validateDurableBoundary(
    "清流县的册子还在百里之外，没有人碰过，也没有人看过。",
    "暂不签发放行文书，先核对密信。",
    "县令密信没有随信附原册。",
    {
      protectedSubjects: ["原册", "册子"],
      trackedLocations: ["清流", "清流县", "档房"],
    },
  );
  assert.equal(directCustodyAssertion.reason, "UNSUPPORTED_CUSTODY_ASSERTION");
  assert.equal(directCustodyAssertion.warnings[0]?.details?.attributed, "false");
  assert.equal(validateDurableBoundary(
    "亲随说原册仍在清流县档房，未敢擅动。",
    "暂不签发放行文书，先核对密信。",
    `${known} 县令具报原册仍在档房，未敢擅动。`,
    sangtianPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督命令不得知会县衙，也不要行文。",
    "命亲随回清流传话封存原册。",
    known,
    sangtianPolicy,
  ).reason, "UNAUTHORIZED_SECRECY_ORDER");
  assert.equal(validateDurableBoundary(
    "总督说回文须再候一日。",
    "给巡抚书吏一个暂缓答复。",
    "朝廷要求三日具报。",
    { protectedSubjects: [...sangtianPolicy.protectedSubjects, "回文", "具报"] },
  ).reason, "UNSUPPORTED_DURABLE_QUANTITY");
  assert.equal(validateDurableBoundary(
    "亲随退后一步，等着 dismissed。",
    "命亲随回清流。",
    known,
    { ...sangtianPolicy, forbidLatinWords: true },
  ).reason, "WORLD_LANGUAGE_MISMATCH");
  assert.equal(validateDurableBoundary(
    "总督从砚台下抽出密信，连同信封一并递还亲随。",
    "命亲随回清流传令封存原册。",
    known,
    { ...sangtianPolicy, protectedSubjects: [...sangtianPolicy.protectedSubjects, "密信"] },
  ).reason, "UNAUTHORIZED_DURABLE_TRANSFER");
  assert.equal(validateDurableBoundary(
    "总督把巡抚催办公文翻过来，在公文背面起稿，写成新的放行回文。",
    "另取空笺写成改桑放行回文。",
    "巡抚催办公文仍留在总督案前。",
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).reason, "UNAUTHORIZED_FORMAL_ARTIFACT_MUTATION");
  assert.equal(validateDurableBoundary(
    "舰长把旧航行令翻到背面，落笔写下新命令。",
    "另取空白记录纸写成新的航行令。",
    "旧航行令仍由舰长保管。",
    { protectedSubjects: ["航行令"], allowedFormalArtifacts: ["航行令", "命令"] },
  ).reason, "UNAUTHORIZED_FORMAL_ARTIFACT_MUTATION");
  assert.equal(validateDurableBoundary(
    "总督另取一页空笺，铺平后提笔写成回文。",
    "另取空笺写成改桑放行回文。",
    "巡抚催办公文仍留在总督案前。",
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督将密信折好递还亲随。",
    "把密信交给亲随带回清流。",
    known,
    { ...sangtianPolicy, protectedSubjects: [...sangtianPolicy.protectedSubjects, "密信"] },
  ).ok, true);
  const evidencePolicy = {
    ...sangtianPolicy,
    protectedSubjects: [...sangtianPolicy.protectedSubjects, "密信"],
    evidenceSubjects: ["密信", "信纸", "信上"],
  };
  assert.equal(validateDurableBoundary(
    "信纸上只有几行字，连“改痕”二字的依据也只写了“比对往年册数，出入不合”一句。",
    "问亲随县册经手人是谁、目前是否还在任上。",
    "密信只说县册数字似有改痕，不敢断言是谁动的手。",
    evidencePolicy,
  ).reason, "UNSUPPORTED_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "总督问：“你家县尊信上写‘似有改痕’，是报疑还是已经查实？”",
    "核对密信中指出的县册疑点。",
    "密信只说县册数字似有改痕，不敢断言是谁动的手。",
    evidencePolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督目光落回密信，信上确实只写了“合计与册尾不符”这一句。",
    "核对密信中指出的县册疑点。",
    "清流县令声称，将册内分户田数逐项相加，所得合计与册尾所列总数不符。",
    evidencePolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "信末只有“不敢妄断”四字收尾。",
    "核对密信中指出的县册疑点。",
    "密信只说县册数字似有改痕，不敢断言是谁动的手。",
    { ...evidencePolicy, evidenceSubjects: [...evidencePolicy.evidenceSubjects, "信末"] },
  ).reason, "UNSUPPORTED_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "总督把密信压在案上，对亲随道：“先把经手人的去向问清楚。”",
    "问亲随县册经手人是谁、目前是否还在任上。",
    "密信只说县册数字似有改痕，不敢断言是谁动的手。",
    evidencePolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    [
      "密信只说清流县册中田亩总数与各里花户实报之数合计不符，墨色浓淡亦有可疑之处。",
      "下面的落款是县令亲笔，又押了私章。",
      "亲随说，各里花户旧册与新造册对不上。",
    ].join("\n\n"),
    "核对密信中指出的县册疑点。",
    "密信只说县册数字似有改痕，不敢断言是谁动的手。",
    evidencePolicy,
  ).reason, "UNSUPPORTED_EVIDENCE_DETAIL");
  assert.equal(validateDurableBoundary(
    "总督指着密信问：“改的是总数，还是分户之数？墨色是否有异？”亲随答：“小的不知。”",
    "核对密信中指出的县册疑点。",
    "密信只说县册数字似有改痕，不敢断言是谁动的手。",
    evidencePolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督把墨迹未干的催办公文压回案角，窗风掀了一下纸边。",
    "写成改桑放行回文。",
    "巡抚催办公文仍在总督案前。",
    { ...evidencePolicy, evidenceSubjects: ["催办公文", "公文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "公文上的字迹比寻常小了半号，像是刻意省纸。",
    "写成改桑放行回文。",
    "改桑放行回文正在写成。",
    { ...evidencePolicy, evidenceSubjects: ["公文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "公文上的字迹像是县令亲笔所书。",
    "写成改桑放行回文。",
    "尚未鉴定公文笔迹。",
    { ...evidencePolicy, evidenceSubjects: ["公文"] },
  ).reason, "UNSUPPORTED_EVIDENCE_DETAIL");
  assert.equal(validateDurableBoundary(
    "总督比对催办公文前后两页，发现墨迹浓淡不同，由此怀疑有人换过末页。",
    "写成改桑放行回文。",
    "巡抚催办公文仍在总督案前，未作笔墨鉴定。",
    { ...evidencePolicy, evidenceSubjects: ["催办公文", "公文"] },
  ).reason, "UNSUPPORTED_EVIDENCE_DETAIL");
  assert.equal(validateDurableBoundary(
    "催办公文纸边压着密信，露出清流县印的一角红。",
    "暂不签发放行文书，先核对密信。",
    "密信只报疑，原册没有随信送来。",
    { ...evidencePolicy, evidenceSubjects: ["密信"] },
  ).reason, "UNSUPPORTED_DOCUMENT_AUTHENTICATION");
  assert.equal(validateDurableBoundary(
    "总督感到案前这两封纸之间的分量正在此消彼长：催办的期限不会等人，而原册还在远处。",
    "暂不签发放行文书，先核对密信。",
    known,
    evidencePolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "公文纸角压着密信边沿，两份纸摞在一起，都没动。",
    "暂不签发放行文书，先核对密信。",
    known,
    evidencePolicy,
  ).warnings.some((warning) => warning.code === "UNSUPPORTED_DURABLE_QUANTITY"), false);
  assert.equal(validateDurableBoundary(
    "案上另有两份密信，压在公文下面。",
    "暂不签发放行文书，先核对密信。",
    known,
    evidencePolicy,
  ).warnings.some((warning) => warning.code === "UNSUPPORTED_DURABLE_QUANTITY"), true);
  assert.equal(validateDurableBoundary(
    "航行令旁叠着两份纸，舱灯照在纸角。",
    "继续核对航行令。",
    "航行令已经在案。",
    { protectedSubjects: ["航行令"] },
  ).warnings.some((warning) => warning.code === "UNSUPPORTED_DURABLE_QUANTITY"), false);
  assert.equal(validateDurableBoundary(
    "总督从案角把巡抚催办公文翻过来，研墨时砚台里水已半干，他添了几滴，墨色才匀。",
    "写成改桑放行回文。",
    known,
    evidencePolicy,
  ).ok, true);
  const boundedReplyAction = [
    "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。",
    "浙江总督当场提笔写成名为“改桑放行回文”的文书，文中只写清流县先办一批和不得趁急难压价买田；写成后交给巡抚书吏。",
  ].join("\n");
  assert.equal(validateDurableBoundary(
    [
      "总督提笔写道：“清流县先办第一批待改田亩，其余各县候总督衙门另行札文，不得抢先动手。”",
      "笔尖一顿，又落下一行：“改桑以自愿为本。田价照市估折算，不得以急难为由压价强买。违者由总督衙门拿问。”",
    ].join("\n"),
    boundedReplyAction,
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "总督提笔写道：“清流县先办第一批，不得以急难为由压价强买。”写成后便将这份改桑放行回文交给巡抚书吏。",
    boundedReplyAction,
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督提笔写得不快。先一行抬头，再两行正文——清流县准先办第一批改桑田亩；不得趁急难压价买田。写完便将改桑放行回文交给巡抚书吏。",
    [
      boundedReplyAction,
      "改桑放行回文正文只载两项：清流县先办一批；不得趁急难压价买田。不得增加其他条款。",
    ].join("\n"),
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    [
      "总督提笔写下两行：清流县准先行改桑一批；不得趁急难压价买田。再没有第三行，他通看一遍，将回文折好交给书吏。",
      "旧催办公文仍摊在案上，三日具报的墨字朝上。",
    ].join("\n\n"),
    [
      boundedReplyAction,
      "改桑放行回文正文只载两项：清流县先办一批；不得趁急难压价买田。不得增加其他条款。",
    ].join("\n"),
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(shadowContinuityWarnings(
    "旧催办公文上三日具报的墨字朝上；总督目光停了一息，便移开了。",
    "写成改桑放行回文。",
    "巡抚书吏催问三日具报期限。",
  ).some((warning) => warning.code === "NARRATIVE_TEXTURE_PROMOTED_TO_CAUSAL_FACT"), false);
  assert.equal(validateDurableBoundary(
    [
      "总督写完回文，纸上只两行话：清流县先办一批；不得趁急难压价买田。",
      "书吏捧匣站着。总督搁下笔，靠回椅背。",
      "书吏道：中丞以为，既已放行清流先办，巡抚衙门当派员参与复核。",
    ].join("\n\n"),
    [
      "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。",
      "改桑放行回文正文只载两项：清流县先办一批；不得趁急难压价买田。不得增加其他条款。",
    ].join("\n"),
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督写下两行：清流县先办一批改桑田亩，其余各县候核后再行。改桑所涉民田，不得趁急难压价买田。写完便将改桑放行回文交给巡抚书吏。",
    [
      "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。",
      "改桑放行回文正文只载两项：清流县先办一批；不得趁急难压价买田。不得增加其他条款。",
    ].join("\n"),
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督另起一行写道：“改桑放行期间，不得趁急难压价买田。”写完便将改桑放行回文交给巡抚书吏。",
    [
      "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。",
      "改桑放行回文正文只载两项：清流县先办一批；不得趁急难压价买田。不得增加其他条款。",
    ].join("\n"),
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  const responsibilityAction = [
    "写成督抚责任说明。",
    "责任说明中只写三项：巡抚要求派员参与复核；总督对此尚未同意；巡抚若有异议须另行成文并由督抚各自担责。",
  ].join("\n");
  const crossDocumentReference = validateDurableBoundary(
    [
      "总督提笔写下三行：巡抚衙门要求派员参与复核；总督尚未同意此请；巡抚若有异议须另行成文，督抚各担其责。",
      "幕僚问：‘部堂回文中又写明不得趁急难压价买田，这一条是否仍照办？’",
    ].join("\n\n"),
    responsibilityAction,
    "改桑放行回文只准清流县先办一批，并写明不得趁急难压价买田。",
    { ...sangtianPolicy, allowedFormalArtifacts: ["责任说明", "回文"] },
  );
  assert.equal(crossDocumentReference.ok, true, JSON.stringify(crossDocumentReference));
  assert.equal(validateDurableBoundary(
    "总督在责任说明中另写：巡抚须派员封存原册。",
    responsibilityAction,
    "",
    { ...sangtianPolicy, allowedFormalArtifacts: ["责任说明"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "总督对书吏说：“回文里另写了一层——不得趁急难压价买田。民田作价，须照平日市值。”",
    [
      "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。",
      "改桑放行回文正文只载两项：清流县先办一批；不得趁急难压价买田。不得增加其他条款。",
    ].join("\n"),
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    [
      "总督提笔写了十几行。写完，他将纸面看了一遍。",
      "纸面上只两段话：清流县先办一批改桑田亩，余县候批；各府县改桑买田须照市价估收，不得以灾急压折田价。",
    ].join("\n\n"),
    [
      "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。",
      "改桑放行回文正文只载两项：清流县先办一批；不得趁急难压价买田。不得增加其他条款。",
    ].join("\n"),
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "巡抚幕僚说杭州米铺比前日又贵了三分。",
    "眼前粮价只能定性写成正在上涨，不得另造精确数字或数量。",
    "杭州米价正在上涨。",
    sangtianPolicy,
  ).reason, "UNSUPPORTED_DURABLE_QUANTITY");
  assert.equal(validateDurableBoundary(
    "总督写得不多。清流县先办一批改桑，其余各县候批。末后另起一行，添了一句：不得趁急难压价买田，违者究治。",
    boundedReplyAction,
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "写得不多。先一行：清流县先办一批，余县待核。再一行：不得趁急难压价买田。笔锋在田字末笔收住，没有拖出多余墨痕。",
    boundedReplyAction,
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督提笔写了几行便搁笔。他把纸递给书吏，只说：“回文匣里收了。原催办仍留本督案前。”",
    boundedReplyAction,
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "巡抚书吏当面说明：“小人只能记下总督另具责任说明这件事，无权代中丞认可其中主张。”",
    "只写这项已经结算的 NPC 反应，不增加其尚未知晓的事实、文书内容、期限、命令、承诺或场外结果。",
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督写成督抚责任说明，正文只列三项：“巡抚要求就清流县田册复核派员到场参与；总督对此尚未同意；巡抚若有异议，须另行成文，督抚各担其责。”",
    "另具督抚责任说明；责任说明中只写三项：巡抚要求派员参与复核、总督对此尚未同意、巡抚若有异议须另行成文并由督抚各自担责。",
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文", "督抚责任说明"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督写完十几行字，将改桑放行回文折好收入匣中。",
    "写成改桑放行回文；正文只载两项：清流县先办一批；不得趁急难压价买田。",
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文", "改桑放行回文"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "总督写完两行字，将改桑放行回文折好收入匣中。",
    "写成改桑放行回文；正文只载两项：清流县先办一批；不得趁急难压价买田。",
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文", "改桑放行回文"] },
  ).ok, true);
  const replyTexturePolicy = {
    ...sangtianPolicy,
    evidenceSubjects: ["公文", "回文"],
    existingEvidenceSubjects: ["公文"],
    allowedFormalArtifacts: ["公文", "回文"],
    incidentalTextureAllowances: [{
      textureClass: "CREATION_SUBSTRATE" as const,
      lifecycle: "CONSUMED_INTO_TARGET" as const,
      targetEntityKind: "DOCUMENT" as const,
      targetEntityRef: "DOC-REPLY-01",
      targetEntityLabel: "改桑放行回文",
    }],
  };
  assert.equal(validateDurableBoundary(
    "总督将公文纸吹了吹，对折，再对折，压平折痕，写成的回文仍放在案上。",
    "签发改桑放行回文，只准清流县先办一批。",
    known,
    replyTexturePolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "书吏沿折痕把新写的公文纸收好，放入匣中。",
    "写成改桑放行回文并交给书吏收匣。",
    "巡抚催办公文仍留在总督案前。",
    { ...sangtianPolicy, evidenceSubjects: ["公文", "回文"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "亲随像在心里默念了一遍才开口：县尊说，分户田数逐项相加与册尾总数不符。",
    "只核对密信报疑；不得补出具体田亩数、差额或核验次数。",
    "亲随只知道分户田数逐项相加与册尾总数不符。",
    { ...sangtianPolicy, evidenceSubjects: ["县册", "分户田数", "册尾总数"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "亲随说，县尊已经核过三遍，分户田数仍与册尾总数不符。",
    "只核对密信报疑；不得补出具体田亩数、差额或核验次数。",
    "亲随只知道分户田数逐项相加与册尾总数不符。",
    { ...sangtianPolicy, evidenceSubjects: ["县册", "分户田数", "册尾总数"] },
  ).reason, "UNSUPPORTED_DURABLE_QUANTITY");
  assert.equal(validateDurableBoundary(
    "总督看见回文旧折痕与案前公文相同，由此断定它曾被人调换。",
    "签发改桑放行回文，只准清流县先办一批。",
    known,
    replyTexturePolicy,
  ).reason, "UNSUPPORTED_EVIDENCE_DETAIL");

  const secondWorldPolicy = {
    protectedSubjects: ["星图", "议会库存"],
    evidenceSubjects: ["星图", "边注"],
    trackedLocations: ["观测舱", "舰桥", "议会库"],
  };
  assert.equal(validateDurableBoundary(
    "舰长把目光移向合拢的星图匣，舱灯在他袖口暗了一暗。",
    "命守卫封存星图。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).ok, true);
  const unverifiedReactorCount = validateDurableBoundary(
    "轮机员隔着舱门报称，反应堆温度已经升到九百七十三度。",
    "命守卫封存星图。",
    "反应堆温度正在上升，但尚无可靠读数。",
    { ...secondWorldPolicy, protectedSubjects: [...secondWorldPolicy.protectedSubjects, "反应堆温度"] },
  );
  assert.equal(unverifiedReactorCount.ok, true);
  assert.ok(unverifiedReactorCount.warnings.some((warning) => (
    warning.code === "UNSUPPORTED_DURABLE_QUANTITY"
    && warning.blocksPlayer === false
  )));
  assert.equal(validateDurableBoundary(
    "总督没有立刻答幕僚那句问，只把目光移回案上。",
    "继续听巡抚幕僚说话。",
    "巡抚幕僚正在当面追问。",
    { protectedSubjects: [] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "幕僚须记明在案；县令应当面说明，书吏只在一旁候着。",
    "继续听各方说明。",
    "幕僚、县令和书吏都已在场。",
    { protectedSubjects: [] },
  ).ok, true);
  const expandedSealProcedure = shadowContinuityWarnings(
    [
      "总督道：\"原册仍留清流县档房，当场换新封条，三方各留封样。\"",
      "他又道：\"封样由本督拟定格式，三日内随复核清单一同发下；开册时三方同在，缺一不开。\"",
    ].join("\n"),
    "原册留在档房，换新封条；总督、县令、巡抚三方各留封样。",
  );
  assert.ok(expandedSealProcedure.some((warning) => (
    warning.code === "PLAYER_ACTION_OVERREACH" && warning.blocksPlayer === true
  )));
  const authorizedNpcMove = [
    "浙江巡抚通过巡抚书吏要求派员到场参与复核，",
    "并在复核发生后把到场查验经过据实记入复核记录。",
  ].join("");
  assert.equal(shadowContinuityWarnings(
    "书吏转述：中丞要求派员到场参与复核，查验经过据实记入复核记录。",
    "维持原回文不改。",
    authorizedNpcMove,
  ).some((warning) => warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"), false);
  assert.equal(shadowContinuityWarnings(
    "中丞吩咐卑职转禀：复核时须派员到场参与查验，到场经过据实记入复核记录。",
    "写成改桑放行回文。",
    authorizedNpcMove,
  ).some((warning) => warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"), false);
  const establishedParticipation = "书吏转述：中丞要求巡抚衙门派员到场参与复核，查验经过据实记入复核记录。";
  assert.equal(shadowContinuityWarnings(
    "巡抚幕僚道：中丞的意思，复核时巡抚衙门须派员到场。",
    "另具督抚责任说明。",
    "巡抚幕僚以三日期限和粮价向总督施压。",
    establishedParticipation,
  ).some((warning) => warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"), false);
  assert.ok(shadowContinuityWarnings(
    "巡抚幕僚道：中丞的意思，须派员封存清流县档房。",
    "另具督抚责任说明。",
    "巡抚幕僚以三日期限和粮价向总督施压。",
    establishedParticipation,
  ).some((warning) => warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"));
  assert.equal(shadowContinuityWarnings(
    "巡抚书吏单手托匣，一手来接，指节碰到纸边时顿了一瞬——纸上没有印，也没有签押。",
    "把写成的回文交给巡抚书吏。",
    "巡抚书吏仍在内厅候取答复。",
  ).some((warning) => warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"), false);
  assert.ok(shadowContinuityWarnings(
    "巡抚书吏当场替巡抚签押，又把回文收入匣中。",
    "把写成的回文交给巡抚书吏。",
    "巡抚书吏仍在内厅候取答复。",
  ).some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.details?.axis === "sign"
  )));
  assert.ok(shadowContinuityWarnings(
    "巡抚幕僚说：中丞已将三日之限报部。",
    "维持回文不改，督抚各自担责。",
    "巡抚幕僚以三日限期和正在上涨的粮价向总督施压。",
  ).some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.details?.axis === "report"
  )));
  assert.equal(shadowContinuityWarnings(
    "巡抚那封催办公文仍摊在案角，首页朝上，三日具报几个字看得清楚。",
    "写成改桑放行回文。",
    "浙江巡抚通过巡抚书吏要求派员到场参与复核。",
  ).some((warning) => warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"), false);
  assert.equal(shadowContinuityWarnings(
    "巡抚书吏道：“中丞催办在前，三日具报是朝廷的限期。”",
    "暂不签发放行文书。",
    "巡抚书吏催问暂缓缘由，并要求三日内书面说明复核范围与方式。",
  ).some((warning) => warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"), false);
  const clerkAuthorshipWarnings = shadowContinuityWarnings(
    "巡抚书吏道：“请部堂给一句话，卑职好写进回文带回去。”",
    "暂不签发放行文书。",
    "巡抚书吏催问暂缓缘由，并要求三日内书面说明复核范围与方式。",
  );
  assert.ok(clerkAuthorshipWarnings.some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.details?.axis === "document-author"
  )));
  assert.equal(shadowContinuityWarnings(
    "巡抚书吏道：“请部堂给一句话，卑职好原样带回去。”",
    "暂不签发放行文书。",
    "巡抚书吏催问暂缓缘由，并要求三日内书面说明复核范围与方式。",
  ).some((warning) => warning.details?.axis === "document-author"), false);
  const secondWorldAuthorshipWarnings = shadowContinuityWarnings(
    "轮机员道：“我来改写航行令，稍后交给舰长。”",
    "维持当前航向。",
    "轮机员追问由谁承担误期责任。",
  );
  assert.ok(secondWorldAuthorshipWarnings.some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.details?.axis === "document-author"
  )));
  assert.ok(shadowContinuityWarnings(
    "总督对书吏说：“清流先办，我自会行文县里。”",
    "只在改桑放行回文中写明清流县先办一批。",
    "浙江巡抚通过巡抚书吏要求派员到场参与复核。",
  ).some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"));
  const playerReportWarnings = shadowContinuityWarnings(
    "总督对书吏说：“其余的，你回去禀中丞，我自会具报。”",
    "只在改桑放行回文中写明清流县先办一批。",
    "浙江巡抚通过巡抚书吏要求派员到场参与复核。",
  );
  assert.equal(playerReportWarnings.some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
  )), false);
  assert.ok(playerReportWarnings.some((warning) => (
    /PLAYER_(?:COMMITMENT_WARNING|ACTION_OVERREACH)/u.test(warning.code)
  )));
  assert.ok(shadowContinuityWarnings(
    "总督对书吏说：“你家中丞若觉得这条碍事，让他自己来跟我说。”",
    "只在改桑放行回文中写明清流县先办一批。",
    "浙江巡抚通过巡抚书吏要求派员到场参与复核。",
  ).some((warning) => (
    warning.code === "PLAYER_ACTION_OVERREACH"
    && String(warning.details?.action || "").includes("让他自己来")
  )));
  assert.ok(shadowContinuityWarnings(
    "书吏转述：中丞要求派员到场参与复核，查验经过须双方画押存档。",
    "维持原回文不改。",
    authorizedNpcMove,
  ).some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.blocksPlayer === true
    && warning.details?.axis === "sign"
  )));
  assert.ok(shadowContinuityWarnings(
    "书吏转述：中丞要求派员到场参与复核，复核记录由双方书吏同签。",
    "维持原回文不改。",
    authorizedNpcMove,
  ).some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.details?.axis === "sign"
  )));
  assert.ok(shadowContinuityWarnings(
    "书吏转述：中丞要求派员到场参与复核，查验经过要与册档一同存查。",
    "维持原回文不改。",
    authorizedNpcMove,
  ).some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.blocksPlayer === true
    && warning.details?.axis === "archive"
  )));
  assert.ok(shadowContinuityWarnings(
    "书吏道：“中丞说，复核时巡抚衙门要派员到场。查验经过，须据实记入复核记录，与总督衙门一并存档。”",
    "写成改桑放行回文。",
    authorizedNpcMove,
  ).some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.details?.axis === "archive"
  )));
  const continuedNpcSpeech = shadowContinuityWarnings(
    [
      "书吏开口道：“中丞还有一层意思，卑职不敢不转。”",
      "总督抬眼看他。",
      "“中丞的意思，巡抚衙门当派员到场，与总督所委之员一同查验。查验经过，双方画押存档。”",
    ].join("\n\n"),
    "写成改桑放行回文。",
    authorizedNpcMove,
  );
  assert.equal(continuedNpcSpeech.some((warning) => (
    /PLAYER_(?:ACTION_OVERREACH|COMMITMENT_WARNING)/u.test(warning.code)
  )), false);
  assert.ok(continuedNpcSpeech.some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && /(?:sign|archive)/u.test(String(warning.details?.axis || ""))
  )));
  assert.ok(shadowContinuityWarnings(
    "书吏转述：中丞要求派员到场参与复核，查验经过不得事后补录。",
    "维持原回文不改。",
    authorizedNpcMove,
  ).some((warning) => (
    warning.code === "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE"
    && warning.details?.axis === "record-timing"
  )));
  assert.ok(shadowContinuityWarnings(
    "幕僚说总督昨日写回文时停过笔，这份迟疑也要记入追责。",
    "另具督抚责任说明。",
    "巡抚幕僚要求参加复核，并把总督此前的政策迟疑记作可能耽误国策的理由。",
  ).some((warning) => warning.code === "NARRATIVE_TEXTURE_PROMOTED_TO_CAUSAL_FACT"));
  assert.equal(shadowContinuityWarnings(
    "幕僚看见总督停了笔，神色微微一动，没有开口。",
    "另具督抚责任说明。",
    "巡抚幕僚要求参加复核。",
  ).some((warning) => warning.code === "NARRATIVE_TEXTURE_PROMOTED_TO_CAUSAL_FACT"), false);
  assert.equal(shadowContinuityWarnings(
    [
      "总督把目光从匣子上移开，落到案前催办公文上。",
      "书吏道：‘中丞要求派员参与复核，查验经过据实记入复核记录。’",
    ].join("\n\n"),
    "写成改桑放行回文。",
    authorizedNpcMove,
  ).some((warning) => warning.code === "NARRATIVE_TEXTURE_PROMOTED_TO_CAUSAL_FACT"), false);
  assert.equal(shadowContinuityWarnings(
    "舰长把目光从星图上移开。领航官随后要求把航迹记入记录。",
    "继续听领航官说明。",
    "领航官要求把航迹记入记录。",
  ).some((warning) => warning.code === "NARRATIVE_TEXTURE_PROMOTED_TO_CAUSAL_FACT"), false);
  const introducedHandNote = validateDurableBoundary(
    "巡抚幕僚先把一纸手札放在案沿，再开口。",
    "继续商议复核主持权。",
    "巡抚幕僚已经在场。",
    { protectedSubjects: [] },
  );
  assert.equal(introducedHandNote.ok, false);
  assert.equal(introducedHandNote.reason, "UNAUTHORIZED_FORMAL_ARTIFACT");
  assert.equal(validateDurableBoundary(
    "清流县令赵孟远站在案左，改桑书吏吴世泽在案右候着。",
    "转到签押房议事。",
    "在场者只有清流县令、改桑书吏和巡抚幕僚；尚未建立任何姓名。",
    { protectedSubjects: [] },
  ).reason, "UNAUTHORIZED_NAMED_CHARACTER");
  assert.equal(validateDurableBoundary(
    "舰长将星图卷成三折，交给守卫。",
    "命守卫封存星图。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "舰长说 proceed，守卫随即封存星图。",
    "命守卫封存星图。",
    "星图已经取出，仍待封存。",
    { ...secondWorldPolicy, forbidLatinWords: false },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "舰长又命守卫不得通知议会。",
    "命守卫封存星图。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).reason, "UNAUTHORIZED_SECRECY_ORDER");
  assert.equal(validateDurableBoundary(
    "舰长提笔写道：“本舰前往北辰，并将议会库存改作军备。”",
    "在航行令中只写前往北辰。",
    "舰桥正在等待航向命令。",
    { ...secondWorldPolicy, allowedFormalArtifacts: ["航行令"] },
  ).reason, "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "舰长写成航行令，将纸张对折压平，折痕留在新写的命令上。",
    "签发航行令，命本舰前往北辰。",
    "舰桥正在等待航向命令。",
    {
      ...secondWorldPolicy,
      evidenceSubjects: ["航行令", "纸张"],
      allowedFormalArtifacts: ["航行令"],
      incidentalTextureAllowances: [{
        textureClass: "CREATION_SUBSTRATE",
        lifecycle: "CONSUMED_INTO_TARGET",
        targetEntityKind: "DOCUMENT",
        targetEntityRef: "NAV-ORDER-01",
        targetEntityLabel: "航行令",
      }],
    },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "轮机员沿折痕收好新写的航行令。",
    "舰长写成航行令并交给轮机员。",
    "旧航行令仍在档案柜中。",
    { ...secondWorldPolicy, evidenceSubjects: ["航行令"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "星图边注写着“北辰偏移三度”。",
    "命守卫封存星图。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).reason, "UNSUPPORTED_DOCUMENT_CONTENT");
  assert.equal(validateDurableBoundary(
    "星图末页有一道水印，卷角还留着刮擦痕迹。",
    "命守卫封存星图。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).reason, "UNSUPPORTED_EVIDENCE_DETAIL");
  assert.equal(validateDurableBoundary(
    "星图末页的一道水印仍然清楚。",
    "命守卫封存星图。",
    "观测员已经确认星图末页存在一道水印。",
    secondWorldPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "守卫说星图原封未动。",
    "命守卫封存星图。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).reason, "UNSUPPORTED_CUSTODY_ASSERTION");
  assert.equal(validateDurableBoundary(
    "守卫说星图仍在观测舱。",
    "命守卫封存星图。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).reason, "UNSUPPORTED_DURABLE_LOCATION");
  assert.equal(validateDurableBoundary(
    "守卫说星图仍在观测舱。",
    "命守卫封存星图。",
    "星图仍在观测舱，等待舰长处置。",
    secondWorldPolicy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "舰长问：“星图现在何处？”守卫答：“还在观测舱。”",
    "只问星图现在何处。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).reason, "UNSUPPORTED_DURABLE_LOCATION");
  assert.equal(validateDurableBoundary(
    "舰长问：“星图是谁核验的？”守卫答：“观测员比对过两遍。”",
    "只问星图由谁核验。",
    "星图已经取出，仍待封存。",
    secondWorldPolicy,
  ).reason, "UNSUPPORTED_DURABLE_QUANTITY");
  assert.equal(validateDurableBoundary(
    "亲随又领进一个账房，自称王三福。",
    "继续问亲随原册去向。",
    known,
    sangtianPolicy,
  ).reason, "UNAUTHORIZED_NAMED_CHARACTER");
  assert.equal(validateDurableBoundary(
    "总督当即取出一支令箭，交给门下。",
    "继续问亲随原册去向。",
    known,
    { ...sangtianPolicy, allowedFormalArtifacts: ["公文", "回文"] },
  ).reason, "UNAUTHORIZED_FORMAL_ARTIFACT");
  assert.equal(validateDurableBoundary(
    "亲随忽然从袖中呈上一份田契副本。",
    "继续问亲随原册去向。",
    known,
    { ...sangtianPolicy, existingEvidenceSubjects: ["原册", "县册"] },
  ).reason, "UNAUTHORIZED_NEW_EVIDENCE");
  assert.equal(validateDurableBoundary(
    "亲随说，县令翻对时发现几处田数与户房底稿对不上。",
    "核对密信中的县册疑点。",
    "密信只说县册数字似有改痕。",
    { ...evidencePolicy, existingEvidenceSubjects: ["密信", "县册", "原册"] },
  ).reason, "UNAUTHORIZED_NEW_EVIDENCE");
  assert.equal(validateDurableBoundary(
    "密信没有随附底稿，亲随也说不知底稿在何处。",
    "核对密信中的县册疑点。",
    "密信只说县册数字似有改痕。",
    { ...evidencePolicy, existingEvidenceSubjects: ["密信", "县册", "原册"] },
  ).ok, true);
  assert.equal(validateDurableBoundary(
    "总督问：“可曾另抄副本？”亲随答：“不曾。县尊只恐副本先动，反误了原件。”",
    "核对密信中的县册疑点。",
    "亲随只知道密信报疑、原册没有随信送来。",
    { ...evidencePolicy, existingEvidenceSubjects: ["密信", "县册", "原册"] },
  ).reason, "UNSUPPORTED_EVIDENCE_EXISTENCE");
  assert.equal(validateDurableBoundary(
    "总督问：“可曾另抄副本？”亲随答：“小的不知。”",
    "核对密信中的县册疑点。",
    "亲随只知道密信报疑、原册没有随信送来。",
    { ...evidencePolicy, existingEvidenceSubjects: ["密信", "县册", "原册"] },
  ).ok, true);
});

test("knowledge boundary blocks invented names while unverified access topology stays in shadow", () => {
  const policy = {
    protectedSubjects: ["县册", "原册"],
    evidenceSubjects: ["县册", "原册"],
    existingEvidenceSubjects: ["县册", "原册"],
    trackedLocations: ["档房"],
  };
  const context = "亲随只知道县令报疑、原册没有随信送来，不能提供不存在的经手人或保管证据。";
  const inventedName = validateDurableBoundary(
    "亲随答道，档房向来由县衙经承书办沈聚看管，出入登簿。",
    "问亲随县档房现由何人值守、钥匙经手情况。",
    context,
    policy,
  );
  assert.equal(inventedName.ok, false);
  assert.equal(inventedName.reason, "UNAUTHORIZED_NAMED_CHARACTER");

  const inventedKeys = validateDurableBoundary(
    "亲随答道，档房正门钥匙一把在书办手里，一把由知县保管。",
    "问亲随县档房现由何人值守、钥匙经手情况。",
    context,
    policy,
  );
  assert.equal(inventedKeys.ok, true);
  assert.equal(inventedKeys.reason, "UNSUPPORTED_EVIDENCE_ACCESS_DETAIL");
  assert.ok(inventedKeys.warnings.some((warning) => (
    warning.code === "UNSUPPORTED_EVIDENCE_ACCESS_DETAIL"
    && warning.blocksPlayer === false
    && warning.details?.disposition === "SHADOW_UNTIL_VERIFIED"
  )));

  const honestUnknown = validateDurableBoundary(
    "亲随低头答道：“值守何人，小的不知；钥匙经谁的手，也未曾问过。”",
    "问亲随县档房现由何人值守、钥匙经手情况。",
    context,
    policy,
  );
  assert.equal(honestUnknown.ok, true);

  const explicitUnverified = validateDurableBoundary(
    "总督心里明白，档房什么人在管，钥匙谁收着，封条还在不在，他一样都还没有核实。",
    "核对密信已知边界。",
    context,
    policy,
  );
  assert.equal(explicitUnverified.ok, true);

  const directQuestion = validateDurableBoundary(
    "总督问：“档房钥匙在谁手里？”亲随答：“小人不知。”",
    "询问档房钥匙经手情况。",
    context,
    policy,
  );
  assert.equal(directQuestion.ok, true);
  const locationQuestion = validateDurableBoundary(
    "总督问：“你说县册仍在清流县档房？”亲随低头候答。",
    "核对密信中的县册疑点。",
    "亲随可以转述县令声称原册仍在清流县档房，但未经独立核实。",
    {
      ...policy,
      protectedSubjects: ["县册", "原册"],
      trackedLocations: ["清流", "清流县", "档房"],
    },
  );
  assert.equal(locationQuestion.ok, true);
  const inventedSeal = validateDurableBoundary(
    "亲随答道，小的走时原册还在档房柜里，柜上贴着县令亲手的封条。",
    "核对密信中的县册疑点。",
    context,
    policy,
  );
  assert.equal(inventedSeal.ok, true);
  assert.equal(inventedSeal.reason, "UNSUPPORTED_EVIDENCE_ACCESS_DETAIL");
  assert.equal(inventedSeal.warnings[0]?.blocksPlayer, false);
});

test("registered durable object state blocks unauthorized opening or inserted contents", () => {
  const known = "持久物件事实：巡抚回文匣当前为空且合拢；明确开匣或装入前保持不变。";
  const policy = { protectedSubjects: [] };
  const opened = validateDurableBoundary(
    "巡抚书吏把回文匣端稳，匣盖没有合严，露出里面空白的回笺。",
    "暂不签发，留下巡抚书吏。",
    known,
    policy,
  );
  assert.equal(opened.ok, false);
  assert.equal(opened.reason, "REGISTERED_OBJECT_STATE_CONTRADICTION");

  const texture = validateDurableBoundary(
    "巡抚书吏换了换捧匣的手势，衣袖擦过案角。",
    "暂不签发，留下巡抚书吏。",
    known,
    policy,
  );
  assert.equal(texture.ok, true);

  const closedConfirmation = validateDurableBoundary(
    "巡抚书吏捧着回文匣，匣盖合着，没有打开。",
    "暂不签发，留下巡抚书吏。",
    known,
    policy,
  );
  assert.equal(closedConfirmation.ok, true);

  const differentEvidenceContainer = validateDurableBoundary(
    "改桑书吏站在签押房里，怀中抱着一只册匣，匣盖合着，没有打开。",
    "请巡抚共同具名。",
    known,
    policy,
  );
  assert.equal(differentEvidenceContainer.reason, "UNAUTHORIZED_NEW_EVIDENCE");

  const authorized = validateDurableBoundary(
    "总督命人打开回文匣，匣盖随即掀开。",
    "打开巡抚回文匣。",
    known,
    policy,
  );
  assert.equal(authorized.ok, true);
});

test("an incidental unauthorized prop sentence can be projected without rewriting the causal beat", () => {
  const narration = [
    "五月初九巳时，总督府签押房。巡抚幕僚没有寒暄。",
    "他将一只封好的手帖推到案中，指尖压住帖角。",
    "幕僚道：“中丞拒绝共同具名，但仍要求派员参加复核。”",
  ].join("\n\n");
  const projected = projectUnsupportedIncidentalSentence(narration, {
    code: "UNAUTHORIZED_FORMAL_ARTIFACT",
    message: "unauthorized",
    severity: "HIGH",
    blocksPlayer: true,
    details: { artifact: "手帖" },
  });
  assert.doesNotMatch(projected, /手帖/);
  assert.match(projected, /中丞拒绝共同具名/);
  assert.match(projected, /仍要求派员参加复核/);
});

test("an incidental authentication aside can be projected but an actual signing action cannot", () => {
  const incidental = projectUnsupportedIncidentalSentence(
    "舰长没有去碰航行令封面那枚红印。轮机员仍在舱门边等候。",
    {
      code: "UNSUPPORTED_DOCUMENT_AUTHENTICATION",
      message: "unsupported",
      severity: "HIGH",
      blocksPlayer: true,
      details: { subject: "航行令", marker: "红印" },
    },
  );
  assert.equal(incidental, "轮机员仍在舱门边等候。");
  assert.equal(projectUnsupportedIncidentalSentence(
    "舰长写完航行令，随即在封面盖上红印并交给轮机员。",
    {
      code: "UNSUPPORTED_DOCUMENT_AUTHENTICATION",
      message: "unsupported",
      severity: "HIGH",
      blocksPlayer: true,
      details: { subject: "航行令", marker: "红印" },
    },
  ), "");
});

test("an unsupported location aside can be projected but evidence testimony cannot", () => {
  const narration = [
    "亲随只说原册没有随信送来。",
    "总督心里清楚，原册还在清流县衙，不在他案上。",
    "巡抚书吏仍捧匣等候。",
  ].join("\n\n");
  const warning = {
    code: "CAUSAL_KNOWLEDGE_BOUNDARY",
    message: "unsupported location",
    severity: "HIGH" as const,
    blocksPlayer: true,
    details: {
      sourceCode: "UNSUPPORTED_DURABLE_LOCATION",
      subject: "原册",
      location: "清流县衙",
    },
  };
  const projected = projectUnsupportedIncidentalSentence(narration, warning);
  assert.doesNotMatch(projected, /还在清流县衙/u);
  assert.match(projected, /没有随信送来/u);
  assert.match(projected, /书吏仍捧匣等候/u);

  assert.equal(projectUnsupportedIncidentalSentence(
    "亲随当面答道：“原册还在清流县衙，由档房书办看守。”",
    warning,
  ), "");
});

test("an authored option knowledge limit promotes matching Shadow findings to a hard gate", () => {
  const delta = buildCausalDelta({
    turnId: "T01",
    action: "暂不签发，核对密信。",
    selectedOption: {
      id: "opening_d1",
      label: "暂不签发，核对密信。",
      effect: {
        intent: "本回合只核实两项已知边界：密信仅为报疑，原册未随信送来。亲随只能确认这两项，不能补充档房保管、经手人或原册内容。",
        reversible: false,
      },
    },
  });
  const promoted = enforceCausalKnowledgeBoundary([
    {
      code: "UNSUPPORTED_CUSTODY_ASSERTION",
      message: "正文为原册新增了无来源的既往保管保证",
      severity: "HIGH",
      blocksPlayer: false,
    },
  ], delta);
  assert.equal(promoted[0].code, "CAUSAL_KNOWLEDGE_BOUNDARY");
  assert.equal(promoted[0].blocksPlayer, true);
  assert.deepEqual(delta.allowedKnowledge, ["密信仅为报疑", "原册未随信送来"]);
  assert.deepEqual(delta.forbiddenKnowledge, ["档房保管", "经手人", "原册内容"]);
});

test("a compiled evidence profile supplies structured opening knowledge without prompt parsing", async () => {
  await withRuntime(async ({ workspace, runId }) => {
    const snapshot = await workspace.snapshot(runId);
    const compiled = await compileForegroundContext(
      workspace.paths(runId),
      snapshot,
    );
    const option = snapshot.previousOptions.find((item) => item.id === "opening_d1");
    assert.ok(option?.effect?.knowledgeBoundary);
    assert.ok(option?.effect?.beatContract);
    assert.equal(
      option.effect.knowledgeBoundary.sourceRef,
      "EVIDENCE-P1-QINGLIU-REGISTER-ANOMALY",
    );
    assert.ok(option.effect.knowledgeBoundary.allowed.some((item) => (
      item.includes("分户田数逐项相加")
      && item.includes("册尾所列总数不符")
    )));
    assert.ok(option.effect.knowledgeBoundary.forbidden.some((item) => (
      item.includes("具体册页")
      && item.includes("墨色")
    )));
    assert.equal(option.effect.beatContract.moves.length, 4);
    assert.match(option.effect.beatContract.stopCondition, /巡抚书吏仍在等待总督答复/);

    const delta = buildCausalDelta({
      turnId: "T01",
      action: option.label,
      selectedOption: option,
    });
    assert.equal(
      delta.knowledgeBoundaryRef,
      "EVIDENCE-P1-QINGLIU-REGISTER-ANOMALY",
    );
    assert.ok(delta.allowedKnowledge.some((item) => item.includes("册尾所列总数不符")));
    assert.ok(delta.evidenceSubjects.includes("分户数"));
    assert.equal(delta.beatContract?.sourceRef, "EVIDENCE-P1-QINGLIU-REGISTER-ANOMALY");
    assert.ok(delta.beatContract?.requiredAnchorGroups.some((group) => (
      group.includes("不知道") && group.includes("不知")
    )));

    const sanitizedIntent = authorizedNarrativeIntent(delta.immediateIntent);
    assert.doesNotMatch(sanitizedIntent, /封档|派人|取册|回文/);

    const rejectedNarration = [
      "总督问：“册子现在何处？”",
      "亲随答道：“还在清流县档房。”",
      "亲随又道：“县尊亲手将分户数逐一加过，前后对了两遍。”",
      "总督吩咐：“原册封存，不经我手令，不许任何人调阅抄录。”",
    ].join("\n");
    const authorizedAction = [
      delta.readerAction,
      sanitizedIntent,
    ].filter(Boolean).join("\n");
    const boundaryPolicy = {
      protectedSubjects: delta.evidenceSubjects,
      evidenceSubjects: delta.evidenceSubjects,
      trackedLocations: ["清流县", "档房"],
    };
    assert.equal(validateDurableBoundary(
      "亲随答道：“县尊只在信中写了这一层不合，原册不曾随信送来。”",
      authorizedAction,
      [
        compiled.foregroundGuidance,
        compiled.durableMemory,
        compiled.storyMemory,
        compiled.recentCanonExcerpt,
      ].join("\n"),
      boundaryPolicy,
    ).ok, true);
    const unsupportedLocation = validateDurableBoundary(
      [
        "总督问：“册子现在何处？”",
        "亲随答道：“仍在清流县档房。”",
      ].join("\n"),
      authorizedAction,
      [
        compiled.foregroundGuidance,
        compiled.durableMemory,
        compiled.storyMemory,
        compiled.recentCanonExcerpt,
      ].join("\n"),
      boundaryPolicy,
    );
    assert.notEqual(unsupportedLocation.reason, "UNSUPPORTED_DOCUMENT_CONTENT");
    assert.ok(unsupportedLocation.warnings.some((item) => (
      item.code === "UNSUPPORTED_DURABLE_LOCATION"
    )));
    assert.ok(
      enforceCausalKnowledgeBoundary(unsupportedLocation.warnings, delta)
        .some((item) => item.blocksPlayer),
    );
    const inheritedProcedureCount = validateDurableBoundary(
      [
        "总督问：“密信里的分户田数是谁核的？”",
        "亲随答：“县尊说，是他亲手逐项加过两遍。”",
      ].join("\n"),
      authorizedAction,
      [
        compiled.foregroundGuidance,
        compiled.durableMemory,
        compiled.storyMemory,
        compiled.recentCanonExcerpt,
      ].join("\n"),
      boundaryPolicy,
    );
    assert.equal(
      inheritedProcedureCount.reason,
      "UNSUPPORTED_DURABLE_QUANTITY",
    );
    assert.equal(inheritedProcedureCount.ok, true);
    assert.equal(inheritedProcedureCount.warnings[0]?.blocksPlayer, false);
    assert.equal(inheritedProcedureCount.warnings[0]?.details?.subject, "分户田数");
    assert.equal(validateDurableBoundary(
      "亲随答：“册尾总数多出分户之合。”",
      authorizedAction,
      [
        compiled.foregroundGuidance,
        compiled.durableMemory,
        compiled.storyMemory,
        compiled.recentCanonExcerpt,
      ].join("\n"),
      boundaryPolicy,
    ).reason, "UNSUPPORTED_EVIDENCE_DETAIL");
    const durable = validateDurableBoundary(
      rejectedNarration,
      authorizedAction,
      [
        compiled.foregroundGuidance,
        compiled.durableMemory,
        compiled.storyMemory,
        compiled.recentCanonExcerpt,
      ].join("\n"),
      boundaryPolicy,
    );
    assert.equal(durable.ok, true);
    assert.ok([
      "UNSUPPORTED_DURABLE_LOCATION",
      "UNSUPPORTED_DURABLE_QUANTITY",
    ].includes(durable.reason || ""));
    assert.ok(durable.warnings.some((item) => (
      item.code === "UNSUPPORTED_DURABLE_QUANTITY"
      && item.blocksPlayer === false
    )));
    const overreach = shadowContinuityWarnings(
      rejectedNarration,
      authorizedAction,
    );
    assert.ok(overreach.some((item) => item.code === "PLAYER_ACTION_OVERREACH"));
    assert.ok(
      enforceCausalKnowledgeBoundary(durable.warnings, delta)
        .some((item) => item.blocksPlayer),
    );

    const card = await readFile(
      path.join(
        workspace.paths(runId).contextCardsDir,
        "qingliu-register-anomaly",
        "CARD.md",
      ),
      "utf8",
    );
    assert.match(card, /分户田数逐项相加，所得合计与册尾所列总数不符/);
    assert.match(card, /改编证据入口，不冒充原著逐字事实/);
  }, new ScriptedProvider());
});

test("authored decision state machine keeps curated choices across three committed turns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-authored-decisions-"));
  const runId = `authored_run_${Date.now()}`;
  const authoredNarrations = [`
总督没有去拿印。他把巡抚公文往案角推了半寸，压在镇纸下，抬头看向屏风外。

“回文不急。你且坐着。”

巡抚书吏应了声“是”，却没有坐，只把回文匣换到左手，依旧站着。匣盖合着，里头是空的。

总督转向县令亲随：“密信上写的，你再说一遍。”

亲随咽了下嗓子，低头道：“县尊说，他在编报本县第一批待改田亩时，将册内分户田数逐项相加，所得合计与册尾所列总数不符。”

“差多少？”

“县尊没有写明。”

“核了几遍？”

“小人不知。县尊只命小人送信报疑，其余没有交代。”

总督盯着他看了两息。亲随垂着眼，又补了一句：“原册也没有随信带出来。小人来时县尊只说，大人若要查，清流县等令。”

总督没有再问。案上密信摊着，薄薄一张纸，报疑之外什么都没落定。巡抚书吏的目光从亲随身上收回来，重新看着总督，等一个答复。

巡抚书吏这才欠身道：“中丞还让小的问一句：总督既然暂缓签发，三日之内，复核的范围和办法如何，请给一份书面回复。”

话说完，他仍捧着空回文匣站在原处，等总督答复。
`.trim(), `
总督把空笺移到面前，落笔写明：“清流县先办一批，不得趁急难压价买田。”

墨迹稍干，他将写成的改桑放行回文折好，搁到案沿。巡抚书吏上前双手接过，装进一直捧着的回文匣里。匣盖合上，发出一声轻响。

总督只说：“交给中丞。”

书吏躬身应了，却没有立刻退下：“中丞还请派员到场参与复核，查验经过据实记入复核记录。”

他说完仍捧匣立在案前，等总督答复。县令亲随在另一侧垂手站着，没有插话。
`.trim(), `
总督没有再碰那只回文匣，只对书吏道：“方才的放行回文不改。”

他另取一张空笺，提笔写下“督抚责任说明”六字。正文只有三项：巡抚要求派员参与复核；总督对此尚未同意；巡抚若有异议须另行成文，督抚各自担责。写完，他没有落印，也没有签押，只把责任说明留在自己案前。

巡抚书吏没有伸手去取，只欠身道：“卑职只能记下总督另具了责任说明，无权代中丞认可其中主张。中丞若有异议，自会另行成文。”

五月初九巳时，杭州总督府签押房。

浙江总督坐在案后，清流县令和改桑书吏立在左侧，巡抚幕僚立在右侧。案上没有清流县册原件，也没有副本。

巡抚幕僚先开了口：“抚台要派人参加下一轮复核。总督此前的迟疑，若因此耽误国策，也须据实记下。三日具报在即，粮价也还在上涨；清流县只准试办、又不许压价买田，这两条是否仍照办，须请部堂明示。”他看了一眼案上尚未署名的责任说明，“这份话既要留下，究竟由谁具名担责？”

签押房里没有人接话。巡抚幕僚等着总督答复。
`.trim()];
  const provider = new ScriptedProvider({
    narrator: authoredNarrations,
    reviewer: authoredNarrations.map(cleanTruthReviewJson),
    options: [JSON.stringify({
      framing: "责任说明尚未署名，巡抚幕僚正等着总督说清谁来担责。",
      options: [
        "在责任说明上补写：总督只为暂缓签发一事具名担责。",
        "不补署名，令巡抚另具文书说明自己的责任。",
      ],
      tension: "谁为暂缓签发具名担责",
      storyComplete: false,
    })],
  });
  try {
    const workspace = new FileStoryWorkspace(root, projectRoot, upstreamCommit);
    const runtime = new OpenNovelRuntime(
      workspace,
      provider,
      { kick: async () => {} },
      new NoopMirror(),
      {
        decisionMode: "AUTHORED_WHEN_AVAILABLE",
        authoredDecisionAdapter: sangtianDecisionAdapter,
      },
    );
    await runtime.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    const opening = await workspace.snapshot(runId);
    const selected = opening.previousOptions.find(
      (option) => option.id === "opening_d1",
    );
    assert.ok(selected);
    const result = await runtime.processAction({
      runId,
      action: selected.label,
      boundOption: { id: selected.id, label: selected.label },
    });
    assert.deepEqual(
      provider.calls.map((call) => call.profile),
      ["narrator", "reviewer", "repair"],
    );
    assert.equal(provider.calls[0].temperature, 0.86);
    assert.match(
      provider.calls[0].messages.map((message) => message.content).join("\n"),
      /## Reader Action/,
    );
    assert.deepEqual(
      result.options.map((option) => option.id),
      [
        "DK-P1-EXECUTION-SCOPE-OPT-01",
        "DK-P1-EXECUTION-SCOPE-OPT-03",
      ],
    );
    assert.deepEqual(
      result.options.map((option) => option.label),
      [
        "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。",
        "暂不签放行文书，先封存清流县档房；若误了三日期限，由总督自行担责。",
      ],
    );
    const state = JSON.parse(
      await readFile(workspace.paths(runId).partOneState, "utf8"),
    );
    assert.equal(
      state.review.initiationStatus,
      "GOVERNOR_PRELIMINARY_INQUIRY",
    );
    assert.ok(state.completedKernelIds.includes("DK-P1-REVIEW-INITIATION"));
    const eventLog = await readFile(
      workspace.paths(runId).partOneEvents,
      "utf8",
    );
    assert.match(eventLog, /"decisionKernelId":"DK-P1-REVIEW-INITIATION"/);
    const limitedTrial = result.options.find(
      (option) => option.id === "DK-P1-EXECUTION-SCOPE-OPT-01",
    );
    assert.ok(limitedTrial);
    const authoredT02Delta = buildCausalDelta({
      turnId: "T02",
      action: limitedTrial.label,
      selectedOption: limitedTrial,
    });
    assert.equal(
      validateRequiredNarrativeFacts(
        String(provider.script.narrator[0] || ""),
        authoredT02Delta,
      ).some((warning) => warning.code === "MISSING_REQUIRED_DURABLE_RESULT"),
      true,
      "the old free-running narration is invalid because it omits the server-selected next beat",
    );
    const secondResult = await runtime.processAction({
      runId,
      action: limitedTrial.label,
      boundOption: { id: limitedTrial.id, label: limitedTrial.label },
    });
    assert.deepEqual(
      provider.calls.map((call) => call.profile),
      ["narrator", "reviewer", "repair", "narrator", "reviewer", "repair"],
    );
    assert.equal(provider.calls[3].temperature, 0.86);
    assert.match(
      provider.calls[3].messages.map((message) => message.content).join("\n"),
      /Recent Player Canon/,
    );
    const separateResponsibility = secondResult.options.find(
      (option) => option.id === "DK-P1-RESPONSIBILITY-RECORD-OPT-03",
    );
    assert.ok(separateResponsibility);
    assert.equal(
      separateResponsibility.label,
      "维持放行回文不改，另具督抚责任说明：巡抚要求派员参与复核而总督尚未同意，巡抚若有异议须另行成文，督抚各担其责。",
    );
    const jointSignature = secondResult.options.find(
      (option) => option.id === "DK-P1-RESPONSIBILITY-RECORD-OPT-01",
    );
    assert.ok(jointSignature);
    const jointSignatureContext = renderRuntimeNarratorCausalDelta(buildRuntimeCausalDelta({
      turnId: "T03",
      action: jointSignature.label,
      selectedOption: jointSignature,
    }));
    assert.match(
      jointSignatureContext,
      /服务端已经确定的下一剧情拍/,
    );
    assert.match(
      jointSignatureContext,
      /巡抚拒绝在总督昨日送来的正式回文上共同具名/,
    );
    assert.match(
      jointSignatureContext,
      /署名本身成为责任与利益冲突的行动/,
    );
    assert.match(
      jointSignatureContext,
      /独立巡抚是玩法角色位/,
    );
    assert.match(
      jointSignatureContext,
      /不得自行增加人数、涨幅、地点、期限/,
    );
    assert.match(jointSignatureContext, /复核由谁主持/);
    assert.doesNotMatch(jointSignatureContext, /玩家已结算行动必须写实/);
    const thirdResult = await runtime.processAction({
      runId,
      action: separateResponsibility.label,
      boundOption: {
        id: separateResponsibility.id,
        label: separateResponsibility.label,
      },
    }).catch(async (error) => {
      const audit = await readFile(
        workspace.paths(runId).shadowAudit,
        "utf8",
      ).catch(() => "");
      throw new Error(
        `${String((error as Error).message)}\n${audit.split(/\r?\n/).filter(Boolean).at(-1) || ""}`,
      );
    });
    assert.deepEqual(
      provider.calls.map((call) => call.profile),
      [
        "narrator", "reviewer", "repair",
        "narrator", "reviewer", "repair",
        "narrator", "reviewer", "repair",
      ],
    );
    assert.equal(thirdResult.turnNumber, 3);
    const stateAfterThird = JSON.parse(
      await readFile(workspace.paths(runId).partOneState, "utf8"),
    );
    assert.ok(stateAfterThird.pendingConsequences.some((item: { status: string }) => (
      item.status === "PAID"
    )));
    assert.equal(provider.calls[6].temperature, 0.86);
    assert.ok(thirdResult.options.length >= 2);
    assert.ok(thirdResult.options.every((option) => !option.id.startsWith("opt_T03_")));
    const nextAuthoredOption = thirdResult.options[0];
    const nextDecision = await prepareSangtianDecision(workspace, {
      runId,
      turnNumber: 4,
      action: nextAuthoredOption.label,
      selectedOption: nextAuthoredOption,
    });
    assert.ok(nextDecision);
    assert.ok(nextDecision.settlement.appliedAffordance);
    assert.match(
      provider.calls[6].messages.map((message) => message.content).join("\n"),
      /Recent Player Canon/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a private formal document's knowledge boundary in narrator context across worlds", () => {
  const action = "维持航向，暂不公开航行令。";
  const context = renderNarratorCausalDelta(buildCausalDelta({
    turnId: "T04",
    action,
    selectedOption: {
      id: "opt_private_order",
      label: action,
      effect: {
        intent: action,
        beatContract: {
          sourceRef: "part-one-event:second-world",
          objective: "让舰长回应眼前压力。",
          moves: [action, "轮机员追问谁承担误期责任。"],
          requiredAnchorGroups: [["航向"], ["轮机员"], ["责任"]],
          constraints: [
            "航行令正文目前只由舰长知晓；轮机员只知道文书存在。未经玩家明确出示、宣读或移交，不得让其他人物看见、复述或依据正文行动。",
            "不得新增人物、文书、证据、数量、期限或办理完成结果。",
          ],
          stopCondition: "轮机员追问谁承担误期责任。",
        },
      },
    },
  }));

  assert.match(context, /文书知情边界/);
  assert.doesNotMatch(context, /不得新增人物、文书、证据、数量、期限/);
  assert.match(context, /航行令正文目前只由舰长知晓/);
  assert.match(context, /未经玩家明确出示、宣读或移交/);
});

test("continuing an already selected wait does not become a new document command", () => {
  const warnings = shadowContinuityWarnings(
    "总督抬眼对屏风外道：“你且等着，回文不是不给你。”书吏仍捧着空匣候在原处。",
    "暂不签发放行文书，留下巡抚书吏，同时核对密信中指出的县册疑点。",
  );
  assert.equal(
    warnings.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"),
    false,
    JSON.stringify(warnings),
  );
  assert.equal(
    warnings.some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"),
    false,
    JSON.stringify(warnings),
  );
});

test("approved clauses written into a formal document are not spoken player directives", () => {
  const responsibilityAction = [
    "另具督抚责任说明。",
    "正文只写三项：巡抚要求派员参与复核；总督尚未同意；督抚各担其责。",
  ].join("\n");
  const responsibilityWarnings = shadowContinuityWarnings(
    "总督落笔。他没有看任何人。“巡抚要求派员到场参与复核——”第一行。接着写：“总督尚未同意。”第二行。",
    responsibilityAction,
  );
  assert.equal(
    responsibilityWarnings.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"),
    false,
    JSON.stringify(responsibilityWarnings),
  );

  const navigationAction = "写成航行令，正文只载派员复核航线。";
  const writtenWarnings = shadowContinuityWarnings(
    "舰长提笔写道：“本舰派员复核航线。”写完以后，航行令仍留在案前。",
    navigationAction,
  );
  assert.equal(
    writtenWarnings.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"),
    false,
    JSON.stringify(writtenWarnings),
  );

  const spokenWarnings = shadowContinuityWarnings(
    "舰长对轮机员道：“本舰命你派人复核航线。”",
    "写成航行令，航行令仍留在案前。",
  );
  assert.equal(
    spokenWarnings.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"),
    true,
    JSON.stringify(spokenWarnings),
  );
});

test("a written reply does not silently acquire an unapproved seal", () => {
  const narration = "总督写完改桑放行回文，在落款处盖上总督印，随后把回文交给书吏。";
  const unapproved = shadowContinuityWarnings(
    narration,
    "写成改桑放行回文，交给巡抚书吏。",
  );
  assert.equal(
    unapproved.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"),
    true,
  );
  const approved = shadowContinuityWarnings(
    narration,
    "写成改桑放行回文并盖上总督印，交给巡抚书吏。",
  );
  assert.equal(
    approved.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"),
    false,
  );
});

test("a closed document keeps its explicitly authorized unsigned state after entering a container", () => {
  const action = [
    "改桑放行回文正文只载两项：清流县先办一批；不得趁急难压价买田。",
    "本回合不落印、不签押；写成后交给巡抚书吏收进既有回文匣。",
  ].join("\n");
  assert.equal(validateDurableBoundary(
    "巡抚书吏合拢回文匣，里头装着那两行字，没有印，没有签押。",
    action,
    "",
    { protectedSubjects: ["回文"], allowedFormalArtifacts: ["回文"] },
  ).ok, true);

  const secondWorldAction = [
    "航行令中只载一项：维持当前航向。",
    "本回合不签押；写成后交给轮机员收进航令筒。",
  ].join("\n");
  assert.equal(validateDurableBoundary(
    "轮机员扣好航令筒，里头的航行令没有签押。",
    secondWorldAction,
    "",
    { protectedSubjects: ["航行令"], allowedFormalArtifacts: ["航行令"] },
  ).ok, true);
});

test("a scene named signing room is not itself a player signing action", () => {
  const warnings = shadowContinuityWarnings(
    "五月初九巳时，杭州总督府签押房。总督坐在案后，印盒仍旧合着。",
    "另具督抚责任说明，不落印、不签押。",
  );
  assert.equal(
    warnings.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"),
    false,
    JSON.stringify(warnings),
  );
});

test("a signing-room location is not document authentication", () => {
  const result = validateDurableBoundary(
    "签押房里四个人都知道，县册暂时还没有挪动。",
    "继续听巡抚幕僚说明。",
    "县册尚未呈到签押房。",
    { protectedSubjects: ["县册"], existingEvidenceSubjects: ["县册"] },
  );
  assert.notEqual(result.reason, "UNSUPPORTED_DOCUMENT_AUTHENTICATION");
});

test("required beat anchors accept a narrative-equivalent withheld signature", () => {
  const action = "暂不签发放行文书，先核对密信。";
  const delta = buildCausalDelta({
    turnId: "T01",
    action,
    selectedOption: {
      id: "withhold",
      label: action,
      effect: {
        intent: action,
        beatContract: {
          sourceRef: "test",
          objective: "留下公文",
          moves: ["暂不签发"],
          requiredAnchorGroups: [[
            "没有去拿印",
            "朱印未动",
            "公文暂压",
            "公文往案角",
            "公文往案侧",
          ]],
          stopCondition: "书吏仍在等候",
        },
      },
    },
  });
  assert.deepEqual(validateRequiredNarrativeFacts(
    "总督把巡抚那封催办公文往案内侧推了半寸，纸角压在镇纸下，没有作声。",
    delta,
  ), []);
  assert.equal(
    validateRequiredNarrativeFacts("总督立刻落印签发。", delta)[0]?.code,
    "MISSING_REQUIRED_BEAT_OUTCOME",
  );
});

test("required Chinese anchors accept ordinary aspect particles without weakening EXACT anchors", () => {
  const action = "要求巡抚幕僚说明责任。";
  const delta = buildCausalDelta({
    turnId: "T03",
    action,
    selectedOption: {
      id: "responsibility",
      label: action,
      effect: {
        intent: action,
        beatContract: {
          sourceRef: "test",
          objective: "形成当面责任压力",
          moves: ["追问是否耽误国策"],
          requiredAnchorGroups: [["耽误国策"]],
          requiredDurableAnchorGroups: [["耽误国策"]],
          stopCondition: "幕僚追问",
        },
      },
    },
  });
  assert.deepEqual(
    validateRequiredNarrativeFacts("幕僚追问：日后追责，谁耽误了国策？", delta),
    [],
  );

  delta.beatContract!.requiredDurableAnchorGroups = [["EXACT:耽误国策"]];
  assert.equal(
    validateRequiredNarrativeFacts("幕僚追问：日后追责，谁耽误了国策？", delta)[0]?.code,
    "MISSING_REQUIRED_DURABLE_RESULT",
  );
});

test("writing action anchors accept result complements but reject negated writing", () => {
  const action = "写成改桑放行回文。";
  const delta = buildCausalDelta({
    turnId: "T02",
    action,
    selectedOption: {
      id: "writing-action",
      label: action,
      effect: {
        intent: action,
        beatContract: {
          sourceRef: "test",
          objective: "写成获批文书",
          moves: [action],
          requiredAnchorGroups: [[
            "写明",
            "书明",
            "写进",
            "写入",
            "写下",
            "写的是",
            "写了",
            "落笔",
            "落字",
            "提笔",
            "批明",
            "另起一行",
            "补入",
            "添入",
            "补写",
          ]],
          requiredDurableAnchorGroups: [[
            "写明",
            "书明",
            "写进",
            "写入",
            "写下",
            "写的是",
            "写了",
            "落笔",
            "落字",
            "提笔",
            "批明",
            "另起一行",
            "补入",
            "添入",
            "补写",
          ]],
          stopCondition: "文书写成",
        },
      },
    },
  });

  assert.deepEqual(
    validateRequiredNarrativeFacts("他写得不算快，两行之后搁笔。", delta),
    [],
  );
  assert.equal(
    validateRequiredNarrativeFacts("他看着空纸，始终没有落笔。", delta)[0]?.code,
    "MISSING_REQUIRED_DURABLE_RESULT",
  );

  delta.beatContract!.requiredDurableAnchorGroups = [["EXACT:写明"]];
  assert.equal(
    validateRequiredNarrativeFacts("他写得不算快，两行之后搁笔。", delta)[0]?.code,
    "MISSING_REQUIRED_DURABLE_RESULT",
  );
});

test("a formal artifact may be established by its semantic stem and completed writing action", () => {
  const action = "写成改桑放行回文。";
  const delta = buildCausalDelta({
    turnId: "T02",
    action,
    selectedOption: {
      id: "reply",
      label: action,
      effect: {
        intent: action,
        beatContract: {
          sourceRef: "test",
          objective: "写成获批文书",
          moves: [action],
          requiredAnchorGroups: [["改桑放行回文", "放行回文", "回文"]],
          requiredDurableAnchorGroups: [["改桑放行回文", "放行回文", "回文"]],
          stopCondition: "把文书交给来使",
        },
      },
    },
  });
  assert.deepEqual(validateRequiredNarrativeFacts(
    "总督提笔写下改桑放行两条，写完将纸折好，放入来使所捧的匣中。",
    delta,
  ), []);
  assert.equal(validateRequiredNarrativeFacts(
    "总督口头说改桑放行，随后便谈起别事。",
    delta,
  )[0]?.code, "MISSING_REQUIRED_DURABLE_RESULT");

  delta.beatContract!.requiredAnchorGroups.push(["清流县先办一批"], ["压价买田"]);
  delta.beatContract!.requiredDurableAnchorGroups!.push(["清流县先办一批"], ["压价买田"]);
  assert.deepEqual(validateRequiredNarrativeFacts(
    "总督提笔写下两句：清流县先办一批，不得趁急难压价买田。写完将纸折好，放入来使所捧的匣中。",
    delta,
  ), []);
});

test("typed authored object state overrides a stale prose invariant", () => {
  const narration = "改桑放行回文仍放在巡抚回文匣中，匣盖合着。";
  const policy = {
    protectedSubjects: [],
    registeredObjectStates: [{
      subject: "巡抚回文匣",
      contentsState: "CONTAINS_DOCUMENT",
      closureState: "CLOSED",
    }],
  };
  assert.equal(validateDurableBoundary(
    narration,
    "维持改桑放行回文不改。",
    "持久物件事实：巡抚回文匣当前为空且合拢。",
    policy,
  ).ok, true);
  assert.equal(validateDurableBoundary(
    narration,
    "维持改桑放行回文不改。",
    "持久物件事实：巡抚回文匣当前为空且合拢。",
    {
      protectedSubjects: [],
      registeredObjectStates: [{
        subject: "巡抚回文匣",
        contentsState: "EMPTY",
        closureState: "CLOSED",
      }],
    },
  ).reason, "REGISTERED_OBJECT_STATE_CONTRADICTION");
});

test("legacy location inference cannot make a publication decision", () => {
  const rawNarration = [
    "总督没有去拿印。他把巡抚公文往案角推了半寸，抬眼对屏风外道：‘你先候着，回文不急这一刻。’",
    "巡抚书吏到底没再催，只把回文匣换到另一只手上，退后半步站定。",
    "总督转向县令亲随：‘密信里说分户田数加总与册尾总数不合——你县尊是拿哪一列去加的，加出来差多少？’",
    "亲随低头答：‘县尊只命小的转报：分户逐项相加，与册尾所列总数对不上。差数多少，信里没写，小的也不知道。’",
    "总督又问：‘原册现在何处？’亲随道：‘仍在清流县档房，未曾带出。’",
  ].join("");
  const warnings = shadowContinuityWarnings(
    rawNarration,
    "暂不签发，留下巡抚书吏并核对密信。",
  );
  assert.ok(warnings.every((item) => item.blocksPlayer === false));
});
test("an unverified evidence procedure stays playable and is marked Shadow", async () => {
  const provider = new ScriptedProvider({
    narrator: [[
      "总督没有去拿印，只让亲随复述县令报疑。",
      "亲随答：‘县尊说，是他亲手逐项加过两遍，才敢写进信里。册尾总数多出分户之合。’",
      "总督没有把这句话当成已核实结论。",
    ].join("")],
    options: [JSON.stringify({ options: [
      { label: "追问核验次数从何得知" },
      { label: "只记录报疑，不采信次数" },
    ], tension: "未经核实的核验程序" })],
  });
  await withRuntime(async ({ runtime, workspace, runId }) => {
    const opening = await runtime.getRun(runId);
    const option = opening.options.find((item) => item.id === "opening_d1");
    assert.ok(option);
    const result = await runtime.processAction({
      runId, action: option.label, boundOption: { id: option.id, label: option.label },
    });
    assert.equal(result.turnNumber, 1);
    assert.ok(result.warnings.every((warning) => warning.blocksPlayer === false));
    const canon = await readFile(workspace.paths(runId).chapters, "utf8");
    assert.match(canon, /亲手逐项加过两遍/);
  }, provider);
});
test("legacy durable-location diagnostics cannot block Canon", () => {
  const narration = "总督只问原册是否随信送来。亲随答道：‘不曾。县尊只说原册仍在清流，未曾离县。’巡抚书吏仍捧匣等候。";
  const warnings = shadowContinuityWarnings(
    narration,
    "暂不签发，只核对密信是否附有原册。",
  );
  assert.ok(warnings.every((warning) => warning.blocksPlayer === false));
});
test("Storykeeper section bodies are normalized by code before the next foreground", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      "总督只问书吏：“中丞要的是今日落印，还是今日有一句答复？”书吏把回文匣托稳，说自己只奉命取回总督府的回话，不敢替中丞改口。县令亲随仍在一旁候着，案上的印盒没有动。",
    ],
    options: [JSON.stringify({
      options: [
        { label: "让书吏把巡抚的原话再说一遍" },
        { label: "转问县令亲随何时能够返回清流" },
      ],
      tension: "巡抚要带回怎样的答复",
    })],
    storykeeper: [storykeeperPatch({
      "scene.md": "内厅问话已转到巡抚究竟要什么答复，印盒仍未动。",
      "active-characters.md": "巡抚书吏：只确认自己奉命取回答复，不敢替巡抚改口。",
      "open-threads.md": "巡抚要的是立即落印，还是一份可带回去的查验答复，仍未得到巡抚本人确认。",
    })],
  });
  await withRuntime(async ({ runtime, workspace, storykeeper, runId }) => {
    await runtime.processAction({
      runId,
      action: "只问巡抚书吏，中丞究竟要今日落印，还是要一句答复。",
    });
    await storykeeper.kick(runId);

    const paths = workspace.paths(runId);
    assert.match(await readFile(path.join(paths.frontendDir, "scene.md"), "utf8"), /^## Scene\n\n/);
    assert.match(
      await readFile(path.join(paths.frontendDir, "active-characters.md"), "utf8"),
      /^## Active Characters\n\n/,
    );
    assert.match(
      await readFile(path.join(paths.frontendDir, "open-threads.md"), "utf8"),
      /^## Open Threads\n\n/,
    );
    const guidance = await readFile(paths.foregroundGuidance, "utf8");
    assert.match(guidance, /## Scene/);
    assert.match(guidance, /## Active Characters/);
    assert.match(guidance, /## Open Threads/);

    const call = provider.calls.find((candidate) => candidate.profile === "storykeeper");
    assert.ok(call);
    assert.match(call.messages[0].content, /每一次引用中保留来源与未核实状态/);
    assert.match(call.messages[0].content, /T01 不得把 floor T03 写成已经到达/);
  }, provider);
});

test("frontend section formatter preserves correct headings and repairs bare bodies", () => {
  assert.equal(
    formatFrontendSection("scene.md", "## Scene\n\n- 内厅"),
    "## Scene\n\n- 内厅",
  );
  assert.equal(
    formatFrontendSection("scene.md", "- 内厅"),
    "## Scene\n\n- 内厅",
  );
  assert.equal(formatFrontendSection("directed-beat.md", ""), "");
  assert.match(
    formatContextCardContent(
      "---\nname: clerk\ntriggers: [\"巡抚书吏\", \"书吏\"]\n---\n\n只知道自己经手的公文。",
      "clerk",
    ),
    /\n# 巡抚书吏\n\n只知道自己经手的公文。\n$/,
  );
  assert.equal(
    sanitizeOptionsGuidance(
      "下一回合可自然推进的方向：总督下令封档；总督给书吏回文。任一方向都应来自当前现场，不替玩家承诺。",
    ),
    "下一回合可自然推进的方向：总督下令封档；总督给书吏回文。任一方向都应来自当前现场，不替玩家承诺。",
  );
});

test("legacy overreach inference remains offline after P04 replaces publication gating", () => {
  const warnings = shadowContinuityWarnings(
    "总督叫值差去查米价，又补了一句：‘不必声张，也不要知会巡抚衙门。’值差当即领命。",
    "叫人去查城中米价和米行闭门情形。",
  );
  assert.ok(warnings.every((warning) => warning.blocksPlayer === false));
});
test("legacy future-commitment inference cannot decide publication", () => {
  const warnings = shadowContinuityWarnings(
    "总督问完密信里的疑处，把信压回公文下面。总督道：‘回文今晚给你，你先候着。’",
    "暂不签发，留下书吏并核对密信。",
  );
  assert.ok(warnings.every((warning) => warning.blocksPlayer === false));
});
test("legacy appended-promise inference cannot decide publication or rewrite prose", () => {
  const narration = "总督没有去碰印。他抬眼道：‘你先候着，回文随后给。’巡抚书吏仍捧匣站定。";
  const warnings = shadowContinuityWarnings(
    narration,
    "暂不签发，留下巡抚书吏。",
  );
  assert.ok(warnings.every((warning) => warning.blocksPlayer === false));
  assert.match(narration, /回文随后给/);
});
test("a chosen investigation may be stated while an NPC conditional is not a player action", () => {
  const action = "先答粮价：命查杭州米铺实情，再议各县";
  const narration = [
    "总督说：“总督衙门这就差人去杭州城里各米铺查实牌价，查清后再议各县。”",
    "幕僚答：“总督若肯落印，自然好说。”",
  ].join("\n");
  assert.deepEqual(shadowContinuityWarnings(narration, action), []);
});

test("legacy diagnostic recognizes an extra order after a pure inquiry", () => {
  const narration = [
    "总督只问书吏：‘中丞要的是今日落印，还是一句可带回去的答复？’",
    "书吏说自己只奉命取回答复。",
    "总督又转向亲随：‘原册不许动，本督另派人到。’",
  ].join("\n\n");
  const warnings = shadowContinuityWarnings(
    narration,
    "只问巡抚书吏要何种答复。",
  );
  assert.ok(warnings.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"));
});
test("options failure never rolls back narration and free-text can continue next turn", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      "总督没有去接那只回文匣，只问县令亲随：“原册既未随信来，县里如今是谁守着档房？”亲随答得很慢，说县尊只命他把疑处先送来，余下的人一个也不敢惊动。屏风外的书吏听到这里，把捧匣的手往上托了托：“卑职只求一句可带回去的话。”门外驿卒的脚步停在廊下，显然又有新的催件到了。",
      "总督让门下先接过廊下的催件，却不拆，只叫书吏把巡抚原话再说一遍。书吏这回不再只提米价，添了一句：中丞午前便要知道总督府究竟是扣文，还是另有查验章程。县令亲随垂着眼，忽然说清流到杭州一夜半程；若此刻发令，赶在明日开衙前还来得及。两句话一前一后，把内厅里原本含混的期限压成了眼前的时辰。",
    ],
    options: [new Error("simulated options timeout"), new Error("simulated options timeout")],
    storykeeper: [storykeeperPatch(), storykeeperPatch()],
  });
  await withRuntime(async ({ runtime, workspace, storykeeper, runId }) => {
    const events: TurnEvent[] = [];
    const first = await runtime.processAction({
      runId,
      action: "暂不落印，先问清原册为何没有随信送来。",
      onEvent: (event) => events.push(event),
    });
    assert.equal(first.turnNumber, 1);
    assert.equal(first.options.length, 0);
    assert.ok(first.warnings.some((warning) => warning.code === "OPTIONS_UNAVAILABLE"));
    assert.ok(events.some((event) => event.type === "turn.committed"));
    assert.ok(events.findIndex((event) => event.type === "narration.complete")
      < events.findIndex((event) => event.type === "turn.committed"));

    const afterFirst = await workspace.readPublicRun(runId);
    assert.match(afterFirst.canon, /总督没有去接那只回文匣/);
    assert.deepEqual(afterFirst.options, []);
    const failedOptionsCall = JSON.parse(
      await readFile(path.join(workspace.paths(runId).callsDir, "T01.options.json"), "utf8"),
    ) as { error?: string };
    assert.match(failedOptionsCall.error || "", /simulated options timeout/);

    const second = await runtime.processAction({
      runId,
      action: "让书吏把巡抚的原话再说一遍，同时接下门外的新催件。",
    });
    assert.equal(second.turnNumber, 2);
    assert.match(second.narration, /午前便要知道/);
    await storykeeper.kick(runId);
  }, provider);
});

test("Canon is committed before the Options provider starts", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      "总督把催办公文留在案上，只让书吏把巡抚原话再说一遍。书吏答得谨慎：中丞要的不是一句含混的“容查”，而是午前能带回去的明确回话。县令亲随站在一旁，没有插嘴。案上的密信仍压在砚下，屋里却已经不再只是等候落印的局面。",
    ],
    options: [JSON.stringify({
      options: [
        { label: "追问巡抚所谓明确回话的边界" },
        { label: "转问亲随清流县令能否立即封存原册" },
      ],
      tension: "午前答复",
    })],
    storykeeper: [storykeeperPatch()],
  });
  await withRuntime(async ({ runtime, workspace, runId }) => {
    let inspected = false;
    provider.beforeGenerate = async (request) => {
      if (request.profile !== "options") return;
      const duringOptions = await workspace.readPublicRun(runId);
      assert.equal(duringOptions.turnNumber, 1);
      assert.equal(duringOptions.status, "READY");
      assert.match(duringOptions.canon, /屋里却已经不再只是等候落印的局面/);
      assert.deepEqual(duringOptions.options, []);
      inspected = true;
    };
    const result = await runtime.processAction({
      runId,
      action: "先听书吏把巡抚原话说完，不落印。",
    });
    assert.equal(inspected, true);
    assert.equal(result.options.length, 2);
    const optionsCall = provider.calls.find((call) => call.profile === "options");
    assert.equal(optionsCall?.stream, true);
    const log = await readFile(workspace.paths(runId).sceneLog, "utf8");
    assert.ok(log.indexOf('"type":"turn_committed"') < log.indexOf('"type":"foreground_options"'));
  }, provider);
});

test("failed Options can be recovered without regenerating or recommitting Canon", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      "总督把公文压在砚下，只问亲随原册为何没有随信送来。亲随答说县令不敢让原册离开档房，但这只是县令一方的说法。巡抚书吏仍在屏风旁候着，等总督给一句能带回去的答复。",
    ],
    options: [
      new Error("simulated relay failure"),
      JSON.stringify({
        options: [
          { label: "问巡抚书吏，中丞要的是落印还是明确答复", key: true },
          { label: "先给巡抚一句口头答复，今日不落印" },
        ],
        tension: "巡抚仍在等答复",
        storyComplete: false,
      }),
    ],
    storykeeper: [storykeeperPatch()],
  });
  await withRuntime(async ({ runtime, workspace, runId }) => {
    const failed = await runtime.processAction({
      runId,
      action: "暂不落印，先问清原册为何没有随信送来。",
    });
    assert.equal(failed.options.length, 0);
    const canonBefore = (await workspace.readPublicRun(runId)).canon;

    const recovered = await runtime.recoverOptions(runId);
    const publicRun = await workspace.readPublicRun(runId);
    assert.equal(recovered.turnId, "T01");
    assert.equal(recovered.options.length, 2);
    assert.equal(recovered.options[0].key, undefined);
    assert.equal(publicRun.turnNumber, 1);
    assert.equal(publicRun.canon, canonBefore);
    assert.equal(provider.calls.filter((call) => call.profile === "narrator").length, 1);
    assert.equal(provider.calls.filter((call) => call.profile === "options").length, 2);
    assert.equal(provider.calls.filter((call) => call.profile === "options")[1].stream, true);
    await readFile(path.join(workspace.paths(runId).callsDir, "T01.options.02.json"), "utf8");
    const log = await readFile(workspace.paths(runId).sceneLog, "utf8");
    assert.match(log, /"type":"foreground_options_recovered"/);
  }, provider);
});

test("legacy unsupported custody inference cannot decide publication", () => {
  const warnings = shadowContinuityWarnings(
    "亲随低声说，清流县的册子还在百里之外，没有人碰过，也没有人看过。总督没有把这句话当成凭据，只问这是县令亲见还是差役转述。",
    "问亲随原册现在由谁看守。",
  );
  assert.ok(warnings.every((warning) => warning.blocksPlayer === false));
});
test("a settled player action cannot disappear behind an abbreviated narration", () => {
  const action = "只准清流县先办一批，并在回文里写明不得趁急难压价买田。";
  const delta = buildCausalDelta({
    turnId: "T02",
    action,
    selectedOption: {
      id: "limited-trial",
      label: action,
      effect: {
        intent: action,
        beatContract: {
          objective: "写成限定试办回文",
          moves: [action],
          requiredAnchorGroups: [["清流县先办一批"], ["压价买田"]],
          requiredDurableAnchorGroups: [["清流县先办一批"], ["压价买田"]],
          constraints: ["回文正文只载两项：清流县先办一批；不得趁急难压价买田。"],
          stopCondition: "书吏口头提出复核要求",
        },
      },
    },
  });
  const warnings = validateRequiredNarrativeFacts(
    "总督提笔写了几行，交给书吏收进回文匣。",
    delta,
  );
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => (
    warning.code === "MISSING_REQUIRED_DURABLE_RESULT"
    && warning.blocksPlayer === true
  )));
  assert.deepEqual(validateRequiredNarrativeFacts(
    "总督写明清流县先办第一批改桑田亩，并写明不得趁急难压价买田。",
    delta,
  ), []);
});

test("a transitioned scene admits ordinary paper texture but not unapproved named records", () => {
  const delta = buildCausalDelta({
    turnId: "T03",
    action: "请巡抚共同具名。",
    selectedOption: {
      id: "transition-doc-boundary",
      label: "请巡抚共同具名。",
      effect: {
        intent: "请巡抚共同具名。",
        beatContract: {
          objective: "转入次日签押房",
          requiredAnchorGroups: [],
          moves: ["议事转到次日签押房"],
          constraints: [
            "新场没有获批的正式文书或证据容器在案；普通无字纸张与笔砚只可作叙事纹理。",
          ],
          stopCondition: "幕僚当面追问",
        },
      },
    },
  });
  assert.equal(validateRequiredNarrativeFacts(
    "签押房案上只有普通无字纸张与笔砚，幕僚当面追问。",
    delta,
  ).some((warning) => warning.code === "UNAUTHORIZED_SCENE_DOCUMENT"), false);
  assert.equal(validateRequiredNarrativeFacts(
    "签押房手边放着几份未启封的文书，案上还摊开一张空白核验单。",
    delta,
  )[0]?.code, "UNAUTHORIZED_SCENE_DOCUMENT");

  const allowListedDelta = buildCausalDelta({
    turnId: "T03",
    action: "另具督抚责任说明。",
    selectedOption: {
      id: "transition-doc-allow-list",
      label: "另具督抚责任说明。",
      effect: {
        intent: "另具督抚责任说明。",
        beatContract: {
          objective: "转入次日签押房",
          requiredAnchorGroups: [],
          moves: ["议事转到次日签押房"],
          constraints: [
            "新场获批在场的正式文书或证据容器仅有：督抚责任说明；不得另添其他权力凭证。",
          ],
          stopCondition: "幕僚当面追问",
        },
      },
    },
  });
  assert.equal(validateRequiredNarrativeFacts(
    "昨日回文已经交走。次日签押房案上只摊着督抚责任说明。",
    allowListedDelta,
  ).some((warning) => warning.code === "UNAUTHORIZED_SCENE_DOCUMENT"), false);
  assert.equal(validateRequiredNarrativeFacts(
    "昨日回文已经交走。次日签押房案上摊着督抚责任说明，幕僚又递了一支巡抚令签。",
    allowListedDelta,
  )[0]?.code, "UNAUTHORIZED_SCENE_DOCUMENT");
  assert.equal(validateRequiredNarrativeFacts(
    "次日签押房里，改桑书吏抱着包袱，里头是簿册纸卷。",
    allowListedDelta,
  )[0]?.code, "UNAUTHORIZED_SCENE_DOCUMENT");
  assert.equal(validateRequiredNarrativeFacts(
    "次日签押房里，改桑书吏抱着包袱，里头只有几张空白纸。",
    allowListedDelta,
  ).some((warning) => warning.code === "UNAUTHORIZED_SCENE_DOCUMENT"), false);
});

test("legacy Causal Delta can still diagnose an omitted present-turn result offline", () => {
  const delta = buildCausalDelta({
    turnId: "T01",
    action: "签发暂缓改桑的正式回文",
    selectedOption: {
      id: "opt_required_result",
      label: "签发暂缓改桑的正式回文",
      key: true,
      effect: {
        intent: "签发暂缓改桑的正式回文",
        stateHints: [{
          key: "documents.governor_reply.status",
          op: "set" as const,
          value: "signed",
          presentThisTurn: true,
          surfaceAnchor: "回文已经落印",
        }],
      },
    },
  });
  const warnings = validateRequiredNarrativeFacts(
    "总督把书吏留下，只问巡抚午前究竟要一句怎样的回话。",
    delta,
  );
  assert.ok(warnings.some((warning) => warning.code === "MISSING_REQUIRED_DURABLE_RESULT"));
});

test("exact opening repeat is rejected by the generic surface gate without a retry", () => {
  const opening = "嘉靖三十五年五月初八，杭州总督府内厅。浙江总督刚在案前坐定，门外驿铃便催了第二遍。巡抚送来的催办公文压在案上，请总督即刻签发改桑放行文书；公文下面，却藏着清流县令连夜递来的密信，只说县册数字似有改痕，不敢断言是谁动的手。";
  const result = validateV4SurfaceIntegrity(opening, opening);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "NARRATION_REPEATS_PREVIOUS_OPENING");
});

test("empty foreground failure is recoverable and never enters Canon", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      new Error("simulated narrator transport timeout"),
      "总督重新抬眼看向书吏，只问了一句：“中丞要的究竟是今日落印，还是今日有一句可带回去的话？”书吏捧匣答道，自己只奉命取回答复，旁的无权替巡抚作主。话到这里便停了，案上朱印仍未动。",
    ],
    options: [JSON.stringify({
      options: [
        { label: "只给书吏一句口头答复" },
        { label: "继续扣下公文" },
      ],
      tension: "答复边界",
    })],
    storykeeper: [storykeeperPatch()],
  });
  await withRuntime(async ({ runtime, workspace, storykeeper, runId }) => {
    const before = await workspace.readPublicRun(runId);
    await assert.rejects(
      runtime.processAction({ runId, action: "先问清巡抚要什么，不落印。" }),
      /simulated narrator transport timeout/,
    );
    const failed = await workspace.readPublicRun(runId);
    assert.equal(failed.turnNumber, 0);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.canon, before.canon);
    const eventsAfterFailure = await readFile(workspace.paths(runId).sceneLog, "utf8");
    assert.match(eventsAfterFailure, /"type":"foreground_failed"/);
    assert.doesNotMatch(eventsAfterFailure, /"type":"foreground_turn"/);

    const recovered = await runtime.processAction({
      runId,
      action: "先问清巡抚要什么，不落印。",
    });
    assert.equal(recovered.turnNumber, 1);
    const after = await workspace.readPublicRun(runId);
    assert.equal(after.status, "READY");
    assert.equal(after.turnNumber, 1);
    assert.match(after.canon, /中丞要的究竟是今日落印/);
    await storykeeper.kick(runId);
  }, provider);
});

test("Storykeeper updates next foreground asynchronously without rewriting Canon", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      "总督只说了一句：“回去告诉中丞，公文留在这里，午前给他回话。”书吏没有争辩，先问这句话能不能写进回文。县令亲随却在旁边抬起头，显然听出了“午前”两个字留下的余地。门外的人已把新催件送到帘外，封皮上仍是巡抚衙门的印。",
    ],
    options: [JSON.stringify({
      options: [
        { label: "拆看新催件，再决定午前怎样回话" },
        { label: "先让县令亲随带口令回清流" },
      ],
      tension: "午前答复",
    })],
    storykeeper: [storykeeperPatch(
      {
        "scene.md": "## Scene\n\n- 午前答复已经成为当前镜头的最近期限。\n- 新催件仍在帘外，尚未拆看。",
        "active-pressures.md": "## Active Pressures\n\n- [URGENT] 午前必须给巡抚一句可写入回文的答复。\n- [HIGH] 清流县档房今夜值守仍未核实。",
      },
      [{
        slug: "county-register-custody",
        triggers: ["县册原件", "封存县册"],
        body: "# 县册保管\n\n县册原件仍在清流，保管状态会影响后续复核。",
        curate: true,
      }],
    )],
  });
  await withRuntime(async ({ runtime, workspace, storykeeper, runId }) => {
    const before = await workspace.readPublicRun(runId);
    const result = await runtime.processAction({
      runId,
      action: "扣下公文，只答应午前给巡抚回话。",
    });
    assert.match(result.narration, /午前给他回话/);
    await storykeeper.kick(runId);
    const after = await workspace.readPublicRun(runId);
    assert.equal(after.canon.startsWith(before.canon), true);
    assert.match(after.canon, /午前给他回话/);
    const guidance = await readFile(workspace.paths(runId).foregroundGuidance, "utf8");
    assert.match(guidance, /午前答复已经成为当前镜头/);
    assert.match(guidance, /清流县档房今夜值守仍未核实/);
    const storykeeperCall = provider.calls.find((call) => call.profile === "storykeeper");
    assert.ok(storykeeperCall);
    assert.match(storykeeperCall.messages[0].content, /recent_canon_before 是本轮正文提交前的 Canon/);
    assert.match(storykeeperCall.messages[1].content, /<recent_canon_before>/);
    assert.match(storykeeperCall.messages[1].content, /嘉靖三十五年五月初八/);
    const custodyCard = await readFile(
      path.join(workspace.paths(runId).contextCardsDir, "county-register-custody", "CARD.md"),
      "utf8",
    );
    assert.match(custodyCard, /县册原件仍在清流/);
    const cardsManifest = await readFile(workspace.paths(runId).cardsManifest, "utf8");
    assert.match(cardsManifest, /context-cards\/county-register-custody\/CARD\.md/);
  }, provider);
});

test("Storykeeper reuses a canonical entity card when the model invents an alias slug", async () => {
  const provider = new ScriptedProvider({
    storykeeper: [storykeeperPatch({
      "directed-beat.md": "T02 floor T03 前置：若T02仍未答复，T03最迟让压力推进。",
    }, [{
      slug: "zong-du",
      triggers: ["浙江总督", "总督", "制台"],
      body: "## 当前状态\n\n- 已命差员前往清流，但尚未收到回报。",
      curate: true,
    }])],
  });
  await withRuntime(async ({ workspace, storykeeper, runId }) => {
    await workspace.enqueueStorykeeper(runId, {
      id: "inbox_card_identity_t01",
      turnId: "T01",
      action: "命差员前往清流。",
      narration: "总督叫值差去传府经历入内候命。",
      recentCanonBefore: "巡抚书吏仍在厅中等候。",
      selectedEffect: null,
      warnings: [],
      createdAt: new Date().toISOString(),
    });
    await storykeeper.kick(runId);

    const canonical = await readFile(
      path.join(workspace.paths(runId).contextCardsDir, "governor", "CARD.md"),
      "utf8",
    );
    assert.match(canonical, /\n# 浙江总督\n\n## 当前状态/);
    assert.match(canonical, /已命差员前往清流/);
    await assert.rejects(
      readFile(path.join(workspace.paths(runId).contextCardsDir, "zong-du", "CARD.md"), "utf8"),
      /ENOENT/,
    );
    const call = provider.calls.find((candidate) => candidate.profile === "storykeeper");
    assert.ok(call);
    assert.match(call.messages[1].content, /<context_card_registry>/);
    assert.match(call.messages[1].content, /slug: governor/);
    assert.equal(
      (await readFile(path.join(workspace.paths(runId).frontendDir, "directed-beat.md"), "utf8")).trim(),
      "## This Turn\n\nT02 floor T03 前置：若T02仍未答复，T03最迟让压力推进。",
    );
  }, provider);
});

test("Storykeeper repairs unescaped prose quotes and reuses the recorded model result", async () => {
  const provider = new ScriptedProvider({
    storykeeper: [
      `{"summary":"updated","sections":{"scene.md":"## Scene\\n\\n- 书吏说"暂缓"二字不能带回。"},"contextCards":[],"qualityNotes":"quoted prose"}`,
    ],
  });
  await withRuntime(async ({ workspace, storykeeper, runId }) => {
    await workspace.enqueueStorykeeper(runId, {
      id: "inbox_json_repair_t01",
      turnId: "T01",
      action: "只听书吏说明。",
      narration: "书吏说他不能替巡抚接受暂缓。",
      recentCanonBefore: "书吏仍在厅中。",
      selectedEffect: null,
      warnings: [],
      createdAt: new Date().toISOString(),
    });
    await storykeeper.kick(runId);
    assert.match(
      await readFile(path.join(workspace.paths(runId).frontendDir, "scene.md"), "utf8"),
      /书吏说"暂缓"二字不能带回/,
    );
    assert.equal(provider.calls.filter((call) => call.profile === "storykeeper").length, 1);
  }, provider);
});

test("Storykeeper salvages a truncated JSON patch without another provider call", async () => {
  const provider = new ScriptedProvider({
    storykeeper: [
      `{"summary":"partial","sections":{"scene.md":"## Scene\\n\\n- 书吏仍在厅中等回文。`,
    ],
  });
  await withRuntime(async ({ workspace, storykeeper, runId }) => {
    await workspace.enqueueStorykeeper(runId, {
      id: "inbox_truncated_json_t01",
      turnId: "T01",
      action: "只听书吏说明。",
      narration: "书吏仍在厅中等回文。",
      recentCanonBefore: "书吏仍在厅中。",
      selectedEffect: null,
      warnings: [],
      createdAt: new Date().toISOString(),
    });
    await storykeeper.kick(runId);
    assert.match(
      await readFile(path.join(workspace.paths(runId).frontendDir, "scene.md"), "utf8"),
      /书吏仍在厅中等回文/,
    );
    assert.equal(provider.calls.filter((call) => call.profile === "storykeeper").length, 1);
  }, provider);
});

test("Storykeeper keeps unsupported durable claims attributed instead of promoting them", async () => {
  const provider = new ScriptedProvider({
    storykeeper: [storykeeperPatch(
      {
        "scene.md": [
          "## Scene",
          "",
          "- 原册留在档房。",
          "- 亲随称原册留在档房，尚未核实。",
          "- 总督已命亲随传令保册，是否送达仍未知。",
        ].join("\n"),
        "constants.md": "- 原册留在档房。\n- 巡抚公文仍扣在案上。",
      },
      [{
        slug: "qingliu-magistrate",
        triggers: ["清流县令", "县令"],
        body: "# 清流县令\n\n- 原册留在档房。\n- 亲随称原册留在档房，尚未核实。",
      }],
      "",
      "# Story Memory\n\n- 原册留在档房。\n- 总督已命亲随传令保册，是否送达仍未知。",
    )],
  });
  await withRuntime(async ({ workspace, storykeeper, runId }) => {
    await workspace.enqueueStorykeeper(runId, {
      id: "inbox_shadow_quarantine_t02",
      turnId: "T02",
      action: "命亲随返清流传令保册。",
      narration: "总督命亲随传话，原册留在档房原处。",
      recentCanonBefore: "亲随仍在内厅。",
      selectedEffect: null,
      warnings: [{
        code: "UNSUPPORTED_DURABLE_LOCATION",
        message: "正文为原册新增了无来源的明确所在地：档房",
        severity: "HIGH",
        blocksPlayer: false,
        details: { subject: "原册", location: "档房" },
      }],
      createdAt: new Date().toISOString(),
    });
    await storykeeper.kick(runId);

    const scene = await readFile(path.join(workspace.paths(runId).frontendDir, "scene.md"), "utf8");
    assert.doesNotMatch(scene, /^-\s*原册留在档房/m);
    assert.match(scene, /亲随称原册留在档房，尚未核实/);
    assert.match(scene, /总督已命亲随传令保册/);
    const constants = await readFile(path.join(workspace.paths(runId).frontendDir, "constants.md"), "utf8");
    assert.doesNotMatch(constants, /原册留在档房/);
    assert.match(constants, /巡抚公文仍扣在案上/);
    const memory = await readFile(workspace.paths(runId).storyMemory, "utf8");
    assert.doesNotMatch(memory, /^-\s*原册留在档房/m);
    assert.match(memory, /总督已命亲随传令保册/);
    const card = await readFile(
      path.join(workspace.paths(runId).contextCardsDir, "qingliu-magistrate", "CARD.md"),
      "utf8",
    );
    assert.doesNotMatch(card, /^-\s*原册留在档房/m);
    assert.match(card, /亲随称原册留在档房，尚未核实/);
  }, provider);
});

test("selected option consequence reaches the next foreground once and is then cleared", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      "总督没有去拿印，把巡抚公文留在案上，只让书吏等候，转而问县令亲随密信写明了什么。亲随只复述：分户田数逐项相加，与册尾总数不符；差额多少他不知道，原册也没有随信送来。书吏听完没有争辩，却把“公文留案”四个字复述了一遍，显然要原样带回巡抚衙门。",
      "巡抚书吏不再催问县册，只追问午前能否拿到一句正式答复。总督此前暂缓签发的决定已经传到这一步：巡抚没有退让，却把压力从落印转到了答复时辰。县令亲随仍在旁候命，清流方向尚未得到任何新消息。",
    ],
    options: [
      JSON.stringify({
        options: [
          { label: "只给巡抚一句午前答复" },
          { label: "命亲随立即回清流" },
        ],
        tension: "暂缓决定的反制",
      }),
      JSON.stringify({
        options: [
          { label: "确定午前答复的边界" },
          { label: "先让亲随回清流传话" },
        ],
        tension: "答复与传令",
      }),
    ],
    storykeeper: [
      storykeeperPatch({
        "pending-consequence.md": "## Pending Consequence\n\n- 巡抚会把暂缓签发转化为对明确答复时辰的追问；下一 beat 只呈现这项反制，不预写总督如何回答。",
      }),
      storykeeperPatch({
        "pending-consequence.md": "",
        "active-pressures.md": "## Active Pressures\n\n- [URGENT] 午前答复已经成为新的明确期限。",
      }),
    ],
  });
  await withRuntime(async ({ runtime, workspace, storykeeper, runId }) => {
    const opening = await workspace.readPublicRun(runId);
    const selected = opening.options[0];
    assert.ok(selected);
    assert.equal("effect" in selected, false);

    await runtime.processAction({
      runId,
      action: selected.label,
      boundOption: { id: selected.id, label: selected.label },
    });
    await storykeeper.kick(runId);
    const firstStorykeeper = provider.calls.find((call) => call.profile === "storykeeper");
    assert.ok(firstStorykeeper);
    assert.match(firstStorykeeper.messages[1].content, /<selected_effect>/);
    assert.match(firstStorykeeper.messages[1].content, /consequence/);
    assert.match(
      await readFile(path.join(workspace.paths(runId).frontendDir, "pending-consequence.md"), "utf8"),
      /巡抚会把暂缓签发转化为对明确答复时辰的追问/,
    );

    await runtime.processAction({
      runId,
      action: "让书吏说明巡抚要在午前得到什么答复。",
    });
    await storykeeper.kick(runId);
    const narratorCalls = provider.calls.filter((call) => call.profile === "narrator");
    assert.equal(narratorCalls.length, 2);
    assert.match(narratorCalls[1].messages[1].content, /## Pending Consequence/);
    assert.match(narratorCalls[1].messages[1].content, /明确答复时辰/);
    assert.equal(
      (await readFile(
        path.join(workspace.paths(runId).frontendDir, "pending-consequence.md"),
        "utf8",
      )).trim(),
      "",
    );
  }, provider);
});

test("director ARC stays out of Narrator context and drives generic background pacing", async () => {
  const secondWorldArc = [
    "# Arc",
    "",
    "## Current Arc",
    "",
    "A survey ship is waiting outside a silent observatory.",
    "",
    "## Structural Floor",
    "",
    "- floor T01, precondition: the ship remains in sensor range. The observatory alarm begins its already-seeded countdown.",
  ].join("\n");
  const updatedArc = [
    secondWorldArc,
    "",
    "## Status",
    "",
    "- The T01 alarm beat has been handed to This Turn; clear it after Canon stages it.",
  ].join("\n");
  const updatedMemory = [
    "# Story Memory",
    "",
    "- 舰长已决定继续监听观测站；这会约束下一次主动离开监听范围的选择。",
  ].join("\n");
  const provider = new ScriptedProvider({
    storykeeper: [storykeeperPatch(
      {
        "directed-beat.md": "## This Turn\n\n- 观测舱外已经建立的警报开始倒数。",
      },
      [],
      updatedArc,
      updatedMemory,
    )],
  });
  await withRuntime(async ({ workspace, storykeeper, runId }) => {
    const paths = workspace.paths(runId);
    await writeFile(paths.arcLog, `${secondWorldArc}\n`, "utf8");
    const snapshot = await getStorySnapshot(paths);
    const compiled = await compileForegroundContext(paths, snapshot);
    const narratorContext = buildForegroundUserContext(
      buildCausalDelta({
        turnId: "T01",
        action: "继续监听。",
        selectedOption: null,
      }),
      compiled,
    );
    assert.doesNotMatch(narratorContext, /survey ship|Structural Floor|sensor range/);

    await workspace.enqueueStorykeeper(runId, {
      id: "inbox_second_world_t01",
      turnId: "T01",
      action: "继续监听。",
      narration: "舰长没有离开监听席。",
      recentCanonBefore: "观测站始终沉默。",
      selectedEffect: null,
      warnings: [],
      createdAt: new Date().toISOString(),
    });
    await storykeeper.kick(runId);

    const call = provider.calls.find((candidate) => candidate.profile === "storykeeper");
    assert.ok(call);
    assert.match(call.messages[0].content, /director_arc 是只供后台推理/);
    assert.match(call.messages[0].content, /最近两个 beat 都只是在起草、改字、复述、等待/);
    assert.match(call.messages[1].content, /<director_arc>/);
    assert.match(call.messages[1].content, /floor T01/);
    assert.match(call.messages[1].content, /<story_memory>/);
    assert.match(call.messages[1].content, /<options_guidance>/);
    assert.match(call.messages[1].content, /<turn>\n0\n<\/turn>/);
    assert.match(await readFile(paths.arcLog, "utf8"), /handed to This Turn/);
    assert.match(await readFile(paths.storyMemory, "utf8"), /继续监听观测站/);
    assert.match(await readFile(path.join(paths.frontendDir, "directed-beat.md"), "utf8"), /警报开始倒数/);
  }, provider);
});

test("workspace survives a new runtime process view and keeps OPENOVEL_V1 frozen", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-openovel-recovery-"));
  try {
    const workspaceA = new FileStoryWorkspace(root, projectRoot, upstreamCommit);
    await workspaceA.createRun({
      runId: "recovery_run_001",
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    const workspaceB = new FileStoryWorkspace(root, projectRoot, upstreamCommit);
    const recovered = await workspaceB.readPublicRun("recovery_run_001");
    assert.equal(recovered.runtimeMode, "OPENOVEL_V1");
    assert.equal(recovered.turnNumber, 0);
    assert.match(recovered.canon, /两封文书，一道急令/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace foreground lease serializes processes and replaces only expired locks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-openovel-lease-"));
  try {
    const workspaceA = new FileStoryWorkspace(root, projectRoot, upstreamCommit);
    const workspaceB = new FileStoryWorkspace(root, projectRoot, upstreamCommit);
    const runId = "lease_run_001";
    await workspaceA.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });

    const releaseA = await workspaceA.acquireForegroundLease(runId);
    await assert.rejects(
      workspaceB.acquireForegroundLease(runId),
      /RUN_FOREGROUND_BUSY/,
    );
    await releaseA();

    const releaseB = await workspaceB.acquireForegroundLease(runId);
    await releaseB();

    const releaseStorykeeperA = await workspaceA.acquireStorykeeperLease(runId);
    await assert.rejects(
      workspaceB.acquireStorykeeperLease(runId),
      /RUN_STORYKEEPER_BUSY/,
    );
    await releaseStorykeeperA();

    await writeFile(workspaceA.paths(runId).foregroundLock, JSON.stringify({
      token: "expired-owner",
      ownerPid: 999_999,
      acquiredAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T00:01:00.000Z",
    }), "utf8");
    const releaseAfterExpiry = await workspaceA.acquireForegroundLease(runId);
    await releaseAfterExpiry();
    await assert.rejects(
      readFile(workspaceA.paths(runId).foregroundLock, "utf8"),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("durable database mirror retries a failed delivery without blocking Canon", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-openovel-mirror-"));
  try {
    const workspace = new FileStoryWorkspace(root, projectRoot, upstreamCommit);
    const runId = "mirror_run_001";
    await workspace.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    let shouldFail = true;
    const delivered: MirrorEvent[] = [];
    const transport: EventMirror = {
      configured: true,
      async publish(event) {
        if (shouldFail) throw new Error("temporary database outage");
        delivered.push(event);
      },
    };
    const mirror = new DurableEventMirror(workspace, transport);
    await mirror.publish({
      kind: "turn.committed",
      runId,
      payload: { submissionId: "action_001", result: { turnId: "T01" } },
    });
    await mirror.kick(runId);

    const failed = await workspace.mirrorOutbox(runId);
    assert.equal(failed.items.length, 1);
    assert.deepEqual(failed.state.processed, []);
    assert.match(Object.values(failed.state.failures)[0] || "", /temporary database outage/);

    shouldFail = false;
    await mirror.kick(runId);
    const recovered = await workspace.mirrorOutbox(runId);
    assert.deepEqual(recovered.state.processed, [recovered.items[0].id]);
    assert.deepEqual(recovered.state.failures, {});
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].kind, "turn.committed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Storykeeper recovery replays a recorded result without another model call", async () => {
  const provider = new ScriptedProvider({});
  await withRuntime(async ({ workspace, storykeeper, runId }) => {
    await storykeeper.kick(runId);
    const item = {
      id: "inbox_replay_t01",
      turnId: "T01",
      action: "让书吏继续候着。",
      narration: "书吏仍捧着回文匣，等总督下一句话。",
      recentCanonBefore: "总督府内厅里，两边来人都没有退。",
      selectedEffect: null,
      warnings: [],
      createdAt: new Date().toISOString(),
    };
    await workspace.enqueueStorykeeper(runId, item);
    const recordedPatch = storykeeperPatch({
      "open-threads.md": "## Open Threads\n\n- 已记录的后台结果已重放，不需要再次调用模型。",
    }).replace("- 已记录", `${String.fromCharCode(92)}- 已记录`);
    await workspace.recordModelCall(
      runId,
      item.turnId,
      "storykeeper",
      {
        profile: "storykeeper",
        messages: [{ role: "user", content: "recorded before process exit" }],
        temperature: 0.35,
        maxTokens: 8_000,
        json: true,
        stream: false,
      },
      {
        text: recordedPatch,
        model: "recorded-model",
        usage: { inputTokens: 10, outputTokens: 20 },
        latencyMs: 30,
      },
    );

    await storykeeper.kick(runId);
    assert.equal(provider.calls.filter((call) => call.profile === "storykeeper").length, 0);
    assert.deepEqual((await workspace.inbox(runId)).state.processed, [item.id]);
    assert.match(
      await readFile(workspace.paths(runId).foregroundGuidance, "utf8"),
      /不需要再次调用模型/,
    );

    await writeFile(workspace.paths(runId).inboxState, JSON.stringify({
      processed: [],
      failures: {},
      updatedAt: new Date().toISOString(),
    }), "utf8");
    await storykeeper.kick(runId);
    assert.equal(provider.calls.filter((call) => call.profile === "storykeeper").length, 0);
    assert.equal(
      (await readFile(workspace.paths(runId).sceneLog, "utf8"))
        .split(/\r?\n/)
        .filter((line) => line.includes(`"itemId":"${item.id}"`)).length,
      1,
    );
  }, provider);
});

test("Storykeeper leaves inbox pending when another process owns the drain lease", async () => {
  const provider = new ScriptedProvider({
    storykeeper: [storykeeperPatch({
      "open-threads.md": "## Open Threads\n\n- 后台租约释放后，本条工作集更新已正常应用。",
    })],
  });
  await withRuntime(async ({ workspace, storykeeper, runId }) => {
    await storykeeper.kick(runId);
    await workspace.enqueueStorykeeper(runId, {
      id: "inbox_lease_t01",
      turnId: "T01",
      action: "继续查问。",
      narration: "书吏仍在案前等候。",
      recentCanonBefore: "内厅里没有人离开。",
      selectedEffect: null,
      warnings: [],
      createdAt: new Date().toISOString(),
    });
    const release = await workspace.acquireStorykeeperLease(runId);
    await storykeeper.kick(runId);
    assert.equal(provider.calls.filter((call) => call.profile === "storykeeper").length, 0);
    assert.deepEqual((await workspace.inbox(runId)).state.processed, []);

    await release();
    await storykeeper.kick(runId);
    assert.equal(provider.calls.filter((call) => call.profile === "storykeeper").length, 1);
    assert.deepEqual((await workspace.inbox(runId)).state.processed, ["inbox_lease_t01"]);
    assert.match(
      await readFile(workspace.paths(runId).foregroundGuidance, "utf8"),
      /后台租约释放后/,
    );
  }, provider);
});

test("Storykeeper dead-letters a bounded failure so later work is not head-of-line blocked", async () => {
  const provider = new ScriptedProvider({
    storykeeper: [
      new Error("storykeeper outage one"),
      new Error("storykeeper outage two"),
    ],
  });
  await withRuntime(async ({ workspace, storykeeper, runId }) => {
    await storykeeper.kick(runId);
    await workspace.enqueueStorykeeper(runId, {
      id: "inbox_dead_letter_t01",
      turnId: "T01",
      action: "继续听书吏回话。",
      narration: "书吏说完便候在一旁。",
      recentCanonBefore: "书吏仍在内厅。",
      selectedEffect: null,
      warnings: [],
      createdAt: new Date().toISOString(),
    });

    await storykeeper.kick(runId);
    let inbox = await workspace.inbox(runId);
    assert.deepEqual(inbox.state.processed, []);
    assert.equal(inbox.state.attempts?.inbox_dead_letter_t01, 1);

    await storykeeper.kick(runId);
    inbox = await workspace.inbox(runId);
    assert.ok(inbox.state.processed.includes("inbox_dead_letter_t01"));
    assert.match(inbox.state.deadLetters?.inbox_dead_letter_t01 || "", /outage two/);
    assert.equal(provider.calls.filter((call) => call.profile === "storykeeper").length, 2);
    assert.match(await readFile(workspace.paths(runId).sceneLog, "utf8"), /storykeeper_dead_letter/);
    assert.match(await readFile(workspace.paths(runId).qualityLog, "utf8"), /Canon 保留/);
  }, provider);
});

test("acceptance audit separates engineering evidence from missing player review", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      "总督让书吏把巡抚原话再说一遍。书吏答称，中丞只要今日有一句能带回去的话，并没有授意他替总督定查验章程。县令亲随在旁听着，低声提醒清流路远，若还要赶在明日开衙前传令，眼下便不能再耽搁。两边都没有替总督作主，时辰却已经逼到案前。",
    ],
    options: [JSON.stringify({
      options: [
        { label: "只给巡抚一句暂缓答复" },
        { label: "命亲随立即回清流传话" },
      ],
      tension: "答复与传令的先后",
    })],
    storykeeper: [storykeeperPatch()],
  });
  await withRuntime(async ({ runtime, workspace, storykeeper, runId }) => {
    await runtime.processAction({
      runId,
      action: "暂不签发，只让书吏重述巡抚原话。",
    });
    await storykeeper.kick(runId);
    const withoutReviews = await auditOpenNovelRun(workspace.paths(runId), { targetTurns: 1 });
    assert.equal(withoutReviews.technical.passed, true);
    assert.equal(withoutReviews.player.passed, false);
    assert.deepEqual(withoutReviews.player.missingReviewIds, ["G00", "T01"]);
    assert.equal(withoutReviews.verdict, "NOT_COMPLETE");
    assert.equal(withoutReviews.model.profiles.narrator.calls, 1);
    assert.equal(withoutReviews.model.profiles.options.calls, 1);
    assert.equal(withoutReviews.model.profiles.storykeeper.calls, 1);

    const passed = await auditOpenNovelRun(workspace.paths(runId), {
      targetTurns: 1,
      pricing: {
        inputPerMillion: 2,
        outputPerMillion: 4,
        currency: "CNY",
      },
      reviews: ["G00", "T01"].map((checkpoint) => ({
        checkpoint,
        actionResponded: checkpoint === "G00" ? null : true,
        choiceImpactVisible: checkpoint === "G00" ? null : true,
        novelLike: true,
        worldToneFit: true,
        npcAgency: true,
        playerAgencyPreserved: true,
        causalGrounded: true,
        coherent: true,
        optionsUnderstandable: true,
        optionsDistinct: true,
        optionsExecutable: true,
        freeInputAvailable: true,
        wantsToContinue: true,
        reportLike: false,
        majorContinuityError: false,
      })),
    });
    assert.equal(passed.player.passed, true);
    assert.equal(passed.verdict, "PASS");
    assert.equal(passed.player.choiceImpactVisibleRate, 1);
    assert.equal(passed.player.worldToneFitRate, 1);
    assert.equal(passed.player.playerAgencyPreservedRate, 1);
    assert.equal(passed.player.causalGroundedRate, 1);
    assert.equal(passed.player.optionsDistinctRate, 1);
    assert.equal(passed.player.optionsExecutableRate, 1);
    assert.equal(passed.player.wantsToContinueRate, 1);
    assert.equal(passed.player.reportLikeRate, 0);
    assert.equal(passed.model.cost.configured, true);
    assert.equal(passed.model.cost.currency, "CNY");
    assert.equal(passed.model.cost.estimatedTotal, 0.0012);
    assert.equal(passed.model.cost.estimatedPerCommittedTurn, 0.0012);

    const smoothButFake = await auditOpenNovelRun(workspace.paths(runId), {
      targetTurns: 1,
      reviews: ["G00", "T01"].map((checkpoint) => ({
        checkpoint,
        actionResponded: checkpoint === "G00" ? null : true,
        choiceImpactVisible: checkpoint === "G00" ? null : true,
        novelLike: true,
        worldToneFit: true,
        npcAgency: true,
        playerAgencyPreserved: checkpoint === "G00",
        causalGrounded: true,
        coherent: true,
        optionsUnderstandable: true,
        optionsDistinct: checkpoint === "G00",
        optionsExecutable: true,
        freeInputAvailable: true,
        wantsToContinue: true,
        reportLike: false,
        majorContinuityError: false,
      })),
    });
    assert.equal(smoothButFake.player.passed, false);
    assert.deepEqual(smoothButFake.player.blockingReviewIds, ["T01"]);
    assert.equal(smoothButFake.verdict, "NOT_COMPLETE");

    const malformed = await auditOpenNovelRun(workspace.paths(runId), {
      targetTurns: 1,
      reviews: JSON.parse(JSON.stringify([
        {
          checkpoint: "G00",
          actionResponded: null,
          choiceImpactVisible: null,
          novelLike: "true",
          worldToneFit: true,
          npcAgency: true,
          playerAgencyPreserved: true,
          causalGrounded: true,
          coherent: true,
          optionsUnderstandable: true,
          optionsDistinct: true,
          optionsExecutable: true,
          freeInputAvailable: true,
          wantsToContinue: true,
          reportLike: false,
          majorContinuityError: false,
        },
        {
          checkpoint: "T01",
          actionResponded: null,
          choiceImpactVisible: true,
          novelLike: true,
          worldToneFit: true,
          npcAgency: true,
          playerAgencyPreserved: true,
          causalGrounded: true,
          coherent: true,
          optionsUnderstandable: true,
          optionsDistinct: true,
          optionsExecutable: true,
          freeInputAvailable: true,
          wantsToContinue: true,
          reportLike: false,
          majorContinuityError: false,
        },
      ])),
    });
    assert.equal(malformed.player.passed, false);
    assert.deepEqual(malformed.player.invalidReviewIds, ["G00", "T01"]);
  }, provider);
});

test("scripted G00-T05 keeps Canon playable through an options failure without claiming player PASS", async () => {
  const provider = new ScriptedProvider({
    narrator: [
      "总督没有碰朱印，只叫巡抚书吏把中丞原话说全。书吏答称，中丞要的是今日有一句能带回去的答复，至于如何查册，并未让他越俎代庖。县令亲随听到这里，抬头看了一眼窗外的天色。两边的话都留着余地，午前这个时辰却已经落在案上。",
      "总督只准书吏带回一句：午前答复，公文暂留。书吏把这句话复述了一遍，问能否照此写进回文，手中的匣子仍未放下。县令亲随却低声道，从杭州赶回清流须走一夜；再迟，明日开衙前便接不到总督府的口信。",
      "总督命亲随立即回清流，只传一句保住档房现状，不许把报疑说成案情。亲随领命退到门边时，廊下驿卒正送进巡抚衙门的第二封催件。书吏认得封皮，却也不敢替中丞说明里面写了什么。",
      "总督拆开新催件。纸上没有新证据，只追问总督府午前能否给出执行边界。书吏看着那封催件，第一次把话说得直白：若仍只有口头暂缓，中丞便只能按总督未答复具报。门外脚步渐远，亲随已经启程。",
      "总督让值差备一份只说明查验边界的回文，不写县册已经有罪，也不替清流县令作保。书吏听完，没有再催落印，只问这份回文由谁送往巡抚衙门。与此同时，清流方向尚无回报，县册是否保住仍是未知。",
    ],
    options: [
      JSON.stringify({
        options: [
          { label: "只答应午前给巡抚回话" },
          { label: "先命亲随回清流传话" },
        ],
        tension: "午前答复",
      }),
      JSON.stringify({
        options: [
          { label: "命亲随立即回清流" },
          { label: "先让书吏写下口头答复" },
        ],
        tension: "传令时辰",
      }),
      JSON.stringify({
        options: [
          { label: "拆看巡抚追加催件" },
          { label: "不拆催件，先拟回文" },
        ],
        tension: "第二封催件",
      }),
      new Error("simulated T04 options outage"),
      JSON.stringify({
        options: [
          { label: "指定值差送回文" },
          { label: "让巡抚书吏自行带回" },
        ],
        tension: "回文送达责任",
      }),
    ],
    storykeeper: [
      storykeeperPatch({
        "active-pressures.md": "## Active Pressures\n\n- [URGENT] 午前答复已经成为眼前期限。\n- [HIGH] 清流传令仍未发出。",
      }),
      storykeeperPatch({
        "directed-beat.md": "## This Turn\n\n- 巡抚衙门的第二封催件送到总督府内厅。",
      }),
      storykeeperPatch({
        "directed-beat.md": "",
        "open-threads.md": "## Open Threads\n\n- 第二封催件尚未拆看。\n- 清流传令能否及时到达仍未知。",
      }),
      storykeeperPatch({
        "active-pressures.md": "## Active Pressures\n\n- [URGENT] 巡抚要求午前得到书面执行边界。\n- [HIGH] 清流方向尚无回报。",
      }),
      storykeeperPatch({
        "open-threads.md": "## Open Threads\n\n- 回文由谁送达，将决定责任和措辞由谁见证。\n- 清流方向尚无回报。",
      }),
    ],
  });
  await withRuntime(async ({ runtime, workspace, storykeeper, runId }) => {
    const actions = [
      "暂不签发放行文书，只让书吏把巡抚原话说清楚。",
      "只答应午前给巡抚回话，公文暂留。",
      "命亲随立即回清流，只传话保住档房现状。",
      "拆看巡抚追加催件。",
      "让值差备一份只说明查验边界的回文。",
    ];
    for (const action of actions) {
      await runtime.processAction({ runId, action });
      await storykeeper.kick(runId);
    }
    const run = await workspace.readPublicRun(runId);
    assert.equal(run.turnNumber, 5);
    assert.equal(run.status, "READY");
    assert.doesNotMatch(run.canon, /T04 options outage|OPTIONS_UNAVAILABLE/);
    assert.match(run.canon, /清流方向尚无回报/);
    assert.match(
      await readFile(workspace.paths(runId).sceneLog, "utf8"),
      /OPTIONS_UNAVAILABLE/,
    );

    const report = await auditOpenNovelRun(workspace.paths(runId), { targetTurns: 5 });
    assert.equal(report.technical.passed, true);
    assert.equal(report.technical.committedTurns, 5);
    assert.equal(report.model.profiles.narrator.calls, 5);
    assert.equal(report.model.profiles.options.calls, 5);
    assert.equal(report.model.profiles.options.errors, 1);
    assert.equal(report.model.profiles.storykeeper.calls, 5);
    assert.equal(report.player.passed, false);
    assert.equal(report.verdict, "NOT_COMPLETE");
  }, provider);
});

test("restart recovery marks interrupted foreground retryable and kicks background drain", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-openovel-restart-"));
  try {
    const workspace = new FileStoryWorkspace(root, projectRoot, upstreamCommit);
    await workspace.createRun({
      runId: "restart_run_001",
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    await workspace.updateMetadata("restart_run_001", { status: "FOREGROUND_RUNNING" });
    const kicked: string[] = [];
    const recovery = await recoverRuntimeRuns(workspace, {
      kick(runId) {
        kicked.push(runId);
      },
    });
    assert.deepEqual(recovery.interrupted, ["restart_run_001"]);
    assert.deepEqual(kicked, ["restart_run_001"]);
    const restored = await workspace.metadata("restart_run_001");
    assert.equal(restored.status, "FAILED");
    assert.equal(restored.lastError, "RUNTIME_RESTART_INTERRUPTED");
    const log = await readFile(workspace.paths("restart_run_001").sceneLog, "utf8");
    assert.match(log, /"type":"runtime_recovered"/);
    assert.match(log, /"priorStatus":"FOREGROUND_RUNNING"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class ScriptedProvider implements OpenNovelProvider {
  readonly calls: ProviderRequest[] = [];
  beforeGenerate?: (request: ProviderRequest) => Promise<void> | void;
  readonly script: {
    narrator: Array<string | Error>;
    reviewer: Array<string | Error>;
    repair: Array<string | Error>;
    options: Array<string | Error>;
    storykeeper: Array<string | Error>;
  };

  constructor(script: Partial<ScriptedProvider["script"]> = {}) {
    this.script = {
      narrator: [...(script.narrator || [])],
      reviewer: [...(script.reviewer || [])],
      repair: [...(script.repair || [])],
      options: [...(script.options || [])],
      storykeeper: [...(script.storykeeper || [])],
    };
  }

  describe() {
    return { provider: "scripted", model: "test", configured: true };
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    await this.beforeGenerate?.(request);
    this.calls.push(request);
    const value = this.script[request.profile].shift();
    if (value instanceof Error) throw value;
    if (value === undefined) {
      throw new Error(`No scripted ${request.profile} response`);
    }
    if (request.stream && request.onDelta) {
      for (let index = 0; index < value.length; index += 24) {
        request.onDelta(value.slice(index, index + 24));
      }
    }
    return {
      text: value,
      model: "scripted-test",
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 1,
    };
  }
}

function cleanTruthReviewJson(draft: string) {
  return JSON.stringify({
    assertions: [],
    originActionAssessments: buildTruthReviewUnits(draft).map((unit) => ({
      unitId: unit.unitId,
      classification: "NO_DURABLE_ACTION",
      exactQuotes: [],
      confidence: 0.99,
    })),
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
    factClaims: [],
  });
}

async function withRuntime(
  fn: (
    state: {
      runtime: OpenNovelRuntime;
      workspace: FileStoryWorkspace;
      storykeeper: StorykeeperDrain;
      runId: string;
    },
    provider: ScriptedProvider,
  ) => Promise<void>,
  provider = new ScriptedProvider(),
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-openovel-test-"));
  const runId = `test_run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let storykeeper: StorykeeperDrain | undefined;
  try {
    const workspace = new FileStoryWorkspace(root, projectRoot, upstreamCommit);
    storykeeper = new StorykeeperDrain(workspace, provider);
    const runtime = new OpenNovelRuntime(workspace, provider, storykeeper, new NoopMirror());
    await runtime.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    await fn({ runtime, workspace, storykeeper, runId }, provider);
  } finally {
    await storykeeper?.kick(runId).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

function storykeeperPatch(
  sections: Record<string, string> = {},
  contextCards: Array<{
    slug: string;
    triggers: string[];
    body: string;
    curate?: boolean;
  }> = [],
  directorArc = "",
  storyMemory = "",
) {
  return JSON.stringify({
    summary: "updated next foreground",
    sections,
    directorArc,
    storyMemory,
    contextCards,
    qualityNotes: "正文已回应玩家行动；继续观察 NPC 是否主动。",
  });
}
