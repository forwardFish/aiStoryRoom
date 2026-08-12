import { isSha256, sha256Canonical } from "@ai-story/shared";
import { isPressureSeatId, uniqueCodes, validatePressureLifecycleAuthorityV1 } from "./authority";
import type {
  PressureAEmotionDerivationResultV1,
  PressureDisclosureSignalPatchV1,
  PressureDisclosureUpgradeBindingV1,
} from "./contracts";
import {
  A_EMOTION_LIFECYCLE_ERROR_CODES_V1 as ERROR,
  failAEmotionLifecycle,
} from "./errors";

/**
 * Derives a viewer-safe disclosure patch from an existing A-Emotion event and
 * a committed investigation result. It stores no lifecycle state and writes no
 * authority; the caller remains responsible for canonical event persistence.
 */
export function derivePressureDisclosureUpgradeV1(input: {
  current: {
    eventId: string;
    runId: string;
    stageId: string;
    disclosure: "HIDDEN" | "SUSPECTED" | "CONFIRMED";
  };
  authority: unknown;
  binding: unknown;
}): PressureAEmotionDerivationResultV1<PressureDisclosureSignalPatchV1> {
  const authority = validatePressureLifecycleAuthorityV1(input.authority);
  const binding = validatePressureDisclosureUpgradeBindingV1(input.binding);
  if (input.current.runId !== authority.runId || input.current.stageId !== authority.stageId) {
    failAEmotionLifecycle(ERROR.CONTEXT_MISMATCH, "disclosure");
  }
  if (input.current.disclosure === "CONFIRMED") {
    return { status: "SKIPPED", reason: "NOT_BOUND" };
  }
  if (input.current.disclosure !== binding.fromDisclosure) {
    failAEmotionLifecycle(ERROR.DISCLOSURE_SKIP_FORBIDDEN, "disclosure.transition");
  }
  if (
    !authority.actionCodes.includes(binding.actionCode)
    || !authority.effectCodes.includes(binding.effectCode)
    || !authority.factCodes.includes(binding.factCode)
  ) return { status: "SKIPPED", reason: "BASIS_NOT_MATCHED" };

  let patch: PressureDisclosureSignalPatchV1;
  if (binding.toDisclosure === "SUSPECTED") {
    if (binding.suspectedSeatIds.length === 0) failAEmotionLifecycle(ERROR.DISCLOSURE_BASIS_MISSING, "binding.suspectedSeatIds");
    patch = {
      kind: "REVEAL",
      disclosure: "SUSPECTED",
      suspectedSeatIds: [...binding.suspectedSeatIds],
      suspicionBasisRefs: [binding.factCode],
      evidenceRefs: [],
      revealOfEventId: input.current.eventId,
    };
  } else {
    if (authority.evidenceRefs.length === 0) {
      return { status: "SKIPPED", reason: "EVIDENCE_NOT_AUTHORIZED" };
    }
    patch = {
      kind: "REVEAL",
      disclosure: "CONFIRMED",
      suspectedSeatIds: [],
      suspicionBasisRefs: [],
      evidenceRefs: uniqueCodes(authority.evidenceRefs),
      revealOfEventId: input.current.eventId,
    };
  }
  return {
    status: "DERIVED",
    patch,
    derivationHash: sha256Canonical({
      schemaVersion: "pressure_disclosure_signal_derivation_v1",
      sourceCommitHash: authority.sourceCommitHash,
      currentEventId: input.current.eventId,
      bindingHash: binding.bindingHash,
      patch,
    }),
  };
}

export function sealPressureDisclosureUpgradeBindingV1(
  input: Omit<PressureDisclosureUpgradeBindingV1, "schemaVersion" | "bindingHash">,
): PressureDisclosureUpgradeBindingV1 {
  const withoutHash = {
    schemaVersion: "pressure_disclosure_upgrade_binding_v1" as const,
    ...input,
    suspectedSeatIds: [...input.suspectedSeatIds],
  };
  return validatePressureDisclosureUpgradeBindingV1({ ...withoutHash, bindingHash: sha256Canonical(withoutHash) });
}

export function validatePressureDisclosureUpgradeBindingV1(value: unknown): PressureDisclosureUpgradeBindingV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) failAEmotionLifecycle(ERROR.INVALID_POLICY, "binding");
  const binding = value as PressureDisclosureUpgradeBindingV1;
  if (
    binding.schemaVersion !== "pressure_disclosure_upgrade_binding_v1"
    || typeof binding.bindingId !== "string"
    || !/\S/u.test(binding.bindingId)
    || !["HIDDEN", "SUSPECTED"].includes(binding.fromDisclosure)
    || !["SUSPECTED", "CONFIRMED"].includes(binding.toDisclosure)
    || (binding.fromDisclosure === "HIDDEN" && binding.toDisclosure !== "SUSPECTED")
    || (binding.fromDisclosure === "SUSPECTED" && binding.toDisclosure !== "CONFIRMED")
  ) failAEmotionLifecycle(ERROR.INVALID_POLICY, "binding.transition");
  for (const key of ["actionCode", "effectCode", "factCode"] as const) {
    if (typeof binding[key] !== "string" || !/\S/u.test(binding[key])) failAEmotionLifecycle(ERROR.INVALID_POLICY, `binding.${key}`);
  }
  if (!Array.isArray(binding.suspectedSeatIds) || binding.suspectedSeatIds.some((seatId) => !isPressureSeatId(seatId))) failAEmotionLifecycle(ERROR.INVALID_POLICY, "binding.suspectedSeatIds");
  const { bindingHash, ...withoutHash } = binding;
  if (!isSha256(bindingHash) || sha256Canonical(withoutHash) !== bindingHash) failAEmotionLifecycle(ERROR.INVALID_POLICY, "binding.bindingHash");
  return structuredClone(binding);
}
