import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  PartOneCommittedEvent,
  PartOneState,
} from "@ai-story/templates";
import type { PreparedSangtianDecision } from "./sangtian-decisions.js";
import type { EndingModule, EndingModuleInput } from "./ending-module.js";
import { runtimeRoot, workspacePaths } from "./paths.js";
import type { EndingPresentation } from "./types.js";

type EvidenceDirection = "HELPED" | "HURT" | "DECISIVE";
type EvidenceAuthority = "PREDICATE" | "CAUSAL_EVENT" | "DELAYED_EVENT" | "PLAYER_CANON";

type PlayerEndingEvidenceCauseV1 = {
  sourceTurnId: string;
  sourceRevision: number;
  sourceEventId: string;
  authority: EvidenceAuthority;
  visibility: "PLAYER";
  criterion: string;
  factText: string;
  direction: EvidenceDirection;
};

type PlayerEndingEvidenceV1 = {
  schemaVersion: "openovel_player_ending_evidence_v1";
  endingKey: string;
  scope: "PART";
  sourceTurnId: string;
  sourceRevision: number;
  causes: PlayerEndingEvidenceCauseV1[];
  reveal: null;
};

type EndingWithEvidence = EndingPresentation & {
  playerEvidence: PlayerEndingEvidenceV1;
  genericEndgame: GenericEndgameResultArtifactV1;
};

type GenericEndgameResultArtifactV1 = {
  schemaVersion: "generic_endgame_result_artifact_v1";
  sourceRevision: number;
  presentation: Record<string, unknown>;
};

type SangtianOutcome = {
  key: string;
  title: string;
};

type EndingEvidenceCandidate = {
  criterion: string;
  paths: string[];
  finalValue: unknown;
  factText: string;
  direction: EvidenceDirection;
  priority: number;
};

type MatchedEvidence = {
  candidate: EndingEvidenceCandidate;
  event: PartOneCommittedEvent;
};

export type SangtianCommittedEventReader = (
  runId: string,
) => readonly PartOneCommittedEvent[];

export class SangtianEndingModule implements EndingModule {
  readonly moduleId = "sangtian.protagonist-ending.v1";

  constructor(
    private readonly readCommittedEvents: SangtianCommittedEventReader = readCommittedPartOneEvents,
  ) {}

  build(input: EndingModuleInput): EndingPresentation {
    const settlement = sangtianSettlement(input);
    const state = settlement.proposedState;
    assertFinalTurn(input, state);
    const outcome = classify(sangtianFactors(state));
    const ending: EndingPresentation = {
      schemaVersion: "openovel_ending_v1",
      // The currently authored package ends Part One. Keeping this scope
      // explicit prevents a future Part Two from mistaking it for the final
      // fate of the entire four-part saga.
      scope: "PART",
      endingKey: outcome.key,
      title: outcome.title,
      finalSceneNarrative: input.finalNarration.trim(),
      protagonistFate: protagonistFate(state, outcome.key),
      aftermath: directAftermath(state),
      sourceTurnId: input.turnId,
      sourceRevision: input.turnNumber,
    };

    // The persisted Part event history contains only previously committed
    // turns. The current T20 Settlement event is added explicitly because the
    // Ending is compiled before the final atomic Head advances.
    const committedHistory = this.readCommittedEvents(input.runId);
    const playerEvidence = buildPlayerEndingEvidence(
      input,
      settlement,
      state,
      outcome,
      committedHistory,
    );
    return Object.assign(ending, {
      playerEvidence,
      genericEndgame: buildGenericEndgameArtifact(ending, state, outcome),
    } satisfies Pick<EndingWithEvidence, "playerEvidence" | "genericEndgame">);
  }
}

