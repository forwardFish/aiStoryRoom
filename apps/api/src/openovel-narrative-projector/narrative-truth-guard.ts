import { Injectable } from "@nestjs/common";
import type { CompiledNarrativeContextV1 } from "./narrative-context-compiler";
import type { NarrativeTruthGuardResultV1 } from "./openovel-narrative-projector.contract";

const UNSOURCED_OUTCOME_PATTERNS = [
  /(?:最终|彻底|已经)?(?:获胜|胜利|败北|战败|覆灭|死亡)/u,
  /\b(?:winner|won|victory|defeated|destroyed|dead)\b/iu,
];

@Injectable()
export class NarrativeTruthGuard {
  validate(text: string, context: CompiledNarrativeContextV1): NarrativeTruthGuardResultV1 {
    const normalizedText = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!normalizedText) return rejected("NARRATIVE_EMPTY", normalizedText);
    const lower = normalizedText.toLocaleLowerCase();
    const forbiddenPhrase = context.forbiddenPhrases.find((phrase) => {
      const candidate = String(phrase || "").trim().toLocaleLowerCase();
      return candidate.length >= 2 && lower.includes(candidate);
    });
    if (forbiddenPhrase) return rejected("NARRATIVE_CROSS_AUDIENCE_DISCLOSURE", normalizedText);
    const forbiddenClaim = context.forbiddenClaims.find((claim) => {
      const candidate = String(claim || "").trim().toLocaleLowerCase();
      return candidate.length >= 2 && lower.includes(candidate);
    });
    if (forbiddenClaim) return rejected("NARRATIVE_UNSOURCED_FACT", normalizedText);
    if (!context.fallbackLines.some((line) => UNSOURCED_OUTCOME_PATTERNS.some((pattern) => pattern.test(line)))
      && UNSOURCED_OUTCOME_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
      return rejected("NARRATIVE_UNSOURCED_OUTCOME", normalizedText);
    }
    return { ok: true, normalizedText, failureCode: null };
  }
}

function rejected(failureCode: string, normalizedText: string): NarrativeTruthGuardResultV1 {
  return { ok: false, normalizedText, failureCode };
}
