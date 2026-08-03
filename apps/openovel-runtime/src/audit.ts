import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJson, readText } from "./io.js";
import type { WorkspacePaths } from "./paths.js";
import type { ProviderRequest, ProviderResult, RunMetadata } from "./types.js";

export type PlayerCheckpointReview = {
  checkpoint: string;
  actionResponded: boolean | null;
  choiceImpactVisible: boolean | null;
  novelLike: boolean;
  worldToneFit: boolean;
  npcAgency: boolean;
  playerAgencyPreserved: boolean;
  causalGrounded: boolean;
  coherent: boolean;
  optionsUnderstandable: boolean | null;
  optionsDistinct: boolean | null;
  optionsExecutable: boolean | null;
  freeInputAvailable: boolean;
  wantsToContinue: boolean;
  reportLike: boolean;
  majorContinuityError: boolean;
  blockingProblems?: string[];
  notes?: string;
};

type RecordedCall = {
  turnId: string;
  stage: ProviderRequest["profile"];
  attempt?: number;
  request?: ProviderRequest;
  result?: ProviderResult | null;
  error?: string | null;
};

type SceneLogEvent = {
  type?: string;
  turnId?: string;
  code?: string;
  [key: string]: unknown;
};

export async function auditOpenNovelRun(
  paths: WorkspacePaths,
  input: {
    targetTurns?: number;
    reviews?: PlayerCheckpointReview[];
    pricing?: {
      inputPerMillion: number;
      outputPerMillion: number;
      currency: string;
    } | null;
  } = {},
) {
  const targetTurns = Math.max(1, Number(input.targetTurns || 5));
  const metadata = await readJson<RunMetadata | null>(paths.metadata, null);
  if (!metadata) throw new Error(`Run metadata not found: ${paths.metadata}`);

  const [chapters, sceneLog, calls] = await Promise.all([
    readText(paths.chapters, ""),
    readJsonLines<SceneLogEvent>(paths.sceneLog),
    readRecordedCalls(paths),
  ]);
  const reviews = input.reviews || [];
  const committedTurns = sceneLog.filter((event) => event.type === "turn_committed").length;
  const readerActions = sceneLog.filter((event) => event.type === "reader_action").length;
  const failedForegrounds = sceneLog.filter((event) => event.type === "foreground_failed").length;
  const storykeeperApplied = sceneLog.filter((event) => event.type === "storykeeper_applied").length;
  const shadowWarnings = sceneLog.filter((event) => event.type === "shadow_warning");
  const canonTurns = (chapters.match(/^\*\*读者选择\*\*：/gm) || []).length;
  const byProfile = profileMetrics(calls);
  const expectedReviewIds = [
    "G00",
    ...Array.from(
      { length: targetTurns },
      (_, index) => `T${String(index + 1).padStart(2, "0")}`,
    ),
  ];
  const duplicateReviewIds = duplicates(reviews.map((review) => String(review?.checkpoint || "")));
  const invalidReviewIds = reviews
    .filter((review) => !validReview(review))
    .map((review) => String(review?.checkpoint || "UNKNOWN"));
  const reviewById = new Map(reviews.map((review) => [review.checkpoint, review]));
  const missingReviewIds = expectedReviewIds.filter((checkpoint) => !reviewById.has(checkpoint));
  const reviewed = expectedReviewIds
    .map((checkpoint) => reviewById.get(checkpoint))
    .filter((review): review is PlayerCheckpointReview => Boolean(review));
  const blockingReviews = reviewed.filter((review) => (
    review.majorContinuityError
    || review.actionResponded === false
    || review.choiceImpactVisible === false
    || !review.novelLike
    || !review.worldToneFit
    || !review.npcAgency
    || !review.playerAgencyPreserved
    || !review.causalGrounded
    || !review.coherent
    || review.optionsUnderstandable === false
    || review.optionsDistinct === false
    || review.optionsExecutable === false
    || !review.freeInputAvailable
    || !review.wantsToContinue
    || review.reportLike
    || Boolean(review.blockingProblems?.length)
  ));

  const technicalChecks = {
    runtimeModeFrozen: metadata.runtimeMode === "OPENOVEL_V1",
    targetTurnsCommitted: metadata.turnNumber >= targetTurns,
    canonMatchesMetadata: canonTurns === metadata.turnNumber,
    sceneLogMatchesMetadata: committedTurns === metadata.turnNumber,
    noUncommittedReaderAction: readerActions === committedTurns + failedForegrounds,
    narratorRecordedForEveryCommittedTurn: byProfile.narrator.calls >= committedTurns,
    optionsRecordedForEveryCommittedTurn: byProfile.options.calls === committedTurns,
    canonReady: metadata.status === "READY",
  };
  const technicalPassed = Object.values(technicalChecks).every(Boolean);
  const playerPassed = missingReviewIds.length === 0
    && duplicateReviewIds.length === 0
    && invalidReviewIds.length === 0
    && blockingReviews.length === 0;
  const inputTokens = Object.values(byProfile).reduce((sum, value) => sum + value.inputTokens, 0);
  const outputTokens = Object.values(byProfile).reduce((sum, value) => sum + value.outputTokens, 0);
  const totalLatencyMs = Object.values(byProfile).reduce((sum, value) => sum + value.latencyMs, 0);
  const cost = estimateCost(
    inputTokens,
    outputTokens,
    committedTurns,
    input.pricing || null,
  );

  return {
    schemaVersion: "openovel_acceptance_audit_v1",
    runId: metadata.runId,
    runtimeMode: metadata.runtimeMode,
    targetTurns,
    currentTurn: metadata.turnNumber,
    status: metadata.status,
    verdict: technicalPassed && playerPassed ? "PASS" : "NOT_COMPLETE",
    technical: {
      passed: technicalPassed,
      checks: technicalChecks,
      readerActions,
      committedTurns,
      canonTurns,
      failedForegrounds,
      storykeeperApplied,
      storykeeperPending: Math.max(0, committedTurns - storykeeperApplied),
    },
    player: {
      passed: playerPassed,
      expectedReviewIds,
      missingReviewIds,
      duplicateReviewIds,
      invalidReviewIds,
      blockingReviewIds: blockingReviews.map((review) => review.checkpoint),
      choiceImpactVisibleRate: nullableRate(reviewed, (review) => review.choiceImpactVisible),
      worldToneFitRate: rate(reviewed, (review) => review.worldToneFit),
      playerAgencyPreservedRate: rate(reviewed, (review) => review.playerAgencyPreserved),
      causalGroundedRate: rate(reviewed, (review) => review.causalGrounded),
      optionsDistinctRate: nullableRate(reviewed, (review) => review.optionsDistinct),
      optionsExecutableRate: nullableRate(reviewed, (review) => review.optionsExecutable),
      wantsToContinueRate: rate(reviewed, (review) => review.wantsToContinue),
      reportLikeRate: rate(reviewed, (review) => review.reportLike),
      majorContinuityErrors: reviewed.filter((review) => review.majorContinuityError).length,
    },
    model: {
      profiles: byProfile,
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      totalLatencyMs,
      averageLatencyPerCallMs: calls.length ? Math.round(totalLatencyMs / calls.length) : 0,
      repeatOpeningRetries: calls.filter((call) => (
        call.stage === "narrator" && Number(call.attempt || 1) > 1
      )).length,
      recordedErrors: calls.filter((call) => Boolean(call.error)).length,
      cost,
    },
    warnings: {
      total: shadowWarnings.length,
      byCode: countBy(shadowWarnings.map((event) => String(event.code || "UNKNOWN"))),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function readRecordedCalls(paths: WorkspacePaths) {
  const names = await readdir(paths.callsDir).catch(() => []);
  const callNames = names.filter((name) => /\.json$/i.test(name)).sort();
  const calls = await Promise.all(
    callNames.map((name) => readJson<RecordedCall | null>(path.join(paths.callsDir, name), null)),
  );
  return calls.filter((call): call is RecordedCall => Boolean(call?.stage));
}

async function readJsonLines<T>(file: string) {
  const text = await readText(file, "");
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as T];
    } catch {
      return [];
    }
  });
}

