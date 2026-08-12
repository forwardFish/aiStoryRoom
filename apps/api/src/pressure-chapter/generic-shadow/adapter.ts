import {
  validateSangtianFinaleInputV1,
  validateSangtianPressureFinaleDecisionV1,
} from "@ai-story/shared";
import type { GenericFinaleShadowReadOnlyPort } from "../terminal-commit";
import { evaluatePressureGenericShadowCandidateV1 } from "./evaluator";

/** Exact read-only port seam for a later product-adapters factory switch. */
export class PressureGenericFinaleShadowReadOnlyAdapterV1
implements GenericFinaleShadowReadOnlyPort {
  async evaluateShadow(
    value: Parameters<GenericFinaleShadowReadOnlyPort["evaluateShadow"]>[0],
  ) {
    const input = validateSangtianFinaleInputV1(value.finaleInput);
    validateSangtianPressureFinaleDecisionV1(value.authoritativeDecision, input);
    return evaluatePressureGenericShadowCandidateV1({
      finaleInput: input,
      sourceInputHash: input.inputHash,
    });
  }
}
