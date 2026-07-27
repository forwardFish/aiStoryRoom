import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NoopMirror } from "../src/mirror.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { StorykeeperDrain } from "../src/storykeeper.js";
import { OpenNovelRuntime } from "../src/runtime.js";
import { recoverRuntimeRuns } from "../src/recovery.js";
import {
  buildForegroundUserContext,
  buildNarratorMessages,
  buildOptionsMessages,
  compileForegroundContext,
  getStorySnapshot,
  activateContextCards,
} from "../src/foreground.js";
import { shadowContinuityWarnings, validateForegroundSurface } from "../src/surface-guard.js";
import type {
  OpenNovelProvider,
  ProviderRequest,
  ProviderResult,
  TurnEvent,
} from "../src/types.js";

const upstreamCommit = "1b4404e85d03d1e41e5d745e303372333b29c610";
const projectRoot = path.resolve(import.meta.dirname, "..", "..", "..");

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
    assert.match(snapshot.previousOptions[0]?.effect?.intent || "", /两问答完即停/);
    assert.doesNotMatch(snapshot.previousOptions[0]?.effect?.intent || "", /启动复核/);
    const action = "暂不落印，先问清原册为何没有随信送来。";
    const actionScope = "只问密信是否仅为报疑、原册是否并未随信送来；取得原册和启动正式复核仍是下一步决定。";
    const message = buildForegroundUserContext(action, compiled, actionScope);
    assert.match(message, /Foreground Guidance/);
    assert.match(message, /Recent Canon Excerpt/);
    assert.match(message, /本回合行动信封/);
    assert.match(message, /取得原册和启动正式复核仍是下一步决定/);
    assert.equal(
      message.trim().endsWith("不替玩家签发、下令、答复、承诺、放人离场或完成后续处置。"),
      true,
    );
    assert.ok(message.lastIndexOf("## Reader Action") > message.lastIndexOf("## Recent Canon Excerpt"));
    assert.doesNotMatch(message, /Settlement|stateJson|Validator Rule|Section Exit Gate/);

    const prompts = buildNarratorMessages(action, compiled, actionScope);
    assert.equal(prompts.length, 2);
    assert.match(prompts[0].content, /Recent Canon 是当前镜头权威/);
    assert.match(prompts[0].content, /从 Canon 的现在圆回去/);
    assert.match(prompts[0].content, /最新 Reader Action 是本回合唯一的主角行动指令/);
    assert.match(prompts[0].content, /不得替主角新增签发、落印、批准、封存、调人、行文、承诺、离场/);
    assert.match(prompts[0].content, /调查动作不会自动产生新证据/);
    assert.match(prompts[0].content, /不要为了让问话有内容而编造精确数字、具名经手人/);
    assert.match(prompts[0].content, /目标 300—500 个汉字，硬上限 600 个汉字/);
    assert.doesNotMatch(prompts[0].content, /物件持有人|跨 clause|activeActor/);

    const freeText = buildForegroundUserContext(
      "让书吏把协办办法说清楚，在他说完之前公文仍不签。",
      compiled,
    );
    assert.match(freeText, /以玩家原文自身为即时执行范围/);
    assert.match(freeText, /就在对方作答、拒答或材料呈现后停下/);
    assert.match(freeText, /不替玩家签发、下令、答复、承诺、放人离场/);
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

test("surface guard blocks system failures but not ordinary narrative texture", () => {
  const texture = "总督没有去碰那只匣子，只把目光移到已经合拢的回文匣上。灯火照着案角，书吏的衣袖微微一动，仍旧等着回话。内厅无人催第二遍，门外驿铃却又响了起来。";
  assert.equal(validateForegroundSurface(texture, "").ok, true);
  assert.equal(shadowContinuityWarnings(texture).length, 0);

  assert.equal(validateForegroundSurface('{"narration":"debug"}', "").ok, false);
  assert.equal(validateForegroundSurface("DATABASE_URL=postgres://secret", "").ok, false);
  assert.equal(validateForegroundSurface("```ovl:hud\n粮价: 高", "").ok, false);

  const risky = "总督当即落印批准了改桑放行文书，又答应承担此事全部后果。";
  const warnings = shadowContinuityWarnings(risky);
  assert.ok(warnings.some((warning) => warning.code === "PLAYER_COMMITMENT_WARNING"));
  assert.ok(warnings.every((warning) => warning.blocksPlayer === false));

  const contradiction = shadowContinuityWarnings(
    "总督说：“改桑放行，我今日就签。”随即命人半个时辰内发出封档行文。",
    "暂不签发放行文书，先问清县册疑点。",
  );
  assert.ok(contradiction.some((warning) => warning.code === "READER_ACTION_CONTRADICTION"));
  assert.ok(contradiction.some((warning) => warning.code === "PLAYER_ACTION_OVERREACH"));
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

test("exact opening repeat is suppressed once and regenerated forward", async () => {
  await withRuntime(async ({ runtime, workspace, runId }, provider) => {
    const current = await workspace.readPublicRun(runId);
    provider.script.narrator.push(
      current.recentCanon,
      "总督听完两边的话，仍没有碰案上的印。他让县令亲随靠近一步，只问从县衙到档房共有几道钥匙、今夜是谁值守。亲随答出两个职名，却不敢说人名。巡抚书吏终于把回文匣放低了些，低声道：“大人若要查，也请给中丞一句查到何时。”这一次，问话已经从疑不疑，落到了谁先控制时辰。",
    );
    provider.script.options.push(JSON.stringify({
      options: [
        { label: "命亲随连夜返回清流，先守住档房外门" },
        { label: "留住两边来人，先拟一封只承认查验、不承认案情的回文" },
      ],
      tension: "复核时辰",
    }));
    provider.script.storykeeper.push(storykeeperPatch());
    const deltas: string[] = [];
    const result = await runtime.processAction({
      runId,
      action: "先追问档房今夜由谁值守。",
      onEvent: (event) => {
        if (event.type === "narration.delta") deltas.push(event.data.text);
      },
    });
    assert.match(result.narration, /落到了谁先控制时辰/);
    assert.doesNotMatch(deltas.join(""), /^嘉靖三十五年五月初八/);
    assert.equal(provider.calls.filter((call) => call.profile === "narrator").length, 2);
  }, new ScriptedProvider());
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
  readonly script: {
    narrator: Array<string | Error>;
    options: Array<string | Error>;
    storykeeper: Array<string | Error>;
  };

  constructor(script: Partial<ScriptedProvider["script"]> = {}) {
    this.script = {
      narrator: [...(script.narrator || [])],
      options: [...(script.options || [])],
      storykeeper: [...(script.storykeeper || [])],
    };
  }

  describe() {
    return { provider: "scripted", model: "test", configured: true };
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
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
) {
  return JSON.stringify({
    summary: "updated next foreground",
    sections,
    contextCards,
    qualityNotes: "正文已回应玩家行动；继续观察 NPC 是否主动。",
  });
}
