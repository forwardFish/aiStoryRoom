import { sha256Canonical } from "@ai-story/shared";
import type {
  CanonicalLegacyCanonMutationV1,
  LegacyAuthoritativeEndingV1,
  LegacyCanonFactV1,
  LegacyNarrativePresentationV1,
  LegacyTerminalInputV1,
  LegacyTerminalMaterialV1,
  ValidatedLegacyTerminalCommitCommandV1,
} from "./contracts";

export function compareLegacyCanonicalText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function legacyTerminalHash(domain: string, payload: unknown): string {
  return sha256Canonical({ domain, payload });
}

export function canonicalLegacyFacts(input: readonly LegacyCanonFactV1[]): LegacyCanonFactV1[] {
  return input
    .map((fact) => ({ ...fact }))
    .sort((left, right) => compareLegacyCanonicalText(left.factId, right.factId)
      || compareLegacyCanonicalText(left.sourceRef, right.sourceRef)
      || compareLegacyCanonicalText(left.factText, right.factText));
}

export function canonicalLegacyMutations(
  input: readonly CanonicalLegacyCanonMutationV1[],
): CanonicalLegacyCanonMutationV1[] {
  return input
    .map((mutation) => ({ ...mutation }))
    .sort((left, right) => compareLegacyCanonicalText(left.mutationId, right.mutationId));
}

export function canonicalLegacyEnding(
  input: LegacyAuthoritativeEndingV1,
): LegacyAuthoritativeEndingV1 {
  return {
    ...input,
    gain: [...input.gain].sort(compareLegacyCanonicalText),
    loss: [...input.loss].sort(compareLegacyCanonicalText),
    causes: input.causes
      .map((cause) => ({ ...cause }))
      .sort((left, right) => compareLegacyCanonicalText(left.sourceRef, right.sourceRef)
        || compareLegacyCanonicalText(left.factText, right.factText)),
  };
}

export function canonicalLegacyMaterial(input: LegacyTerminalMaterialV1): LegacyTerminalMaterialV1 {
  return {
    canonBefore: canonicalLegacyFacts(input.canonBefore),
    terminalFacts: canonicalLegacyFacts(input.terminalFacts),
    ending: canonicalLegacyEnding(input.ending),
    canonMutations: canonicalLegacyMutations(input.canonMutations),
    resultType: input.resultType,
    replayPolicyVersion: input.replayPolicyVersion,
    narrativeAudience: { ...input.narrativeAudience },
    narrativeProfileVersion: input.narrativeProfileVersion,
    allowedFactIds: [...input.allowedFactIds].sort(compareLegacyCanonicalText),
    allowedObjectVersionIds: [...input.allowedObjectVersionIds].sort(compareLegacyCanonicalText),
    allowedKnowledgeIds: [...input.allowedKnowledgeIds].sort(compareLegacyCanonicalText),
  };
}

export function applyLegacyCanonMutations(
  canonBefore: readonly LegacyCanonFactV1[],
  mutations: readonly CanonicalLegacyCanonMutationV1[],
): LegacyCanonFactV1[] {
  const facts = new Map(canonBefore.map((fact) => [fact.factId, { ...fact }]));
  for (const mutation of canonicalLegacyMutations(mutations)) {
    facts.set(mutation.factId, {
      factId: mutation.factId,
      factText: mutation.factText,
      sourceRef: mutation.sourceRef,
    });
  }
  return canonicalLegacyFacts([...facts.values()]);
}

export function computeLegacyCanonHash(canon: readonly LegacyCanonFactV1[]): string {
  return legacyTerminalHash("legacy-terminal/canon/v1", canonicalLegacyFacts(canon));
}

export function computeLegacySettledStateHash(material: LegacyTerminalMaterialV1): string {
  const canonical = canonicalLegacyMaterial(material);
  return legacyTerminalHash("legacy-terminal/settled-state/v1", {
    terminalFacts: canonical.terminalFacts,
    ending: canonical.ending,
    canonMutations: canonical.canonMutations,
    resultType: canonical.resultType,
    replayPolicyVersion: canonical.replayPolicyVersion,
    narrativeAudience: canonical.narrativeAudience,
    narrativeProfileVersion: canonical.narrativeProfileVersion,
    allowedFactIds: canonical.allowedFactIds,
    allowedObjectVersionIds: canonical.allowedObjectVersionIds,
    allowedKnowledgeIds: canonical.allowedKnowledgeIds,
  });
}

export function computeLegacyTerminalInputHash(
  input: Omit<LegacyTerminalInputV1, "inputHash">,
): string {
  return legacyTerminalHash("legacy-terminal/input/v1", input);
}

export function computeLegacyEndingHash(ending: LegacyAuthoritativeEndingV1): string {
  return legacyTerminalHash("legacy-terminal/ending/v1", canonicalLegacyEnding(ending));
}

export function computeLegacyStructuredResultHash(result: unknown): string {
  return legacyTerminalHash("legacy-terminal/structured-result/v1", result);
}

export function computeLegacyNarrativeOutboxFingerprint(outbox: unknown): string {
  return legacyTerminalHash("legacy-terminal/narrative-outbox/v1", outbox);
}

export function computeLegacyTerminalCommandFingerprint(
  command: Omit<ValidatedLegacyTerminalCommitCommandV1, "commandFingerprint">,
): string {
  const { idempotencyKey: _transportKey, ...semanticCommand } = command;
  return legacyTerminalHash("legacy-terminal/commit-command/v1", semanticCommand);
}

export function computeLegacyNarrativeContentHash(input: { text: string }): string {
  return legacyTerminalHash("legacy-terminal/narrative-content/v1", input);
}

export function computeLegacyPresentationHash(
  presentation: Omit<LegacyNarrativePresentationV1, "presentationHash">,
): string {
  return legacyTerminalHash("legacy-terminal/narrative-presentation/v1", presentation);
}
