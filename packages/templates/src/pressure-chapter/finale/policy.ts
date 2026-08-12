import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  contractObject,
  contractSha256,
  contractVersion,
  exactContractKeys,
  hashWithoutField,
  sha256Canonical,
  validateFrozenFinalePolicyV1,
  type FrozenFinalePolicyV1,
} from "@ai-story/shared";
import {
  SANGTIAN_CONTENT_FINALE_POLICY_VERSION_V1,
  SANGTIAN_CONTENT_FINALE_RULE_SCHEMA_VERSION_V1,
  SANGTIAN_DISCLOSURE_RULE_REFS_V1,
  expectedSeatVerdictRuleRefsV1,
  expectedWorldOutcomeRuleRefsV1,
} from "./content-rules";
import {
  SANGTIAN_FINALE_DOMAIN_ERROR_CODES as ERROR,
  failSangtianFinaleDomain,
} from "./errors";
import type { CompileSangtianFinalePolicyRequestV1 } from "./types";

export function compileSangtianContentFinalePolicyV1(
  value: CompileSangtianFinalePolicyRequestV1,
): FrozenFinalePolicyV1 {
  const request = contractObject(value, "compileFinalePolicyRequest");
  exactContractKeys(
    request,
    ["contentPackageVersion", "contentPackageSha256"],
    "compileFinalePolicyRequest",
  );
  const contentPackageVersion = contractVersion(
    request.contentPackageVersion,
    "compileFinalePolicyRequest.contentPackageVersion",
  );
  const contentPackageSha256 = contractSha256(
    request.contentPackageSha256,
    "compileFinalePolicyRequest.contentPackageSha256",
  );
  const compiledWithoutHash = {
    schemaVersion: "sangtian_finale_compiled_rules_v1" as const,
    worldOutcomeRuleRefs: expectedWorldOutcomeRuleRefsV1(),
    seatVerdictRuleRefs: expectedSeatVerdictRuleRefsV1(),
    disclosureRuleRefs: [...SANGTIAN_DISCLOSURE_RULE_REFS_V1].sort(),
  };
  const compiledRules = {
    ...compiledWithoutHash,
    rulesHash: sha256Canonical(compiledWithoutHash),
  };
  const policyWithoutHash = {
    policyVersion: SANGTIAN_CONTENT_FINALE_POLICY_VERSION_V1,
    contentPackageVersion,
    contentPackageSha256,
    ruleSchemaVersion: SANGTIAN_CONTENT_FINALE_RULE_SCHEMA_VERSION_V1,
    compiledRules,
  };
  return validateSangtianOwnedFinalePolicyV1({
    ...policyWithoutHash,
    policyHash: sha256Canonical(policyWithoutHash),
  });
}

export function validateSangtianOwnedFinalePolicyV1(
  value: unknown,
): FrozenFinalePolicyV1 {
  const policy = validateFrozenFinalePolicyV1(value);
  if (
    policy.policyVersion !== SANGTIAN_CONTENT_FINALE_POLICY_VERSION_V1
    || policy.ruleSchemaVersion !== SANGTIAN_CONTENT_FINALE_RULE_SCHEMA_VERSION_V1
  ) {
    failSangtianFinaleDomain(
      ERROR.POLICY_NOT_CONTENT_OWNED,
      "finalePolicy",
      `${policy.policyVersion}:${policy.ruleSchemaVersion}`,
    );
  }
  assertCatalogEqual(
    policy.compiledRules.worldOutcomeRuleRefs,
    expectedWorldOutcomeRuleRefsV1(),
    "finalePolicy.compiledRules.worldOutcomeRuleRefs",
  );
  const expectedSeatRules = expectedSeatVerdictRuleRefsV1();
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    assertCatalogEqual(
      policy.compiledRules.seatVerdictRuleRefs[seatId],
      expectedSeatRules[seatId],
      `finalePolicy.compiledRules.seatVerdictRuleRefs.${seatId}`,
    );
  }
  assertCatalogEqual(
    policy.compiledRules.disclosureRuleRefs,
    [...SANGTIAN_DISCLOSURE_RULE_REFS_V1].sort(),
    "finalePolicy.compiledRules.disclosureRuleRefs",
  );
  return policy;
}

/** Re-hash a test or authoring policy after an intentional pure transformation. */
export function rehashSangtianFinalePolicyV1(
  policy: FrozenFinalePolicyV1,
): FrozenFinalePolicyV1 {
  const cloned = structuredClone(policy) as FrozenFinalePolicyV1;
  cloned.compiledRules.rulesHash = hashWithoutField(
    cloned.compiledRules as unknown as Record<string, unknown>,
    "rulesHash",
  );
  cloned.policyHash = hashWithoutField(
    cloned as unknown as Record<string, unknown>,
    "policyHash",
  );
  return cloned;
}

function assertCatalogEqual(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (sha256Canonical(actual) !== sha256Canonical(expected)) {
    failSangtianFinaleDomain(ERROR.RULE_CATALOG_MISMATCH, path);
  }
}
