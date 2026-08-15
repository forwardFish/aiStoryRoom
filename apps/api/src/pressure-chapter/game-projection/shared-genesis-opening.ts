import { computeNarrativeArtifactContentHash } from "@ai-story/shared";
import { loadStoryPackage } from "@ai-story/templates";
import { loadFixedStoryOpening } from "../../solo-story-engine/fixed-opening";
import type { PressureGameNarrativeProjectionV1 } from "./contracts";

const SHARED_SANGTIAN_PROLOGUE = loadFixedStoryOpening(
  "sangtian",
  loadStoryPackage("sangtian"),
).opening.prologueNarrative.trim();

const SHARED_SANGTIAN_PROLOGUE_HASH = computeNarrativeArtifactContentHash({
  text: SHARED_SANGTIAN_PROLOGUE,
  usedFactRefs: [],
});

export function pressureSharedGenesisOpeningTextV1(): string {
  return SHARED_SANGTIAN_PROLOGUE;
}

/**
 * Keeps persisted Genesis delivery state behind the player boundary. The
 * approved authored prologue is the single player-visible Genesis text for
 * every seat and for both REPLAY and FAST game reads.
 */
export function projectPressureSharedGenesisOpeningV1<
  T extends PressureGameNarrativeProjectionV1,
>(source: T): T {
  if (source.projectionKind !== "GENESIS_NARRATIVE") return source;
  return {
    ...source,
    status: "FALLBACK_PUBLISHED",
    text: SHARED_SANGTIAN_PROLOGUE,
    contentHash: SHARED_SANGTIAN_PROLOGUE_HASH,
    renderMode: "AUTHORED_FALLBACK",
  };
}
