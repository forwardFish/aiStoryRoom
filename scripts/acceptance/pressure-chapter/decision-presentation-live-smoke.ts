import assert from "node:assert/strict";
import {
  compilePressureTurnPresentationContextV1,
  validatePressureTurnPresentationCandidateV1,
  type PressureTurnPresentationInputV1,
} from "../../../apps/api/src/pressure-chapter/game-projection/decision-presentation";
import { createPressureNarrativeProviderFromEnvV1 } from "../../../apps/api/src/pressure-chapter/production-config/narrative-provider";

const HASH = "a".repeat(64);
const SCENARIO = process.env.PRESSURE_LIVE_SCENARIO?.trim() || "sleep";

async function main(): Promise<void> {
  const configured = createPressureNarrativeProviderFromEnvV1(process.env);
  assert.equal(configured.provider, null, "BACKGROUND_NARRATIVE_MODEL_MUST_BE_DISABLED");
  assert.ok(configured.turnPresentationProvider, "REAL_TURN_MODEL_NOT_CONFIGURED");
  const previousNarrative = SCENARIO === "support-weir"
    ? "两处关键堰口已经得到人力与物资增援，整体水患压力有所缓解。堰区疏散尚未展开，毁堤记录尚未得到封存。"
    : "胡宗宪短暂歇息后被门外催令声惊醒。九堰水势仍在继续上涨，疏散、守堰和记录封存都还等着回令。";
  const presentationContext = compilePressureTurnPresentationContextV1(
    decisionInput(previousNarrative),
  );
  const startedAt = Date.now();
  const presentationCandidate = validatePressureTurnPresentationCandidateV1(
    await configured.turnPresentationProvider.renderTurnPresentation(
      presentationContext,
    ),
    presentationContext,
  );
  const latencyMs = Date.now() - startedAt;
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
    test: "PRESSURE_ONE_CALL_TURN_PRESENTATION_LIVE_V1",
    callCount: 1,
    latencyMs,
    contextHash: presentationContext.contextHash,
    output: presentationCandidate,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function decisionInput(previousNarrative: string): PressureTurnPresentationInputV1 {
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

function option(
  actionType: string,
  preferredEntry: "PLAN" | "INVESTIGATE" | "TOKEN",
  label: string,
  description: string,
) {
  return { code: actionType, actionType, preferredEntry, label, description };
}