function buildGenericEndgameArtifact(
  ending: EndingPresentation,
  state: PartOneState,
  outcome: SangtianOutcome,
): GenericEndgameResultArtifactV1 {
  const axes = genericOutcomeAxes(state, outcome);
  const metrics = genericEndingMetrics(state);
  const dynamicSubtitle = genericResultSentence(state, outcome.key);
  const sections = genericEndingSections(ending);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      sourceRevision: ending.sourceRevision,
      endingKey: ending.endingKey,
      axes: axes.map((axis) => [axis.axisId, axis.outcomeId]),
      metrics: metrics.map((metric) => [metric.metricId, metric.value]),
      aftermath: ending.aftermath,
    }))
    .digest("hex");
  return {
    schemaVersion: "generic_endgame_result_artifact_v1",
    sourceRevision: ending.sourceRevision,
    presentation: {
      schemaVersion: "endgame_presentation_v3",
      resultType: "SOLO_PART_END",
      world: { worldId: "sangtian", worldTitle: "《桑田诏》" },
      role: { roleId: "zhejiang_governor", roleTitle: "浙江总督" },
      title: "第一部分终章",
      axes,
      metrics,
      dynamicSubtitle,
      style: genericEndingStyle(outcome.key),
      narrative: ending.finalSceneNarrative.trim(),
      sections,
      replayHint: "换一种责任与利益的排序，浙江会留下不同的结果。",
      endingFingerprint: fingerprint,
      replayActions: [
        {
          type: "RESTART_SAME_STORY",
          label: "重新开始",
          href: "/role-select?story=sangtian&start=new",
          enabled: true,
          disabledReason: null,
        },
        {
          type: "CHANGE_ROLE",
          label: "更换角色",
          href: "/role-select?story=sangtian&start=new",
          enabled: true,
          disabledReason: null,
        },
        {
          type: "CONTINUE_NEXT_PART",
          label: "进入下一部分",
          href: null,
          enabled: false,
          disabledReason: "下一部分尚未开放",
        },
        {
          type: "BACK_TO_WORLDS",
          label: "返回世界",
          href: "/worlds",
          enabled: true,
          disabledReason: null,
        },
      ],
    },
  };
}

function genericOutcomeAxes(state: PartOneState, outcome: SangtianOutcome) {
  const protectedPeople = state.land.safeguardStatus === "ACTIVE"
    && state.grain.immediatePressure !== "UNRELIEVED";
  const highExposure = Number(state.responsibility.governorExposure || 0) >= 8;
  return [
    {
      axisId: "world_outcome",
      label: "浙江局势",
      outcomeId: protectedPeople ? "guarded" : "people_exposed",
      title: protectedPeople ? "暂得喘息" : "危局未解",
      summary: protectedPeople
        ? "最急迫的粮食与民田风险暂时受到约束。"
        : "粮食或民田风险仍在继续逼近百姓。",
    },
    {
      axisId: "protagonist_fate",
      label: "你的处境",
      outcomeId: highExposure ? "accepted_burden" : "political_room_retained",
      title: outcome.title,
      summary: highExposure
        ? "你承担了首报与执行边界的责任，也走入了更直接的问责。"
        : "你保留了周旋余地，但责任归属仍会被继续追问。",
    },
  ];
}

function genericEndingMetrics(state: PartOneState) {
  const reportDeparted = reportHasDeparted(state);
  const evidenceStrong = state.evidence.chainStatus === "TRACEABLE"
    && state.report.attachmentStrength !== "NONE";
  const peopleProtected = state.land.safeguardStatus === "ACTIVE";
  const grainRelieved = state.grain.immediatePressure !== "UNRELIEVED";
  const values = {
    imperial_trust: clampMetric(43 + (reportDeparted ? 8 : -8) + (evidenceStrong ? 7 : -7)),
    court_support: clampMetric(42 + (state.report.authorshipMode === "JOINT" ? 6 : 0) - (state.report.dispatchStatus === "SPLIT" ? 3 : 0)),
    reform_progress: clampMetric(peopleProtected ? 65 : 35),
    grain_price: clampMetric(72 + (grainRelieved ? -18 : 8)),
    public_support: clampMetric(55 + (peopleProtected ? 10 : -12) + (grainRelieved ? 8 : -8)),
  };
  const definitions = [
    ["imperial_trust", "皇帝信任", "HIGH_GOOD", 43],
    ["court_support", "朝中支持", "HIGH_GOOD", 42],
    ["reform_progress", "改桑进度", "CONTEXTUAL", 0],
    ["grain_price", "粮价", "LOW_GOOD", 72],
    ["public_support", "民心", "HIGH_GOOD", 55],
  ] as const;
  return definitions.map(([metricId, label, direction, initialValue]) => ({
    metricId,
    label,
    value: values[metricId],
    formattedValue: String(values[metricId]),
    direction,
    initialValue,
  }));
}

