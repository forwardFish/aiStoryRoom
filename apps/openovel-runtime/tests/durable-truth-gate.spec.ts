import assert from "node:assert/strict";
import test from "node:test";
import {
  durableAnchorGroupPresent,
  validateDurableTruth,
} from "../src/durable-truth-gate.js";
import type { CausalDelta } from "../src/types.js";

test("ordinary camera texture around a durable object never becomes a transfer", () => {
  const result = validateDurableTruth({
    narration: "书吏没有碰案上的回文匣，只把目光移到匣角，等着总督发问。灯花轻轻爆了一声。",
    readerAction: "继续追问书吏县册是谁经手的。",
    knownContext: "回文匣仍在案上。书吏在场。",
    causalDelta: delta(),
    policy: {
      evidenceSubjects: ["回文匣"],
      registeredObjects: [{ subject: "回文匣", closureState: "CLOSED" }],
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.hardIssues, []);
});

test("the same camera rule is generic in a second world", () => {
  const result = validateDurableTruth({
    narration: "导航员的视线落到航图筒上，手却仍按在膝头。舷窗外的红光一闪而过。",
    readerAction: "询问导航员刚才看见了什么。",
    knownContext: "航图筒锁在桌架上。导航员在场。",
    causalDelta: delta(),
    policy: {
      protagonistLabels: ["舰长"],
      evidenceSubjects: ["航图筒"],
      registeredObjects: [{ subject: "航图筒", closureState: "LOCKED" }],
    },
  });
  assert.equal(result.ok, true);
});

test("an explicit unapproved custody transfer is a hard durable error", () => {
  const result = validateDurableTruth({
    narration: "书吏起身，把回文匣交给巡抚带走。",
    readerAction: "继续追问书吏县册是谁经手的。",
    knownContext: "回文匣在案上，巡抚尚未取得它。",
    causalDelta: delta(),
    policy: {
      evidenceSubjects: ["回文匣"],
      registeredObjects: [{ subject: "回文匣", closureState: "CLOSED" }],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.hardIssues.some((issue) =>
    issue.code === "UNAUTHORIZED_DURABLE_STATE_CHANGE"
  ));
});

test("a clearly introduced named actor is rejected but an unnamed attendant is texture", () => {
  const named = validateDurableTruth({
    narration: "门外来了个自称沈明远的人，说是奉命候见。",
    readerAction: "继续问眼前的书吏。",
    knownContext: "当前只有书吏与总督在场。",
    causalDelta: delta(),
  });
  assert.equal(named.ok, false);
  assert.ok(named.hardIssues.some((issue) =>
    issue.code === "UNAUTHORIZED_NAMED_CHARACTER"
  ));

  const unnamed = validateDurableTruth({
    narration: "门外一个没有通名的随从停住脚步，不敢进门。",
    readerAction: "继续问眼前的书吏。",
    knownContext: "府中有普通随从。",
    causalDelta: delta(),
  });
  assert.equal(unnamed.ok, true);
});

test("new evidence must have an authorized source", () => {
  const result = validateDurableTruth({
    narration: "书吏忽从袖中取出一册暗账，摆到案前。",
    readerAction: "继续核对县册经手人。",
    knownContext: "当前只确认县册可能有疑。",
    causalDelta: delta(),
    policy: { evidenceSubjects: ["县册", "暗账"] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.hardIssues.some((issue) =>
    issue.code === "UNAUTHORIZED_NEW_EVIDENCE"
  ));
});

test("asserted secret knowledge is rejected while uncertainty remains playable", () => {
  const boundary = ["巡抚就是幕后主使"];
  const leaked = validateDurableTruth({
    narration: "书吏压低声音说，巡抚就是幕后主使，此事已经坐实。",
    readerAction: "问他知道多少。",
    knownContext: "幕后主使尚未确认。",
    causalDelta: delta({ forbiddenKnowledge: boundary }),
  });
  assert.equal(leaked.ok, false);
  assert.ok(leaked.hardIssues.some((issue) =>
    issue.code === "SECRET_LEAK_WARNING"
  ));

  const uncertain = validateDurableTruth({
    narration: "书吏摇头，说巡抚是不是幕后主使，他并不知道，也无凭据。",
    readerAction: "问他知道多少。",
    knownContext: "幕后主使尚未确认。",
    causalDelta: delta({ forbiddenKnowledge: boundary }),
  });
  assert.equal(uncertain.ok, true);
});

test("the Narrator cannot add a player signature or promise", () => {
  const signed = validateDurableTruth({
    narration: "总督听罢，当即签发公文，又答应三日内替巡抚担责。",
    readerAction: "继续追问，但暂不签发公文。",
    knownContext: "公文仍未签发。",
    causalDelta: delta(),
    policy: { knownFormalArtifacts: ["公文"] },
  });
  assert.equal(signed.ok, false);
  assert.ok(signed.hardIssues.some((issue) =>
    issue.code === "PLAYER_ACTION_OVERREACH"
  ));
});

test("only an explicitly present durable result is mandatory", () => {
  const required = delta({
    requiredNarrativeFacts: ["巡抚公开提出分责"],
    beatContract: {
      sourceRef: "part-one-event:T01",
      objective: "让巡抚公开提出分责",
      moves: [],
      requiredAnchorGroups: [["书吏停在门内"]],
      requiredDurableAnchorGroups: [["巡抚公开提出分责"]],
      authorizedPlayerActions: [],
      constraints: [],
      stopCondition: "等待总督回应",
    },
  });
  const result = validateDurableTruth({
    narration: "书吏停在门内，只说巡抚仍在等回话。",
    readerAction: "留下书吏继续问话。",
    knownContext: "巡抚尚未公开提出分责。",
    causalDelta: required,
  });
  assert.equal(result.ok, false);
  assert.ok(result.hardIssues.some((issue) =>
    issue.code === "MISSING_REQUIRED_DURABLE_RESULT"
  ));
});

test("uncertain quantities and locations are Shadow warnings, not blockers", () => {
  const result = validateDurableTruth({
    narration: "书吏说县册约有三页存于档房，话说得很轻，自己也不敢断定。",
    readerAction: "询问县册目前能否复核。",
    knownContext: "县册可能有疑，页数和所在地尚未核实。",
    causalDelta: delta(),
    policy: {
      evidenceSubjects: ["县册"],
      trackedLocations: ["档房"],
    },
  });
  assert.equal(result.ok, true);
  assert.ok(result.shadowWarnings.some((warning) =>
    warning.code === "UNVERIFIED_DURABLE_QUANTITY"
  ));
  assert.ok(result.shadowWarnings.every((warning) => !warning.blocksPlayer));
});

test("a missing non-durable scene beat warns Storykeeper but keeps play moving", () => {
  const result = validateDurableTruth({
    narration: "书吏应了一声，仍候在门内。",
    readerAction: "继续问话。",
    knownContext: "书吏在场。",
    causalDelta: delta({
      beatContract: {
        sourceRef: "part-one-event:T01",
        objective: "推进问话",
        moves: [],
        requiredAnchorGroups: [["窗外雨声渐紧"]],
        requiredDurableAnchorGroups: [],
        authorizedPlayerActions: [],
        constraints: [],
        stopCondition: "等待下一问",
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.ok(result.shadowWarnings.some((warning) =>
    warning.code === "MISSING_SURFACE_BEAT"
  ));
});

test("a durable noun in one clause does not bind to another clause's verb", () => {
  const result = validateDurableTruth({
    narration: "案上的密信仍压在砚下，屋里却已经不再只是等候落印的局面。",
    readerAction: "先听书吏把原话说完，不落印。",
    knownContext: "密信在案上，公文尚未落印。",
    causalDelta: delta(),
    policy: { evidenceSubjects: ["密信", "公文"] },
  });
  assert.equal(result.ok, true);
});

test("an NPC conditional addressed to the protagonist is not a player action", () => {
  const result = validateDurableTruth({
    narration: "幕僚道：\"制台若具名，中丞派人到场记入复核；制台若不具名，此事便仍悬着。\"",
    readerAction: "先问县令，清流第一批改田需要几日。",
    knownContext: "巡抚幕僚在场争取参加复核。",
    causalDelta: delta(),
    policy: { protagonistLabels: ["浙江总督", "总督", "制台"] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.hardIssues.length, 0);
});

test("an NPC may propose a signature and delegation without executing the player action", () => {
  const result = validateDurableTruth({
    narration: "幕僚听完，先开了口：\"总督签，巡抚派人到场同记。若总督不签，这桩事便无人认。\"",
    readerAction: "先问县令，清流第一批改田需要几日。",
    knownContext: "巡抚幕僚在场争取参加复核。",
    causalDelta: delta(),
    policy: { protagonistLabels: ["浙江总督", "总督", "制台"] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.hardIssues.length, 0);
});

test("a protagonist quote that adds an unchosen signature remains a hard error", () => {
  const result = validateDurableTruth({
    narration: "总督看向幕僚，道：\"明日我便签发公文，再派人到清流。\"",
    readerAction: "先问县令，清流第一批改田需要几日。",
    knownContext: "公文尚未签发。",
    causalDelta: delta(),
    policy: { protagonistLabels: ["浙江总督", "总督", "制台"] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.hardIssues.some((issue) => (
    issue.code === "PLAYER_ACTION_OVERREACH"
    && issue.details?.axis === "SIGN"
  )));
});
test("new numeric claims in NPC dialogue remain Shadow truth", () => {
  const result = validateDurableTruth({
    narration: "县令道：\"清流有三处可先办，十日可成，还有两户未画押。\"",
    readerAction: "先问县令，清流第一批改田需要几日。",
    knownContext: "清流试办范围尚待核实。",
    causalDelta: delta(),
    policy: { durableClaimSubjects: ["清流", "改田", "户"] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.hardIssues.length, 0);
  assert.ok(result.shadowWarnings.some((warning) => (
    warning.code === "UNVERIFIED_DURABLE_QUANTITY"
  )));
});

test("an unchosen secrecy order is a hard player overreach", () => {
  const result = validateDurableTruth({
    narration: "总督叫值差去查米价，又补了一句：不必声张，也不要知会巡抚衙门。",
    readerAction: "叫人去查城中米价。",
    knownContext: "米价等待查验。",
    causalDelta: delta(),
    policy: { protagonistLabels: ["总督"] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.hardIssues.some((issue) => (
    issue.code === "PLAYER_ACTION_OVERREACH"
    && issue.details?.axis === "SECRECY"
  )));
});

test("a settled earlier decision may be referenced without becoming a new act", () => {
  const result = validateDurableTruth({
    narration: "总督此前暂缓签发的决定已经传到这一步，巡抚把压力转到了答复时辰。",
    readerAction: "让书吏说明巡抚要什么答复。",
    knownContext: "上一回合总督把公文留在案上，没有签发。",
    causalDelta: delta(),
    policy: { protagonistLabels: ["总督"] },
  });
  assert.equal(result.ok, true);
});

test("an unverified custody claim becomes Shadow instead of a blocker", () => {
  const result = validateDurableTruth({
    narration: "亲随说清流县的册子没有人碰过，也没有人看过。",
    readerAction: "问亲随原册现在由谁看守。",
    knownContext: "册子保管状态尚未核实。",
    causalDelta: delta(),
    policy: { evidenceSubjects: ["册子"], trackedLocations: ["清流县"] },
  });
  assert.equal(result.ok, true);
  assert.ok(result.shadowWarnings.some((warning) => (
    warning.code === "UNVERIFIED_DURABLE_CUSTODY"
  )));
});
test("a role label inside a location is never treated as the protagonist", () => {
  const result = validateDurableTruth({
    narration: "五月初九巳时，总督府签押房。窗半开，案上只有白纸和砚。",
    readerAction: "请巡抚共同具名。",
    knownContext: "次日转到总督府签押房。",
    causalDelta: delta(),
    policy: { protagonistLabels: ["总督"] },
  });
  assert.equal(result.ok, true);
});

test("an unapproved evidence draft carried into a new scene is rejected", () => {
  const result = validateDurableTruth({
    narration: "改桑书吏站在门侧，怀里抱着昨日誊抄的底稿。",
    readerAction: "请巡抚共同具名。",
    knownContext: "县册原件和副本尚未呈到签押房。",
    causalDelta: delta(),
    policy: { evidenceSubjects: ["底稿", "副本"] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.hardIssues.some((issue) => issue.code === "UNAUTHORIZED_NEW_EVIDENCE"));
});
test("one durable semantic matcher is reusable by release and consequence settlement", () => {
  assert.equal(
    durableAnchorGroupPresent("幕僚追问：是谁耽误了国策？", ["耽误国策"]),
    true,
  );
  assert.equal(
    durableAnchorGroupPresent("幕僚只说中丞未必等得及。", ["耽误国策", "迟疑", "误期"]),
    false,
  );
});
test("negation before a comma does not revoke the selected action after it", () => {
  const selected = "暂不签发放行文书，先封存清流县档房；若误了三日期限，由总督自行担责。";
  const result = validateDurableTruth({
    narration: "总督道：\"清流县档房，即日起封存。\"",
    readerAction: selected,
    knownContext: "清流县档房尚未封存。",
    causalDelta: delta({ readerAction: selected, immediateIntent: selected }),
    policy: { protagonistLabels: ["浙江总督", "总督", "制台"] },
  });
  assert.equal(result.ok, true);
});

test("the same compound-action authorization works in a second world but still blocks an extra order", () => {
  const selected = "暂不签发航行许可，先扣押无人机。";
  const authorized = validateDurableTruth({
    narration: "舰长道：\"先把无人机扣押。\"",
    readerAction: selected,
    knownContext: "无人机仍在货舱。",
    causalDelta: delta({ readerAction: selected, immediateIntent: selected }),
    policy: { protagonistLabels: ["舰长"] },
  });
  assert.equal(authorized.ok, true);

  const overreach = validateDurableTruth({
    narration: "舰长又派人搜查货舱。",
    readerAction: selected,
    knownContext: "无人机仍在货舱。",
    causalDelta: delta({ readerAction: selected, immediateIntent: selected }),
    policy: { protagonistLabels: ["舰长"] },
  });
  assert.equal(overreach.ok, false);
  assert.ok(overreach.hardIssues.some((issue) => issue.code === "PLAYER_ACTION_OVERREACH"));
});
test("a natural negated durable result satisfies its semantic anchor", () => {
  const result = validateDurableTruth({
    narration: "巡抚幕僚正式答复：昨日的放行回文，巡抚不在其上共同具名。",
    readerAction: "请巡抚共同具名。",
    knownContext: "巡抚尚未答复。",
    causalDelta: delta({
      beatContract: {
        sourceRef: "second-world-compatible",
        objective: "取得联署答复",
        moves: [],
        requiredAnchorGroups: [["拒绝共同具名", "不具名"]],
        requiredDurableAnchorGroups: [["拒绝共同具名", "不具名"]],
        authorizedPlayerActions: [],
        constraints: [],
        stopCondition: "答复后停下",
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.ok(result.hardIssues.every((issue) => issue.code !== "MISSING_REQUIRED_DURABLE_RESULT"));
});
function delta(overrides: Partial<CausalDelta> = {}): CausalDelta {
  return {
    turnId: "T01",
    source: "free-text",
    readerAction: "继续追问。",
    immediateIntent: "继续追问。",
    protagonistScope: "inquiry-only",
    stopCondition: "对方直接回应后停下。",
    allowedKnowledge: [],
    forbiddenKnowledge: [],
    evidenceSubjects: [],
    beatContract: null,
    durableHints: [],
    requiredNarrativeFacts: [],
    ...overrides,
    scenePacket: overrides.scenePacket ?? null,
  };
}
