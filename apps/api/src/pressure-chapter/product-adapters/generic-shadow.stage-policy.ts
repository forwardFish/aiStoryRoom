import {
  sha256Canonical,
  validateSangtianFinaleInputV1,
  validateSangtianPressureFinaleDecisionV1,
} from "@ai-story/shared";
import {
  compileSangtianContentFinalePolicyV1,
  loadPublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import type { GenericFinaleShadowReadOnlyPort } from "../terminal-commit";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";

const POLICY_BASE = Object.freeze({
  schemaVersion: "pressure_generic_shadow_stage_policy_v1" as const,
  stage: "CONTENT_FINALE_ONLY" as const,
  authoritativeEndgamePolicyVersion: "sangtian_content_finale_v1" as const,
  genericCandidateVersion: null,
});

/** Explicit phase-1 policy: Generic has no published candidate and receives no write capability. */
export class ContentFinaleOnlyGenericShadowV1
implements GenericFinaleShadowReadOnlyPort {
  readonly stagePolicy = Object.freeze({
    ...POLICY_BASE,
    policyHash: sha256Canonical(POLICY_BASE),
  });
  private readonly finalePolicy;

  constructor() {
    const release = loadPublishedSangtianActionReleaseV1();
    if (release.routeRegistration.route.endgamePolicyVersion !== this.stagePolicy.authoritativeEndgamePolicyVersion) {
      failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "release.endgamePolicyVersion");
    }
    this.finalePolicy = compileSangtianContentFinalePolicyV1({
      contentPackageVersion: release.routeRegistration.contentPackageVersion,
      contentPackageSha256: release.routeRegistration.contentPackageSha256,
    });
  }

  async evaluateShadow(input: Parameters<GenericFinaleShadowReadOnlyPort["evaluateShadow"]>[0]) {
    const finaleInput = validateSangtianFinaleInputV1(input.finaleInput);
    const decision = validateSangtianPressureFinaleDecisionV1(
      input.authoritativeDecision,
      finaleInput,
      this.finalePolicy,
    );
    if (
      finaleInput.policyVersion !== this.finalePolicy.policyVersion
      || finaleInput.policyHash !== this.finalePolicy.policyHash
      || finaleInput.runId !== decision.runId
      || finaleInput.routeHash !== decision.routeHash
    ) {
      return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "genericShadow.input", "DECISION_BINDING");
    }
    return null;
  }
}
