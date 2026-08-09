import type { PartOneState } from "@ai-story/templates";
import type { PreparedSangtianDecision } from "./sangtian-decisions.js";
import type { EndingModule, EndingModuleInput } from "./ending-module.js";
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
};

type SangtianOutcome = {
  key: string;
  title: string;
};

export class SangtianEndingModule implements EndingModule {
  readonly moduleId = "sangtian.protagonist-ending.v1";

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

    // This is the only producer for the player-safe Solo ending evidence. It
    // reads the final Settlement event and state before the atomic Head is
    // published. The API may bind these turn references to committed
    // PlayerAction IDs, but it must never reconstruct causes from prose.
    return Object.assign(ending, {
      playerEvidence: buildPlayerEndingEvidence(input, settlement, state, outcome),
    } satisfies Pick<EndingWithEvidence, "playerEvidence">);
  }
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
): PlayerEndingEvidenceV1 {
  const event = settlement.event;
  const changedPaths = Array.isArray(event?.changedStatePaths)
    ? event.changedStatePaths.map(String)
    : [];
  const sourceEventId = String(event?.eventId || "").trim();
  const causeCandidates = sourceEventId
    ? endingEvidenceCandidates(state, outcome.key).filter((candidate) => (
        candidate.paths.some((path) => changedPath(changedPaths, path))
      ))
    : [];
  const causes = causeCandidates
    .sort((left, right) => (
      directionPriority(right.direction) - directionPriority(left.direction)
      || right.priority - left.priority
      || left.criterion.localeCompare(right.criterion)
    ))
    .slice(0, 3)
    .map(({ paths: _paths, priority: _priority, ...candidate }) => ({
      sourceTurnId: input.turnId,
      sourceRevision: input.turnNumber,
      sourceEventId,
      authority: "PREDICATE" as const,
      visibility: "PLAYER" as const,
      ...candidate,
    }));

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

function endingEvidenceCandidates(state: PartOneState, endingKey: string) {
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
      factText: landProtected
        ? "灾期民田保护已经写入最终提交状态。"
        : "最终提交状态中没有建立有效的灾期民田保护。",
      direction: directDirection(endingKey, "LAND", landProtected),
      priority: 60,
    },
    {
      criterion: "PEOPLE_GRAIN_RELIEF",
      paths: ["grain.immediatePressure"],
      factText: grainRelieved
        ? "最急迫的粮食压力已经得到缓解。"
        : "最急迫的粮食压力仍未解除。",
      direction: directDirection(endingKey, "GRAIN", grainRelieved),
      priority: 55,
    },
    {
      criterion: "EVIDENCE_CHAIN",
      paths: ["evidence.chainStatus"],
      factText: evidenceTraceable
        ? "县册证据链已经保持为可追索状态。"
        : "县册证据链在最终提交时仍不可完整追索。",
      direction: directDirection(endingKey, "EVIDENCE", evidenceTraceable),
      priority: 50,
    },
    {
      criterion: "REPORT_ATTACHMENT",
      paths: ["report.attachmentStrength"],
      factText: attachmentPresent
        ? "首份奏报已经附带可核验材料。"
        : "首份奏报没有附带足以核验的材料。",
      direction: directDirection(endingKey, "ATTACHMENT", attachmentPresent),
      priority: 45,
    },
    {
      criterion: "REPORT_DISPATCH",
      paths: ["report.dispatchStatus"],
      factText: reportDeparted
        ? "首份奏报已经离开浙江。"
        : "首份奏报在第一部分结束时仍未离开浙江。",
      direction: directDirection(endingKey, "DISPATCH", reportDeparted),
      priority: 40,
    },
    {
      criterion: "GOVERNOR_RESPONSIBILITY",
      paths: ["responsibility.governorExposure"],
      factText: highExposure
        ? "总督本人已经进入明确问责范围。"
        : "最终责任没有完全落到总督本人名下。",
      direction: directDirection(endingKey, "EXPOSURE", !highExposure),
      priority: 35,
    },
  ] as Array<{
    criterion: string;
    paths: string[];
    factText: string;
    direction: EvidenceDirection;
    priority: number;
  }>;
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
