import type { ShadowRuntimeFixture, ValidationIssue } from "./types";

interface ValidationLike {
  ok: boolean;
  output: any;
  issues?: ValidationIssue[];
  warnings?: ValidationIssue[];
}

export function buildShadowQualityRubric(validation: ValidationLike, fixture: ShadowRuntimeFixture) {
  const issues = [...(validation.issues || []), ...(validation.warnings || [])];
  const codes = issues.filter((item) => item.severity === "error").map((item) => item.code);
  const eventTypes: string[] = Array.isArray(validation.output?.eventDrafts)
    ? validation.output.eventDrafts.map((event: any) => String(event?.eventType || "")).filter(Boolean)
    : [];
  const decisions = Array.isArray(validation.output?.decisions) ? validation.output.decisions : [];
  const decisionClasses = new Set(decisions.map((decision: any) => String(decision?.decisionClass || "")).filter(Boolean));
  const requiredEvents = fixture.causalRuntime?.requiredEventTypes || [];
  const narrativeBody = String(validation.output?.narration?.body || validation.output?.story?.resultNarrative || "").trim();
  const openingRestagesPlayerAction = /^(?:巡抚|他)(?:听完|听罢|闻言|听到)[^。！？\n]{0,48}(?:总督|调册|命令|决定|吩咐)/u.test(narrativeBody)
    || /^(?:巡抚|他)[^。！？\n]{0,40}(?:道|说|答道)[：:]?[“"](?:(?:总督)?大人|总督)(?:(?:要|既要|下令|决定|准备|将)[^”"\n]{0,10}(?:调册|调取|核对)|[^”"\n]{0,8}调册核对)/u.test(narrativeBody);
  const continuityFailures = codes.filter((code) =>
    /^(?:ACTION_|RECENT_CANON_REPLAY|NARRATIVE_REPEATS_PLAYER_ACTION|PLAYER_UNSUBMITTED_RESPONSE)/u.test(code)
  );
  if (openingRestagesPlayerAction && !continuityFailures.includes("QUALITY_OPENING_RESTAGES_PLAYER_ACTION")) {
    continuityFailures.push("QUALITY_OPENING_RESTAGES_PLAYER_ACTION");
  }
  const factFailures = codes.filter((code) =>
    /^(?:STATE_LOCK_|UNACCEPTED_|UNCONFIRMED_|UNAUTHORIZED_|UNAVAILABLE_|FORBIDDEN_|SOURCE_|INVALID_|ENDING_STATE_.*CONTRADICTS_|NARRATIVE_(?:UNRESOLVED_|FUTURE_)|PLAYER_ACTION_SCOPE_EXPANDED)/u.test(code)
  );
  const npcFailures = codes.filter((code) =>
    /^(?:FRAME_XUNFU_|FRAME_POLITICAL_|EVENT_DRAFT_NARRATIVE_MISMATCH|REQUIRED_EVENT_DRAFT_MISSING)/u.test(code)
  );
  const sceneFailures = codes.filter((code) =>
    /^(?:MATERIAL_CHANGE_MISSING|FRAME_SECRETARY_|FRAME_VISIBLE_POWER_|EVENT_DRAFT_(?:NARRATIVE_MISMATCH|ENDING_STATE_MISMATCH|MISSING_FOR_NARRATIVE_CHANGE)|REQUIRED_EVENT_DRAFT_MISSING)/u.test(code)
  );
  const decisionFailures = codes.filter((code) => code.startsWith("DECISION") || code.startsWith("AFFORDANCE"));
  const continuity = { passed: continuityFailures.length === 0, failureCodes: continuityFailures };
  const factDiscipline = { passed: factFailures.length === 0, failureCodes: factFailures };
  const npcInitiative = {
    passed: npcFailures.length === 0 && (!fixture.causalRuntime || eventTypes.some((eventType) => /^NPC_.*CONDITION_PROPOSED$/u.test(eventType))),
    failureCodes: npcFailures
  };
  const sceneProgression = {
    passed: sceneFailures.length === 0
      && (!fixture.causalRuntime || Boolean(validation.output?.materialChange?.anyMaterialChange))
      && requiredEvents.every((eventType) => eventTypes.includes(eventType)),
    failureCodes: sceneFailures
  };
  const decisionAuthenticity = {
    passed: decisionFailures.length === 0
      && decisions.length >= fixture.narrativeFrame.decisionPolicy.minimum
      && decisions.length <= fixture.narrativeFrame.decisionPolicy.maximum
      && (!validation.ok || decisionClasses.size >= 2),
    failureCodes: decisionFailures
  };
  const criteria = { continuity, factDiscipline, npcInitiative, sceneProgression, decisionAuthenticity };
  return {
    schemaVersion: "openovel_shadow_quality_rubric_v1",
    criteria,
    hardContractPassed: validation.ok,
    overallPassed: validation.ok && Object.values(criteria).every((criterion) => criterion.passed)
  };
}
