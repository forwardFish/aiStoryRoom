export type DeterministicFallbackSeed = {
  playerOutcome: string;
  npcOrWorldPressure: string;
  stopCondition: string;
};

/**
 * Render only facts that the settlement layer has already selected.
 *
 * This is intentionally world-agnostic and contains no story vocabulary. It
 * is the last-resort continuation when Narrator/Reviewer/Repair cannot produce
 * a safe draft. It never chooses another event, actor, object or consequence.
 */
export function renderDeterministicFallback(input: {
  seed: DeterministicFallbackSeed;
  protectedPlayerOutcomePresent: boolean;
}) {
  const playerOutcome = clean(input.seed.playerOutcome);
  const pressure = clean(input.seed.npcOrWorldPressure);
  const stopCondition = clean(input.seed.stopCondition);
  const paragraphs = [
    ...(input.protectedPlayerOutcomePresent ? [] : [playerOutcome]),
    pressure,
    stopCondition,
  ].filter(Boolean);
  const uniqueParagraphs = paragraphs.filter((paragraph, index) =>
    paragraphs.indexOf(paragraph) === index
  );
  if (!uniqueParagraphs.length) {
    throw new Error("DETERMINISTIC_FALLBACK_SEED_MISSING");
  }
  return uniqueParagraphs.join("\n\n");
}

function clean(value: string) {
  return String(value || "").trim();
}
