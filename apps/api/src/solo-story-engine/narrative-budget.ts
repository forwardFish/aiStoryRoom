import type { PartOneNarrativePlan } from "@ai-story/templates";

export type TurnNarrativeBudget = {
  kind: "SHORT_RESPONSE" | "STANDARD_SCENE" | "MAJOR_CONFLICT";
  minCharacters: number;
  targetCharacters: { minimum: number; maximum: number };
  maxCharacters: number;
  minParagraphs: number;
  maxParagraphs: number;
};

type PackageNarrativeBudget = {
  minCharacters: number;
  maxCharacters: number;
};

/**
 * The story package supplies the normal-scene prose limits. The current scene
 * plan may select the approved short-response register below that normal floor
 * so a complete exchange is not rejected or padded merely for length.
 *
 * This is shared by the Writer prompt and the server validator. It is a
 * creative budget, not a validator rule dump: the Writer sees only the final
 * range for this turn.
 */
export function resolvePartOneNarrativeBudget(
  plan: PartOneNarrativePlan,
  packageBudget: PackageNarrativeBudget
): TurnNarrativeBudget {
  const nonPlayerBeats = plan.sceneBeats.filter(
    (beat) => beat.mustAppear && beat.sourceType !== "PLAYER_ACTION"
  ).length;
  const isDialogueExchange =
    plan.npcAgenda.length > 0
    && plan.sceneBeats.some(
      (beat) => beat.mustAppear && beat.sourceType === "PLAYER_ACTION"
    );
  const hasAuthorizedActorArrival = plan.authorizedActorArrivals.length > 0;

  if (plan.transitionAllowed && nonPlayerBeats >= 4) {
    return clampBudget({
      kind: "MAJOR_CONFLICT",
      minCharacters: 550,
      targetCharacters: { minimum: 650, maximum: 850 },
      maxCharacters: 1000,
      minParagraphs: 4,
      maxParagraphs: 8
    }, packageBudget);
  }

  if (plan.transitionAllowed) {
    return clampBudget({
      kind: "STANDARD_SCENE",
      minCharacters: 380,
      targetCharacters: { minimum: 450, maximum: 650 },
      maxCharacters: 800,
      minParagraphs: 3,
      maxParagraphs: 6
    }, packageBudget);
  }

  if (nonPlayerBeats <= 3) {
    return clampBudget({
      kind: "SHORT_RESPONSE",
      minCharacters: 160,
      targetCharacters: {
        minimum: 220,
        maximum: isDialogueExchange
          ? (hasAuthorizedActorArrival ? 420 : 380)
          : 340
      },
      maxCharacters: hasAuthorizedActorArrival ? 520 : 480,
      minParagraphs: 2,
      // A short exchange may naturally split each speaker turn into its own
      // paragraph. Reject repetition by content, not by forcing good dialogue
      // back into five dense blocks.
      maxParagraphs: isDialogueExchange ? 7 : 4
    }, packageBudget);
  }

  return clampBudget({
    kind: "STANDARD_SCENE",
    minCharacters: 420,
    targetCharacters: { minimum: 500, maximum: 680 },
    maxCharacters: 800,
    minParagraphs: 3,
    maxParagraphs: 6
  }, packageBudget);
}

function clampBudget(
  budget: TurnNarrativeBudget,
  packageBudget: PackageNarrativeBudget
): TurnNarrativeBudget {
  const minCharacters = budget.kind === "SHORT_RESPONSE"
    ? budget.minCharacters
    : Math.max(packageBudget.minCharacters, budget.minCharacters);
  const maxCharacters = Math.max(
    minCharacters,
    Math.min(packageBudget.maxCharacters, budget.maxCharacters)
  );
  return {
    ...budget,
    minCharacters,
    maxCharacters,
    targetCharacters: {
      minimum: Math.min(
        maxCharacters,
        Math.max(minCharacters, budget.targetCharacters.minimum)
      ),
      maximum: Math.min(
        maxCharacters,
        Math.max(minCharacters, budget.targetCharacters.maximum)
      )
    }
  };
}