function clampMetric(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function genericResultSentence(state: PartOneState, endingKey: string) {
  const protectedPeople = state.land.safeguardStatus === "ACTIVE"
    && state.grain.immediatePressure !== "UNRELIEVED";
  const evidenceStrong = state.evidence.chainStatus === "TRACEABLE";
  if (protectedPeople && evidenceStrong && endingKey === "guarded_people_bore_responsibility") {
    return "你守住了民田与证据，也把随之而来的问责留在了自己名下。";
  }
  if (protectedPeople && evidenceStrong) {
    return "你让浙江暂得喘息，但真正的裁定仍在来路上。";
  }
  if (evidenceStrong) {
    return "证据已经上路，百姓付出的代价却还没有停止。";
  }
  return "这场危局没有被真正截住，你只能带着未竟之责等待下一次追问。";
}

function genericEndingStyle(endingKey: string) {
  if (endingKey === "guarded_people_bore_responsibility") {
    return { styleId: "bittersweet", label: "悲欣交集" };
  }
  if (endingKey === "guarded_people_preserved_evidence") {
    return { styleId: "restrained_celebration", label: "克制庆贺" };
  }
  if (endingKey === "executed_policy_lost_people") {
    return { styleId: "restrained_sorrow", label: "克制悲怆" };
  }
  return { styleId: "solemn_open", label: "沉郁未决" };
}

function genericEndingSections(ending: EndingPresentation) {
  const aftermathItems = ending.aftermath.map((text, index) => ({
    title: index === ending.aftermath.length - 1 ? "未完局势" : `局势 ${index + 1}`,
    text,
    actorName: null,
    stageIndex: null,
  }));
  return [
    {
      sectionId: "result",
      label: "本局结果",
      layout: "LIST",
      items: [{ title: ending.title, text: ending.protagonistFate, actorName: null, stageIndex: null }],
    },
    {
      sectionId: "open",
      label: "未完局势",
      layout: "LIST",
      items: aftermathItems,
    },
  ];
}

function sangtianSettlement(input: EndingModuleInput) {
  const payload = input.preparedDecision?.payload as PreparedSangtianDecision | undefined;
  const settlement = payload?.settlement;
  const state = settlement?.proposedState;
  if (!state || state.partCompletionStatus !== "HANDOFF_READY") {
    throw new Error("SANGTIAN_ENDING_STATE_NOT_READY");
  }
  return settlement;
}

function assertFinalTurn(input: EndingModuleInput, state: PartOneState) {
  if (input.turnId !== "T20" || input.turnNumber !== 20 || state.turnNumber !== 20) {
    throw new Error("SANGTIAN_ENDING_FINAL_TURN_MISMATCH");
  }
}

function sangtianFactors(state: PartOneState) {
  return {
    protectedPeople: state.land.safeguardStatus === "ACTIVE"
      && state.grain.immediatePressure !== "UNRELIEVED",
    preservedEvidence: state.evidence.chainStatus === "TRACEABLE"
      && state.report.attachmentStrength !== "NONE",
    reportDeparted: reportHasDeparted(state),
    highExposure: Number(state.responsibility.governorExposure || 0) >= 8,
  };
}

function classify(input: {
  protectedPeople: boolean;
  preservedEvidence: boolean;
  reportDeparted: boolean;
  highExposure: boolean;
}): SangtianOutcome {
  if (input.protectedPeople && input.preservedEvidence && input.highExposure) {
    return { key: "guarded_people_bore_responsibility", title: "守土担责" };
  }
  if (input.protectedPeople && input.preservedEvidence) {
    return { key: "guarded_people_preserved_evidence", title: "持证守土" };
  }
  if (input.reportDeparted && input.preservedEvidence) {
    return { key: "evidence_entered_capital", title: "孤证入京" };
  }
  if (!input.protectedPeople) {
    return { key: "executed_policy_lost_people", title: "奉旨失民" };
  }
  return { key: "crisis_unresolved", title: "危局未决" };
}

function buildPlayerEndingEvidence(
  input: EndingModuleInput,
  settlement: PreparedSangtianDecision["settlement"],
  state: PartOneState,
  outcome: SangtianOutcome,
  committedHistory: readonly PartOneCommittedEvent[],
): PlayerEndingEvidenceV1 {
  const events = committedPartEvents(
    committedHistory,
    settlement.event,
    input.turnNumber,
  );
  const matched = endingEvidenceCandidates(state, outcome.key)
    .map((candidate): MatchedEvidence | null => {
      const event = latestEventEstablishingFinalValue(events, candidate);
      return event ? { candidate, event } : null;
    })
    .filter((item): item is MatchedEvidence => Boolean(item));

  const groupedByTurn = new Map<number, MatchedEvidence[]>();
  for (const item of matched) {
    const rows = groupedByTurn.get(item.event.turnNumber) || [];
    rows.push(item);
    groupedByTurn.set(item.event.turnNumber, rows);
  }

  const ranked = [...groupedByTurn.entries()].map(([turnNumber, rows]) => {
    const ordered = [...rows].sort((left, right) => (
      directionPriority(right.candidate.direction) - directionPriority(left.candidate.direction)
      || right.candidate.priority - left.candidate.priority
      || left.candidate.criterion.localeCompare(right.candidate.criterion)
    ));
    const lead = ordered[0]!;
    const direction = ordered.reduce<EvidenceDirection>(
      (current, item) => directionPriority(item.candidate.direction) > directionPriority(current)
        ? item.candidate.direction
        : current,
      lead.candidate.direction,
    );
    const facts = [...new Set(ordered.map((item) => item.candidate.factText.trim()).filter(Boolean))];
    return {
      sourceTurnId: `T${String(turnNumber).padStart(2, "0")}`,
      sourceRevision: turnNumber,
      sourceEventId: lead.event.eventId,
      authority: "PREDICATE" as const,
      visibility: "PLAYER" as const,
      criterion: ordered.length === 1
        ? lead.candidate.criterion
        : "MULTIPLE_ENDING_DETERMINANTS",
      factText: facts.join("；"),
      direction,
      priority: Math.max(...ordered.map((item) => item.candidate.priority)),
    };
  });

  const causes = ranked
    .sort((left, right) => (
      directionPriority(right.direction) - directionPriority(left.direction)
      || right.priority - left.priority
      || left.sourceRevision - right.sourceRevision
      || left.sourceEventId.localeCompare(right.sourceEventId)
    ))
    .slice(0, 3)
    .sort((left, right) => (
      left.sourceRevision - right.sourceRevision
      || left.sourceEventId.localeCompare(right.sourceEventId)
    ))
    .map(({ priority: _priority, ...cause }) => cause);

  return {
    schemaVersion: "openovel_player_ending_evidence_v1",
    endingKey: outcome.key,
    scope: "PART",
    sourceTurnId: input.turnId,
    sourceRevision: input.turnNumber,
    causes,
    // Part One aftermath remains available as ordinary ending copy. It is not
    // automatically promoted to a secret reveal; a future reveal requires an
    // explicit visibility authorizer and source event.
    reveal: null,
  };
}

function endingEvidenceCandidates(
  state: PartOneState,
  endingKey: string,
): EndingEvidenceCandidate[] {
  const landProtected = state.land.safeguardStatus === "ACTIVE";
  const grainRelieved = state.grain.immediatePressure !== "UNRELIEVED";
  const evidenceTraceable = state.evidence.chainStatus === "TRACEABLE";
  const attachmentPresent = state.report.attachmentStrength !== "NONE";
  const reportDeparted = reportHasDeparted(state);
  const highExposure = Number(state.responsibility.governorExposure || 0) >= 8;
  return [
    {
      criterion: "PEOPLE_LAND_SAFEGUARD",
      paths: ["land.safeguardStatus"],
      finalValue: state.land.safeguardStatus,
      factText: landProtected
        ? "灾期民田保护已经写入最终提交状态。"
        : "最终提交状态中没有建立有效的灾期民田保护。",
      direction: directDirection(endingKey, "LAND", landProtected),
      priority: 60,
    },
    {
      criterion: "PEOPLE_GRAIN_RELIEF",
      paths: ["grain.immediatePressure"],
      finalValue: state.grain.immediatePressure,
      factText: grainRelieved
        ? "最急迫的粮食压力已经得到缓解。"
        : "最急迫的粮食压力仍未解除。",
      direction: directDirection(endingKey, "GRAIN", grainRelieved),
      priority: 55,
    },
    {
      criterion: "EVIDENCE_CHAIN",
      paths: ["evidence.chainStatus"],
      finalValue: state.evidence.chainStatus,
      factText: evidenceTraceable
        ? "县册证据链已经保持为可追索状态。"
        : "县册证据链在最终提交时仍不可完整追索。",
      direction: directDirection(endingKey, "EVIDENCE", evidenceTraceable),
      priority: 50,
    },
    {
      criterion: "REPORT_ATTACHMENT",
      paths: ["report.attachmentStrength"],
      finalValue: state.report.attachmentStrength,
      factText: attachmentPresent
        ? "首份奏报已经附带可核验材料。"
        : "首份奏报没有附带足以核验的材料。",
      direction: directDirection(endingKey, "ATTACHMENT", attachmentPresent),
      priority: 45,
    },
    {
      criterion: "REPORT_DISPATCH",
      paths: ["report.dispatchStatus"],
      finalValue: state.report.dispatchStatus,
      factText: reportDeparted
        ? "首份奏报已经离开浙江。"
        : "首份奏报在第一部分结束时仍未离开浙江。",
      direction: directDirection(endingKey, "DISPATCH", reportDeparted),
      priority: 40,
    },
    {
      criterion: "GOVERNOR_RESPONSIBILITY",
      paths: ["responsibility.governorExposure"],
      finalValue: state.responsibility.governorExposure,
      factText: highExposure
        ? "总督本人已经进入明确问责范围。"
        : "最终责任没有完全落到总督本人名下。",
      direction: directDirection(endingKey, "EXPOSURE", !highExposure),
      priority: 35,
    },
  ];
}

function latestEventEstablishingFinalValue(
  events: readonly PartOneCommittedEvent[],
  candidate: EndingEvidenceCandidate,
) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    for (const path of candidate.paths) {
      if (!event.changedStatePaths.some((changed) => changedPath([changed], path))) continue;
      const patchValue = statePatchValue(event.statePatch, path);
      if (sameStructuredValue(patchValue, candidate.finalValue)) return event;
    }
  }
  return null;
}

