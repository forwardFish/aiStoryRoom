import type {
  DecisionCandidateV2,
  IntentTargetTypeV2,
  PlayerIntentV2,
  TurnDecisionCommandV2
} from "@ai-story/shared";
import type { RawPlayerAction, StoryDecision, StoryRole } from "./types";

export type SoloAvailableTarget = { type: IntentTargetTypeV2; id: string; label: string };

export function commandToRawPlayerAction(
  command: TurnDecisionCommandV2,
  candidates: DecisionCandidateV2[]
): RawPlayerAction {
  const method = clean(command.customAction || command.intent?.method || command.intent?.freeText || "", 500);
  const target = command.intent?.target;
  switch (command.decisionForm || "STORY_CHOICE") {
    case "CONVERSATION":
      return {
        source: "TALK",
        personId: clean(target?.id || "", 120),
        personName: clean(target?.label || "", 120),
        prompt: method
      };
    case "INVESTIGATION":
      return {
        source: "INVESTIGATE",
        locationId: clean(target?.id || "", 120),
        locationName: clean(target?.label || "", 120),
        task: method
      };
    case "LEVERAGE":
      return {
        source: "USE_LEVERAGE",
        leverageKey: clean(command.intent?.leverageKeys?.[0] || "", 160),
        leverageLabel: clean(command.intent?.leverageKeys?.[0] || "当前筹码", 120),
        targetId: clean(target?.id || "", 120),
        targetLabel: clean(target?.label || "", 120),
        task: method
      };
    case "CUSTOM_PLAN":
      return { source: "CUSTOM", text: method };
    case "STORY_CHOICE": {
      const candidate = candidates.find((item) => item.id === command.candidateId);
      if (!candidate) throw new Error("DECISION_CANDIDATE_NOT_FOUND");
      const decisionKernelId = marker(candidate.effectHooks, "decisionKernel:");
      const affordanceTemplateId = marker(candidate.effectHooks, "affordance:");
      return {
        source: "RECOMMENDED",
        decisionId: candidate.id,
        label: candidate.label,
        targetId: candidate.intentDraft.target.id,
        targetLabel: candidate.intentDraft.target.label,
        // An authored Part One Story Choice is bound by the exact description
        // shown to the player. `objective` is an internal intent summary and
        // may legitimately use different wording; using it here makes a
        // visible current-turn option fail the server's affordance check.
        // The fixed opening has no runtime affordance marker and keeps its
        // concrete method text.
        actionText: affordanceTemplateId
          ? candidate.description || candidate.intentDraft.objective || candidate.intentDraft.method || candidate.label
          : candidate.intentDraft.method || candidate.intentDraft.objective || candidate.description || candidate.label,
        decisionKernelId,
        affordanceTemplateId
      };
    }
  }
}

export function buildDecisionCandidates(
  decisions: StoryDecision[],
  role: StoryRole,
  targets: SoloAvailableTarget[]
): DecisionCandidateV2[] {
  return decisions.map((decision) => {
    const target = targets.find((candidate) => candidate.id === decision.targetRef.id && candidate.type === decision.targetRef.type);
    if (!target || target.label !== decision.targetRef.label) throw new Error(`DECISION_TARGET_UNKNOWN:${decision.targetRef.id}`);
    const risk = decision.riskTolerance === "HIGH" ? "HIGH" : "NORMAL";
    const intentDraft: PlayerIntentV2 = {
      objective: decision.intent,
      target,
      method: decision.method,
      leverageKeys: [...decision.leverageKeys],
      visibility: decision.visibility,
      riskTolerance: decision.riskTolerance,
      fallback: null,
      condition: null
    };
    return {
      id: decision.decisionId,
      actionKey: null,
      label: decision.label,
      description: decision.description,
      intent: decision.intent,
      targetRoleId: target.type === "ROLE" ? target.id : null,
      targetRoleName: target.type === "ROLE" ? target.label : null,
      risk,
      basisFactKeys: [...decision.groundingIds],
      requiredAssetKeys: [...decision.leverageKeys],
      authorityBasis: role.permissions.join("、"),
      intendedOutcome: decision.intent,
      concreteCost: decision.concreteCost,
      expectedCountermove: decision.expectedCountermove,
      visibility: intentDraft.visibility,
      effectHooks: [
        decision.distinctAxis,
        ...(decision.decisionKernelId ? [`decisionKernel:${decision.decisionKernelId}`] : []),
        ...(decision.affordanceTemplateId ? [`affordance:${decision.affordanceTemplateId}`] : [])
      ],
      intentDraft
    };
  });
}

function marker(values: unknown, prefix: string) {
  if (!Array.isArray(values)) return null;
  const value = values.find((item) => typeof item === "string" && item.startsWith(prefix));
  return typeof value === "string" ? value.slice(prefix.length) : null;
}

function clean(value: string, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
