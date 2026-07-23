import {
  computeImmutableHash,
  readJson,
  sha256Bytes,
  sha256Json,
  validateWithSchema,
  writeJson,
} from "../story-decomposition/lib/contract-utils.mjs";

type JsonRecord = Record<string, any>;

export const PLAYER_GATE_VALIDATOR_VERSION = "sangtian-player-gate-v1.0.0";

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key?.startsWith("--") && argv[index + 1]) {
      values.set(key.slice(2), argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function resolvePointer(root: any, pointer: string) {
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((value, part) => value?.[part], root);
}

function collectForbiddenKeys(value: any, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectForbiddenKeys(entry, `${path}[${index}]`));
  }
  if (value === null || typeof value !== "object") return [];

  const forbidden = /^(decisionId|affordanceId|sourceClaimIds|adaptationDecisionIds|stateDependencies|hidden)/i;
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(forbidden.test(key) ? [`${path}.${key}`] : []),
    ...collectForbiddenKeys(entry, `${path}.${key}`),
  ]);
}

function verifyEvidenceRef(view: JsonRecord, ref: JsonRecord, label: string) {
  if (ref.viewHash !== view.viewHash) {
    throw new Error(`${label}: evidence viewHash does not match this checkpoint view`);
  }
  const visibleValue = resolvePointer(view, ref.fieldPath);
  if (typeof visibleValue !== "string") {
    throw new Error(`${label}: ${ref.fieldPath} does not resolve to player-visible text`);
  }
  if (ref.startOffset < 0 || ref.endOffset <= ref.startOffset || ref.endOffset > visibleValue.length) {
    throw new Error(`${label}: evidence offsets are outside the referenced visible text`);
  }
  const quote = visibleValue.slice(ref.startOffset, ref.endOffset);
  if (sha256Bytes(Buffer.from(quote, "utf8")) !== ref.quoteHash.toUpperCase()) {
    throw new Error(`${label}: quoteHash does not match the visible text slice`);
  }
}

function verifyScoredDimension(view: JsonRecord, dimension: JsonRecord, label: string) {
  if (!Number.isInteger(dimension.score) || dimension.score < 4) {
    throw new Error(`${label}: score ${dimension.score} is below the hard player-experience gate of 4`);
  }
  if (!Array.isArray(dimension.evidenceRefs) || dimension.evidenceRefs.length === 0) {
    throw new Error(`${label}: at least one player-visible evidence reference is required`);
  }
  dimension.evidenceRefs.forEach((ref: JsonRecord, index: number) =>
    verifyEvidenceRef(view, ref, `${label}.evidenceRefs[${index}]`),
  );
  if (typeof dimension.reason !== "string" || dimension.reason.trim().length === 0) {
    throw new Error(`${label}: a concrete player-perspective reason is required`);
  }
}

function average(scores: number[]) {
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100;
}