function committedPartEvents(
  history: readonly PartOneCommittedEvent[],
  current: PartOneCommittedEvent,
  terminalTurn: number,
) {
  const byId = new Map<string, PartOneCommittedEvent>();
  for (const candidate of [...history, current]) {
    if (!isCommittedPartOneEvent(candidate)) continue;
    if (candidate.turnNumber > terminalTurn) continue;
    byId.set(candidate.eventId, candidate);
  }
  return [...byId.values()].sort((left, right) => (
    left.turnNumber - right.turnNumber
    || left.eventId.localeCompare(right.eventId)
  ));
}

function isCommittedPartOneEvent(value: unknown): value is PartOneCommittedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.committed === false) return false;
  return event.schemaVersion === "sangtian-part-one-event-v1"
    && typeof event.eventId === "string"
    && event.eventId.trim().length > 0
    && Number.isInteger(event.turnNumber)
    && Number(event.turnNumber) > 0
    && Array.isArray(event.changedStatePaths)
    && event.changedStatePaths.every((path) => typeof path === "string" && path.trim().length > 0)
    && Boolean(event.statePatch)
    && typeof event.statePatch === "object"
    && !Array.isArray(event.statePatch);
}

function statePatchValue(patch: Record<string, unknown>, path: string) {
  if (Object.prototype.hasOwnProperty.call(patch, path)) return patch[path];
  const prefixed = Object.entries(patch).find(([key]) => key.endsWith(`.${path}`));
  if (prefixed) return prefixed[1];
  const direct = nestedValue(patch, path);
  if (direct !== undefined) return direct;
  return nestedValue(patch, `state.${path}`);
}

