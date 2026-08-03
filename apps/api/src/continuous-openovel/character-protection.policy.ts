import type { PlayerIntentV2 } from "@ai-story/shared";

export type CharacterProtectionInput = {
  actorRoleId: string;
  targetRoleId: string | null;
  targetControllerKind: "HUMAN" | "AI" | "SYSTEM" | null;
  intent: PlayerIntentV2;
  isFinale: boolean;
  requestedEffect: "REQUEST" | "CONTEST" | "TRANSFER" | "INJURY" | "PERMANENT_REMOVAL" | "OTHER";
};

export type CharacterProtectionDecision = {
  accepted: boolean;
  requiresInteraction: boolean;
  requiresContest: boolean;
  code: "ALLOW" | "HUMAN_TARGET_RESPONSE_REQUIRED" | "HUMAN_TARGET_CONTEST_REQUIRED" | "HUMAN_CHARACTER_SURVIVAL_PROTECTED";
};

/** Structural policy: it intentionally does not inspect natural-language phrases. */
export function evaluateCharacterProtection(input: CharacterProtectionInput): CharacterProtectionDecision {
  const targetsOtherHuman = input.targetRoleId !== null
    && input.targetRoleId !== input.actorRoleId
    && input.targetControllerKind === "HUMAN";
  if (!targetsOtherHuman) return { accepted: true, requiresInteraction: false, requiresContest: false, code: "ALLOW" };
  if (input.requestedEffect === "PERMANENT_REMOVAL" && !input.isFinale) {
    return { accepted: false, requiresInteraction: false, requiresContest: false, code: "HUMAN_CHARACTER_SURVIVAL_PROTECTED" };
  }
  if (["TRANSFER", "INJURY", "CONTEST"].includes(input.requestedEffect)) {
    return { accepted: true, requiresInteraction: false, requiresContest: true, code: "HUMAN_TARGET_CONTEST_REQUIRED" };
  }
  return { accepted: true, requiresInteraction: true, requiresContest: false, code: "HUMAN_TARGET_RESPONSE_REQUIRED" };
}
