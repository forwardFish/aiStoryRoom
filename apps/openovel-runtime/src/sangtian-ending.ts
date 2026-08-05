import type { PartOneState } from "@ai-story/templates";
import type { PreparedSangtianDecision } from "./sangtian-decisions.js";
import type { EndingModule, EndingModuleInput } from "./ending-module.js";
import type { EndingPresentation } from "./types.js";

export class SangtianEndingModule implements EndingModule {
  readonly moduleId = "sangtian.protagonist-ending.v1";

  build(input: EndingModuleInput): EndingPresentation {
    const state = sangtianState(input);
    const protectedPeople = state.land.safeguardStatus === "ACTIVE"
      && state.grain.immediatePressure !== "UNRELIEVED";
    const preservedEvidence = state.evidence.chainStatus === "TRACEABLE"
      && state.report.attachmentStrength !== "NONE";
    const reportDeparted = reportHasDeparted(state);
    const highExposure = Number(state.responsibility.governorExposure || 0) >= 8;

    const outcome = classify({ protectedPeople, preservedEvidence, reportDeparted, highExposure });
    return {
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
  }
}

function sangtianState(input: EndingModuleInput) {
  const payload = input.preparedDecision?.payload as PreparedSangtianDecision | undefined;
  const state = payload?.settlement?.proposedState;
  if (!state || state.partCompletionStatus !== "HANDOFF_READY") {
    throw new Error("SANGTIAN_ENDING_STATE_NOT_READY");
  }
  return state;
}

function classify(input: {
  protectedPeople: boolean;
  preservedEvidence: boolean;
  reportDeparted: boolean;
  highExposure: boolean;
}) {
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
  return [evidence, people];
}

export const sangtianEndingModule = new SangtianEndingModule();