function nestedValue(root: Record<string, unknown>, path: string) {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function sameStructuredValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readCommittedPartOneEvents(runId: string): PartOneCommittedEvent[] {
  const file = workspacePaths(runtimeRoot(), runId).partOneEvents;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/u).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const parsed = JSON.parse(line) as unknown;
      return isCommittedPartOneEvent(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function directDirection(
  endingKey: string,
  criterion: "LAND" | "GRAIN" | "EVIDENCE" | "ATTACHMENT" | "DISPATCH" | "EXPOSURE",
  favorable: boolean,
): EvidenceDirection {
  if (
    (endingKey === "guarded_people_bore_responsibility" && criterion === "EXPOSURE" && !favorable)
    || (endingKey === "guarded_people_preserved_evidence" && criterion === "EVIDENCE" && favorable)
    || (endingKey === "evidence_entered_capital" && criterion === "DISPATCH" && favorable)
    || (endingKey === "executed_policy_lost_people"
      && (criterion === "LAND" || criterion === "GRAIN")
      && !favorable)
  ) {
    return "DECISIVE";
  }
  return favorable ? "HELPED" : "HURT";
}

function changedPath(changedPaths: readonly string[], expected: string) {
  return changedPaths.some((path) => path === expected || path.endsWith(`.${expected}`));
}

function directionPriority(direction: EvidenceDirection) {
  return direction === "DECISIVE" ? 3 : direction === "HELPED" ? 2 : 1;
}

function protagonistFate(state: PartOneState, endingKey: string) {
  const exposure = Number(state.responsibility.governorExposure || 0);
  const report = reportHasDeparted(state)
    ? "首份奏报已经离开浙江"
    : "首份奏报仍未离开浙江";
  const responsibility = exposure >= 8
    ? "他没有把全部责任推给县令或属吏，问责也因此落到了自己名下"
    : "他仍给自己保留了周旋余地，却也必须面对各方对责任归属的追问";
  const kept = endingKey === "executed_policy_lost_people"
    ? "他保住了执行国策的名分，却没能保住百姓面对粮价与田契时的退路"
    : "他暂时保住了可追索的证据、民田边界和最急迫的救粮秩序";
  return `${report}。${responsibility}。${kept}。官位此刻尚未裁定，但他已经失去了继续含混退让的余地。`;
}

function reportHasDeparted(state: PartOneState) {
  return state.report.dispatchStatus === "DISPATCHED"
    || state.report.dispatchStatus === "SPLIT";
}

function directAftermath(state: PartOneState) {
  const evidence = state.evidence.chainStatus === "TRACEABLE"
    ? "清流县册仍有可追索的保管链，后续问责不再只能依赖口供。"
    : "县册证据链仍有缺口，任何一方都可能争夺对事实的解释权。";
  const people = state.land.safeguardStatus === "ACTIVE"
    ? "灾期民田边界暂时仍在，商会尚不能把一次救粮直接变成购田凭据。"
    : "粮食压力已经逼近田契，失田风险没有被真正挡住。";
  const grainAndMerchant = state.grain.immediatePressure === "UNRELIEVED"
    ? "最急迫的粮食压力仍未解除，下一阶段会从救粮争执直接进入卖田与债务危机。"
    : state.merchant.entryStatus === "CONDITIONAL"
      ? "救粮渠道已经打开，但商会只取得附条件的粮食与运力入口，尚未取得不受约束的土地权利。"
      : "眼前救粮已经有了着落，粮路由谁控制、代价由谁承担仍将成为下一阶段的争夺。";
  const report = reportHasDeparted(state)
    ? state.report.dispatchStatus === "SPLIT"
      ? "首报已经分路离开浙江，督抚对事实的不同解释也随之进入京师政治。"
      : "首报已经离开浙江，地方再想靠口头改写第一版事实已经来不及了。"
    : "首报尚未离开浙江，地方仍有最后一次争夺附件、署名与责任边界的机会。";
  return [evidence, people, grainAndMerchant, report];
}

export const sangtianEndingModule = new SangtianEndingModule();