function profileMetrics(calls: RecordedCall[]) {
  const profiles = {
    narrator: emptyProfile(),
    reviewer: emptyProfile(),
    repair: emptyProfile(),
    options: emptyProfile(),
    storykeeper: emptyProfile(),
  };
  for (const call of calls) {
    const target = profiles[call.stage];
    target.calls += 1;
    target.errors += call.error ? 1 : 0;
    target.inputTokens += Number(call.result?.usage?.inputTokens || 0);
    target.outputTokens += Number(call.result?.usage?.outputTokens || 0);
    target.latencyMs += Number(call.result?.latencyMs || 0);
  }
  return profiles;
}

function emptyProfile() {
  return {
    calls: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
  };
}

function rate<T>(values: T[], predicate: (value: T) => boolean) {
  if (!values.length) return null;
  return Number((values.filter(predicate).length / values.length).toFixed(4));
}

function nullableRate<T>(values: T[], pick: (value: T) => boolean | null) {
  const eligible = values
    .map((value) => pick(value))
    .filter((value): value is boolean => typeof value === "boolean");
  return rate(eligible, Boolean);
}

function countBy(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function validReview(review: PlayerCheckpointReview) {
  if (!review || typeof review !== "object") return false;
  if (!/^(?:G00|T\d{2})$/.test(String(review.checkpoint || ""))) return false;
  if (review.checkpoint === "G00") {
    if (review.actionResponded !== null && typeof review.actionResponded !== "boolean") return false;
    if (review.choiceImpactVisible !== null && typeof review.choiceImpactVisible !== "boolean") return false;
  } else if (typeof review.actionResponded !== "boolean") {
    return false;
  } else if (typeof review.choiceImpactVisible !== "boolean") {
    return false;
  }
  if (review.optionsUnderstandable !== null && typeof review.optionsUnderstandable !== "boolean") return false;
  if (review.optionsDistinct !== null && typeof review.optionsDistinct !== "boolean") return false;
  if (review.optionsExecutable !== null && typeof review.optionsExecutable !== "boolean") return false;
  return [
    review.novelLike,
    review.worldToneFit,
    review.npcAgency,
    review.playerAgencyPreserved,
    review.causalGrounded,
    review.coherent,
    review.freeInputAvailable,
    review.wantsToContinue,
    review.reportLike,
    review.majorContinuityError,
  ].every((value) => typeof value === "boolean")
    && (!review.blockingProblems || (
      Array.isArray(review.blockingProblems)
      && review.blockingProblems.every((value) => typeof value === "string")
    ));
}

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].filter(Boolean).sort();
}

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  committedTurns: number,
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
    currency: string;
  } | null,
) {
  if (!pricing) {
    return {
      configured: false,
      currency: null,
      inputPerMillion: null,
      outputPerMillion: null,
      estimatedTotal: null,
      estimatedPerCommittedTurn: null,
    };
  }
  const inputPerMillion = Number(pricing.inputPerMillion);
  const outputPerMillion = Number(pricing.outputPerMillion);
  const currency = String(pricing.currency || "").trim();
  if (
    !Number.isFinite(inputPerMillion)
    || inputPerMillion < 0
    || !Number.isFinite(outputPerMillion)
    || outputPerMillion < 0
    || !currency
  ) {
    throw new Error("pricing requires non-negative input/output rates and a currency");
  }
  const total = (inputTokens * inputPerMillion + outputTokens * outputPerMillion) / 1_000_000;
  return {
    configured: true,
    currency,
    inputPerMillion,
    outputPerMillion,
    estimatedTotal: roundCost(total),
    estimatedPerCommittedTurn: committedTurns ? roundCost(total / committedTurns) : null,
  };
}

function roundCost(value: number) {
  return Number(value.toFixed(8));
}
