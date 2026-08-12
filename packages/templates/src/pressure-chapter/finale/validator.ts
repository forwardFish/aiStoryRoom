import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as CONTRACT_ERROR,
  contractObject,
  contractString,
  exactContractKeys,
  failPressureContract,
  isoTimestamp,
  sha256Canonical,
  validateSangtianFinaleInputV1,
  type FrozenFinalePolicyV1,
  type SangtianFinaleInputV1,
} from "@ai-story/shared";
import {
  SANGTIAN_FINALE_DOMAIN_ERROR_CODES as ERROR,
  failSangtianFinaleDomain,
} from "./errors";
import { validateSangtianOwnedFinalePolicyV1 } from "./policy";
import type { SangtianFinaleEvaluationRequestV1 } from "./types";

export function buildSangtianFinaleIdempotencyKeyV1(input: {
  inputHash: string;
  policyHash: string;
  decidedAt: string;
}): string {
  return `sangtian_finale_${sha256Canonical({
    operation: "SANGTIAN_CONTENT_FINALE_V1",
    inputHash: input.inputHash,
    policyHash: input.policyHash,
    decidedAt: input.decidedAt,
  })}`;
}

export function validateSangtianFinaleEvaluationRequestV1(
  value: unknown,
): SangtianFinaleEvaluationRequestV1 {
  const request = contractObject(value, "finaleEvaluationRequest");
  // Deliberately excludes Provider, DB and Generic decisions. Unknown fields
  // fail closed before any content rule is evaluated.
  exactContractKeys(
    request,
    ["input", "policy", "decidedAt", "idempotencyKey"],
    "finaleEvaluationRequest",
  );
  const input = validateSangtianFinaleInputV1(request.input);
  const policy = validateSangtianOwnedFinalePolicyV1(request.policy);
  const decidedAt = isoTimestamp(request.decidedAt, "finaleEvaluationRequest.decidedAt");
  const idempotencyKey = contractString(
    request.idempotencyKey,
    "finaleEvaluationRequest.idempotencyKey",
  );
  if (input.policyVersion !== policy.policyVersion) {
    failPressureContract(
      CONTRACT_ERROR.ENDGAME_POLICY_MISMATCH,
      "finaleEvaluationRequest.input.policyVersion",
      `EXPECTED_${policy.policyVersion}`,
    );
  }
  if (input.policyHash !== policy.policyHash) {
    failPressureContract(
      CONTRACT_ERROR.CONTRACT_HASH_MISMATCH,
      "finaleEvaluationRequest.input.policyHash",
      `EXPECTED_${policy.policyHash}`,
    );
  }
  const expectedKey = buildSangtianFinaleIdempotencyKeyV1({
    inputHash: input.inputHash,
    policyHash: policy.policyHash,
    decidedAt,
  });
  if (idempotencyKey !== expectedKey) {
    failSangtianFinaleDomain(
      ERROR.IDEMPOTENCY_KEY_MISMATCH,
      "finaleEvaluationRequest.idempotencyKey",
      `EXPECTED_${expectedKey}`,
    );
  }
  return { input, policy, decidedAt, idempotencyKey };
}

export function assertCompleteFrozenFinaleChainV1(
  input: SangtianFinaleInputV1,
  policy: FrozenFinalePolicyV1,
): void {
  // Shared validation enforces exactly N1..N7, sequence 1..7, hash links,
  // N7 worldSequence=7 and rejects N8/sequence=8 before evaluation.
  validateSangtianFinaleInputV1(input);
  validateSangtianOwnedFinalePolicyV1(policy);
}
