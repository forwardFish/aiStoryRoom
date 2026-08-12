import {
  compareGenericFinaleShadowV1,
} from "@ai-story/templates";
import {
  PrismaGenericFinaleShadowComparisonRepository,
  type FinaleShadowAppendPrismaClient,
} from "../persistence";
import type { GenericFinaleShadowReadOnlyPort } from "../terminal-commit";

/**
 * Post-commit Generic shadow adapter. Comparison evidence is bounded,
 * process-local diagnostics only; it has no database or authority capability.
 */
export class PersistedPressureGenericFinaleShadowV1
implements GenericFinaleShadowReadOnlyPort {
  private readonly comparisons: PrismaGenericFinaleShadowComparisonRepository;

  constructor(
    private readonly evaluator: GenericFinaleShadowReadOnlyPort,
    _unusedPrisma?: FinaleShadowAppendPrismaClient,
  ) {
    this.comparisons = new PrismaGenericFinaleShadowComparisonRepository();
  }

  async evaluateShadow(
    input: Parameters<GenericFinaleShadowReadOnlyPort["evaluateShadow"]>[0],
  ) {
    const candidate = await this.evaluator.evaluateShadow(input);
    if (candidate === null) return null;
    const report = compareGenericFinaleShadowV1(
      input.authoritativeDecision,
      input.finaleInput,
      candidate,
    );
    await this.comparisons.appendOnce({
      runId: input.finaleInput.runId,
      candidatePolicyVersion: candidate.shadowEngineVersion,
      officialSemanticHash: input.authoritativeDecision.semanticOutcomeHash,
      report,
      evidence: {
        sourceInputHash: candidate.sourceInputHash,
        shadowEngineVersion: candidate.shadowEngineVersion,
        reportHash: report.reportHash,
      },
    });
    return candidate;
  }
}