export function validatePlayerReview(view: JsonRecord, review: JsonRecord) {
  const errors: string[] = [];

  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };

  attempt(() => {
    if (computeImmutableHash(view, ["viewHash"]) !== String(view.viewHash).toUpperCase()) {
      throw new Error("PlayerVisibleView.viewHash does not match its canonical player-visible content");
    }
  });
  attempt(() => {
    if (computeImmutableHash(review) !== String(review.immutableHash).toUpperCase()) {
      throw new Error("CodexPlayerReview.immutableHash does not match the sealed review");
    }
  });
  attempt(() => {
    if (view.runId !== review.runId || view.checkpoint !== review.checkpoint || view.viewHash !== review.viewHash) {
      throw new Error("Review is not bound to the same run/checkpoint/view");
    }
  });
  attempt(() => {
    const forbiddenKeys = collectForbiddenKeys(review);
    if (forbiddenKeys.length > 0) {
      throw new Error(`Blind player review contains hidden/internal fields: ${forbiddenKeys.join(", ")}`);
    }
  });

  const experienceDimensions = review.checkpoint === "G00" ? review.openingScores : review.storyScores;
  const experienceScores: number[] = [];
  for (const [name, dimension] of Object.entries(experienceDimensions ?? {})) {
    attempt(() => verifyScoredDimension(view, dimension as JsonRecord, `experience.${name}`));
    experienceScores.push((dimension as JsonRecord).score);
  }

  const decisionScores: number[] = [];
  for (const [name, dimension] of Object.entries(review.decisionSetScores ?? {})) {
    attempt(() => verifyScoredDimension(view, dimension as JsonRecord, `decisionSet.${name}`));
    decisionScores.push((dimension as JsonRecord).score);
  }

  attempt(() => {
    const visibleOrdinals = view.displayDecisions.map((entry: JsonRecord) => entry.visibleOrdinal);
    const reviewOrdinals = review.decisionReviews.map((entry: JsonRecord) => entry.visibleOrdinal);
    if (JSON.stringify(visibleOrdinals) !== JSON.stringify(reviewOrdinals)) {
      throw new Error("Decision reviews must cover every visible option exactly once and in visible order");
    }
  });

  for (const [index, decisionReview] of (review.decisionReviews ?? []).entries()) {
    const visibleDecision = view.displayDecisions[index];
    attempt(() => {
      if (!visibleDecision || decisionReview.titleQuote !== visibleDecision.title) {
        throw new Error(`decisionReviews[${index}] titleQuote does not match the visible title`);
      }
      verifyScoredDimension(view, decisionReview.readability, `decisionReviews[${index}].readability`);
      decisionReview.evidenceRefs.forEach((ref: JsonRecord, refIndex: number) =>
        verifyEvidenceRef(view, ref, `decisionReviews[${index}].evidenceRefs[${refIndex}]`),
      );
    });
  }

  attempt(() => {
    review.notFiller.evidenceRefs.forEach((ref: JsonRecord, index: number) =>
      verifyEvidenceRef(view, ref, `notFiller.evidenceRefs[${index}]`),
    );
    review.wantsToContinue.evidenceRefs.forEach((ref: JsonRecord, index: number) =>
      verifyEvidenceRef(view, ref, `wantsToContinue.evidenceRefs[${index}]`),
    );
    if (review.notFiller.value !== true || review.wantsToContinue.value !== true) {
      throw new Error("Real-player hard gate requires notFiller=true and wantsToContinue=true");
    }
    if (review.reviewerAssessment !== "PASS") {
      throw new Error("Blind real player's FAIL assessment is a one-way veto");
    }
  });

  if (experienceScores.length === 0 || decisionScores.length !== 6) {
    errors.push("Required experience and six decision dimensions are incomplete");
  }

  return {
    errors,
    experienceAverage: experienceScores.length > 0 ? average(experienceScores) : 0,
    decisionAverage: decisionScores.length > 0 ? average(decisionScores) : 0,
    computedVerdict: errors.length === 0 ? "PASS" : "FAIL",
  } as const;
}

export async function buildCheckpointPlayerGate(view: JsonRecord, review: JsonRecord) {
  const viewSchema = await validateWithSchema("player-visible-view-v1", view);
  const reviewSchema = await validateWithSchema("codex-player-review-v1", review);
  const validation = validatePlayerReview(view, review);
  const schemaErrors = [
    ...viewSchema.errors.map((error: any) => `view schema ${error.instancePath || "/"} ${error.message}`),
    ...reviewSchema.errors.map((error: any) => `review schema ${error.instancePath || "/"} ${error.message}`),
  ];
  const errors = [...schemaErrors, ...validation.errors];
  const core = {
    schemaVersion: "checkpoint-player-gate-v1",
    runId: review.runId,
    checkpoint: review.checkpoint,
    playerReviewHash: review.immutableHash,
    reviewQualityStatus: errors.length === 0 ? "PASS" : "FAIL",
    experienceAverage: validation.experienceAverage,
    decisionAverage: validation.decisionAverage,
    computedVerdict: errors.length === 0 ? "PASS" : "FAIL",
    validatorVersion: PLAYER_GATE_VALIDATOR_VERSION,
  };
  const validatorSignature = sha256Json({ ...core, errors });
  const gate = { ...core, validatorSignature };
  return { gate: { ...gate, immutableHash: computeImmutableHash(gate) }, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const viewPath = args.get("view");
  const reviewPath = args.get("review");
  const outPath = args.get("out");
  if (!viewPath || !reviewPath || !outPath) {
    throw new Error("Usage: --view <player-visible-view.json> --review <codex-player-review.json> --out <checkpoint-player-gate.json>");
  }
  const result = await buildCheckpointPlayerGate(await readJson(viewPath), await readJson(reviewPath));
  await writeJson(outPath, result.gate);
  console.log(JSON.stringify({ output: outPath, ...result }, null, 2));
  if (result.gate.computedVerdict !== "PASS") process.exitCode = 1;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/sangtian-part-one-player-review-validator.ts")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
