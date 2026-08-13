import assert from "node:assert/strict";
import { sha256Canonical, type SeatIdV1 } from "@ai-story/shared";
import type { NarrativeContextV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import {
  compilePressureDecisionPresentationContextV1,
  validatePressureDecisionPresentationCandidateV1,
  type PressureDecisionPresentationInputV1,
} from "../../../apps/api/src/pressure-chapter/game-projection/decision-presentation";
import { createPressureNarrativeProviderFromEnvV1 } from "../../../apps/api/src/pressure-chapter/production-config/narrative-provider";

const HASH = "a".repeat(64);
const PLAYER_INPUT = process.env.PRESSURE_LIVE_PLAYER_INPUT?.trim() || "我想睡觉了";
const SCENARIO = process.env.PRESSURE_LIVE_SCENARIO?.trim() || "sleep";

async function main(): Promise<void> {
  const configured = createPressureNarrativeProviderFromEnvV1(process.env);
  assert.ok(configured.provider, "REAL_MODEL_NOT_CONFIGURED");
  assert.ok(configured.decisionPresentationProvider, "REAL_DECISION_MODEL_NOT_CONFIGURED");

  const narrativeContext = SCENARIO === "support-weir"
    ? supportWeirNarrativeContext()
    : sleepNarrativeContext();
  const narrativeCandidate = await configured.provider.render(narrativeContext) as {
  text?: unknown;
  usedFactRefs?: unknown;
  claims?: unknown;
};
assert.equal(typeof narrativeCandidate.text, "string");
const resultText = String(narrativeCandidate.text);
if (SCENARIO === "support-weir") {
  assert.match(resultText, /(增援|堰口|人力|物资)/u, "PLAYER_SUPPORT_NOT_ACKNOWLEDGED");
  assert.match(resultText, /(疏散|记录|封存)/u, "REMAINING_PRESSURE_NOT_PRESERVED");
} else {
  assert.match(resultText, /(睡|歇|休息|疲|倦)/u, "PLAYER_SLEEP_NOT_ACKNOWLEDGED");
}
assert.match(resultText, /(堰|水|百姓|门外|回令|秩序)/u, "PRESSURE_NOT_RETURNED");
assert.doesNotMatch(resultText, /(水患已经彻底解决|秩序已经完全恢复|九堰危机已经结束)/u);
assert.doesNotMatch(resultText, /(堤坝|堰口).{0,4}(崩裂|决口|垮塌)/u, "UNAUTHORIZED_DISASTER_OUTCOME");
assert.doesNotMatch(resultText, /(玩家选择|规则绑定|系统结算|浙江总督选择先)/u, "ENGINEERING_NARRATIVE_COPY");
if (SCENARIO !== "support-weir") {
  assert.doesNotMatch(resultText, /(下令|命人|传令|把.*叫到|先把.*稳住)/u, "PLAYER_NEXT_ORDER_PREEMPTED");
}
  console.log(JSON.stringify({
  test: 1,
  kind: "POST_BEAT_NARRATIVE",
  playerInput: PLAYER_INPUT,
  output: narrativeCandidate,
}, null, 2));

  if (process.env.PRESSURE_LIVE_SMOKE_STAGE === "narrative") return;

  const presentationContext = compilePressureDecisionPresentationContextV1(
    decisionInput(resultText),
  );
  const presentationCandidate = validatePressureDecisionPresentationCandidateV1(
    await configured.decisionPresentationProvider.renderDecisionPresentation(
      presentationContext,
    ),
    presentationContext,
  );
  assert.deepEqual(
  presentationCandidate.options.map((option) => option.actionType).sort(),
  ["EVACUATE_WEIRS", "SEAL_BREACH_RECORD", "SUPPORT_WEIR"].sort(),
);
  assert.match(
  `${presentationCandidate.sceneText}${presentationCandidate.question}`,
  /(堰|水|百姓|门外|回令|秩序)/u,
  "NEXT_DECISION_NOT_CONNECTED_TO_PRESSURE",
);
  assert.doesNotMatch(
    JSON.stringify(presentationCandidate.options),
    /(削弱海防|银两扣除|必然成功|彻底解决)/u,
    "OPTION_INVENTED_COST_OR_GUARANTEE",
  );
  assert.doesNotMatch(
    presentationCandidate.sceneText,
    /(半张告示|领粮|三道旧痕|倭船|海上异动|经手人名册)/u,
    "UNGROUNDED_DECISION_SCENE_DETAIL",
  );
  console.log(JSON.stringify({
  test: 2,
  kind: "NEXT_DECISION_PRESENTATION",
  contextHash: presentationContext.contextHash,
  output: presentationCandidate,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function sleepNarrativeContext(): NarrativeContextV1 {
  const facts = [
    fact("story.player_action.zhejiang_governor", `浙江总督选择先“${PLAYER_INPUT}”。`),
    fact("story.player_input.zhejiang_governor", PLAYER_INPUT),
    fact("story.result.evacuation", "堰区疏散尚未展开。"),
    fact("story.result.records", "毁堤记录尚未得到封存。"),
    fact("story.result.severity", "九堰水势仍在继续上涨。"),
    fact("story.result.weirs", "关键堰口尚未得到增援。"),
    fact("story.unresolved_pressure.01", "总督府门外已有百姓与差役堵门催令。"),
    fact("story.next_direction", "当前必须决定如何维护门前秩序并处理九堰危机，可行动方向为疏散百姓、封存记录或增援堰口。"),
  ];
  const requiredIds = new Set([
    "story.result.evacuation",
    "story.result.weirs",
    "story.unresolved_pressure.01",
  ]);
  const base = {
    schemaVersion: "pressure_narrative_context_v1" as const,
    contextCompilerVersion: "live-sleep-smoke-v1",
    projectionKind: "BEAT_NARRATIVE" as const,
    audience: { kind: "SEAT" as const, seatId: "zhejiang_governor" as SeatIdV1 },
    sourceId: HASH,
    sourceCommitHash: HASH,
    sourceContentHash: HASH,
    temporalInstruction: "Only committed Working facts may be narrated; the player's rest attempt creates no formal crisis-resolution effect.",
    facts,
    objects: [],
    knowledge: [],
    allowedClaims: facts.map((item) => ({
      kind: "FACT" as const,
      refId: item.factId,
      statement: item.text,
      required: requiredIds.has(item.factId),
    })),
    variant: {
      kind: "BEAT" as const,
      chapterId: "N1" as const,
      workingRevision: 1,
      temporalBoundary: "WORKING_NOT_FROZEN" as const,
    },
  };
  return { ...base, contextHash: sha256Canonical(base) };
}

function supportWeirNarrativeContext(): NarrativeContextV1 {
  const facts = [
    fact("story.player_action.zhejiang_governor", "胡宗宪调动可用人力与物资增援关键堰口。"),
    fact("story.player_input.zhejiang_governor", "增援关键堰口"),
    fact("story.result.weirs", "两处关键堰口已经得到人力与物资增援。"),
    fact("story.result.severity", "整体水患压力有所缓解。"),
    fact("story.result.evacuation", "堰区疏散尚未展开。"),
    fact("story.result.records", "毁堤记录尚未得到封存。"),
    fact("story.unresolved_pressure.01", "低洼堰区的百姓仍在等待疏散。"),
    fact("story.unresolved_pressure.02", "毁堤命令与经手记录仍需尽快封存。"),
    fact("story.next_direction", "关键堰口得到增援后，仍须决定先组织百姓疏散、先封存毁堤记录，还是继续向其余堰口调配增援。"),
  ];
  const requiredIds = new Set([
    "story.result.weirs",
    "story.result.evacuation",
    "story.result.records",
  ]);
  const base = {
    schemaVersion: "pressure_narrative_context_v1" as const,
    contextCompilerVersion: "live-support-weir-smoke-v1",
    projectionKind: "BEAT_NARRATIVE" as const,
    audience: { kind: "SEAT" as const, seatId: "zhejiang_governor" as SeatIdV1 },
    sourceId: HASH,
    sourceCommitHash: HASH,
    sourceContentHash: HASH,
    temporalInstruction: "Narrate only the committed Working effects: two critical weirs received support and overall pressure eased; evacuation and record sealing remain unresolved.",
    facts,
    objects: [],
    knowledge: [],
    allowedClaims: facts.map((item) => ({
      kind: "FACT" as const,
      refId: item.factId,
      statement: item.text,
      required: requiredIds.has(item.factId),
    })),
    variant: {
      kind: "BEAT" as const,
      chapterId: "N1" as const,
      workingRevision: 2,
      temporalBoundary: "WORKING_NOT_FROZEN" as const,
    },
  };
  return { ...base, contextHash: sha256Canonical(base) };
}

function decisionInput(previousNarrative: string): PressureDecisionPresentationInputV1 {
  const supportWeir = SCENARIO === "support-weir";
  return {
    chapter: {
      chapterRuntimeId: "live-sleep-smoke:N1",
      chapterId: "N1",
      chapterNumber: 1,
      title: "九堰将决",
      phase: "ACTIVE",
      workingRevision: supportWeir ? 2 : 1,
    },
    viewer: {
      seatId: "zhejiang_governor",
      roleName: "浙江总督",
      control: {
        mode: "HUMAN_ACTIVE",
        controlEpoch: 1,
        canSubmit: true,
        canReclaim: false,
        submissionFenceToken: HASH,
        reclaimFenceToken: null,
      },
    },
    situation: {
      goal: supportWeir ? "在堰口得到增援后继续处理疏散与毁堤记录" : "恢复总督府门前秩序并处理九堰危机",
      risk: supportWeir ? "只守堰而不疏散、不封存记录，百姓和责任链仍会暴露在风险中" : "继续拖延会让水患与人群同时失控",
      judgment: supportWeir ? "增援缓解了部分水患压力，但没有完成疏散和证据保护" : "休息没有解决眼前压力",
    },
    metrics: [],
    resources: [],
    narrative: {
      status: "PUBLISHED",
      projectionKind: "BEAT_NARRATIVE",
      sourceAuthority: "CHAPTER_WORKING",
      sourceId: HASH,
      sourceCommitHash: HASH,
      text: previousNarrative,
      contentHash: HASH,
      renderMode: "PROVIDER",
    },
    decision: {
      decisionPointId: "N1.weir_crisis",
      mode: "SOLO_BEAT",
      requirement: "REQUIRED",
      title: "你要如何应对？",
      summary: supportWeir
        ? "两处关键堰口已得到增援，但百姓疏散和毁堤记录封存仍未完成。"
        : "浙江总督短暂休息并未消除压力，门外秩序与九堰水患仍在逼近。",
      expectedWorkingRevision: supportWeir ? 2 : 1,
      options: [
        option("EVACUATE_WEIRS", "PLAN", "组织堰区疏散", "调度堰区百姓与运输力量撤离。"),
        option("SEAL_BREACH_RECORD", "INVESTIGATE", "封存毁堤记录", "封存命令、经手人与见证记录。"),
        option("SUPPORT_WEIR", "TOKEN", "增援关键堰口", "调动人力物资增援关键堰口。"),
      ],
      submitLabel: "确认正式行动",
      customActionAllowed: true,
    },
  };
}

function fact(factId: string, text: string) {
  return { factId, text, temporalStatus: "COMMITTED_WORKING" as const };
}

function option(
  actionType: string,
  preferredEntry: "PLAN" | "INVESTIGATE" | "TOKEN",
  label: string,
  description: string,
) {
  return { code: actionType, actionType, preferredEntry, label, description };
}
