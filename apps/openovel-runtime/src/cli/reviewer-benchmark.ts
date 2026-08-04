import { readFile } from "node:fs/promises";
import path from "node:path";
import { OpenAICompatibleProvider } from "../provider.js";
import {
  buildTruthObservationMessages,
  buildTruthObservationOutputSchema,
  TRUTH_OBSERVATION_MAX_TOKENS,
  compareTruthObservations,
  parseTruthObservationReview,
  truthTextHash,
} from "../truth-observation.js";
import type { ObservationReviewBinding } from "../truth-observation.js";
import type { NarrativeTruthContext } from "../truth-review.js";
import type { ProviderRequest } from "../types.js";

const callPath = arg("--call");
const models = arg("--models").split(",").map((item) => item.trim()).filter(Boolean);
const rebuildCurrent = process.argv.includes("--rebuild-current");
if (!callPath || !models.length) {
  throw new Error(
    "Usage: reviewer-benchmark --call=<recorded reviewer call> --models=<modelA,modelB> [--rebuild-current]",
  );
}

const recorded = JSON.parse(await readFile(callPath, "utf8")) as {
  request: ProviderRequest;
};
const recordedRequest = { ...recorded.request, stream: false };
const recordedContractMessage = recordedRequest.messages.at(-1)?.content || "{}";
const contractText = [
  "# Truth Extraction Contract\n",
  "# Fixed P0 Contract\n",
  "# Observation Contract\n",
].reduce((text, marker) => text.includes(marker) ? text.split(marker).at(-1)! : text, recordedContractMessage);
const contract = JSON.parse(contractText) as Record<string, any>;
const narratorCallPath = path.join(
  path.dirname(callPath),
  path.basename(callPath).replace(/\.reviewer(?:\.\d+)?\.json$/u, ".narrator.json"),
);
const narratorCall = JSON.parse(await readFile(narratorCallPath, "utf8")) as {
  result?: { text?: string };
};
const draft = String(narratorCall.result?.text || "");
if (!draft) throw new Error(`NARRATOR_DRAFT_NOT_FOUND:${narratorCallPath}`);
const context: NarrativeTruthContext = {
  originActorId: contract.originActorId,
  projectionActorId: contract.projectionActorId,
  catalog: contract.catalog,
  capabilityIds: contract.capabilityIds,
  secretIds: contract.secretIds,
  establishedPredicates: contract.establishedPredicates,
  allowedPredicates: contract.allowedPredicates,
  requiredVisiblePredicates: contract.requiredVisiblePredicates || [],
  forbiddenPredicates: contract.forbiddenPredicates,
  originActionsInDraft: contract.originActionsInDraft,
  forbiddenStoryClaims: contract.forbiddenStoryClaims || [],
  stopCondition: contract.selectedBeat?.stopCondition || "",
  sceneContinuity: contract.sceneContinuity || undefined,
};
const binding: ObservationReviewBinding = {
  runId: contract.runId,
  worldRevision: contract.worldRevision,
  draftId: contract.draftId,
  reviewId: contract.reviewId,
};
const currentMessages = buildTruthObservationMessages({ draft, binding, context });
const currentSchema = buildTruthObservationOutputSchema({
  binding,
  textHash: truthTextHash(draft),
  context,
});
const request: ProviderRequest = rebuildCurrent
  ? {
      ...recordedRequest,
      messages: currentMessages,
      maxTokens: TRUTH_OBSERVATION_MAX_TOKENS,
      json: true,
      jsonSchema: { name: "omw_truth_observation_v2", schema: currentSchema },
      stream: false,
    }
  : recordedRequest;
const requestMetrics = {
  protocol: rebuildCurrent ? "CURRENT_REBUILT" : "RECORDED",
  requestBytes: bytes(request),
  recordedRequestBytes: bytes(recordedRequest),
  messageBytes: bytes(request.messages),
  schemaBytes: bytes(request.jsonSchema?.schema || {}),
};

for (const model of models) {
  const provider = OpenAICompatibleProvider.fromEnv({
    ...process.env,
    OPENOVEL_REVIEWER_MODEL: model,
  });
  const startedAt = Date.now();
  try {
    const result = await provider.generate(request);
    const review = parseTruthObservationReview({
      raw: result.text,
      draft,
      binding,
      reviewerModel: result.model,
      context,
    });
    const comparison = compareTruthObservations({ review, context });
    process.stdout.write(`${JSON.stringify({
      model,
      ...requestMetrics,
      parseStatus: review.parseStatus,
      invalidReason: review.invalidReason || null,
      rawChars: result.text.length,
      rawTail: review.parseStatus === "INVALID" ? result.text.slice(-500) : null,
      findings: {
        assertions: review.assertions.length,
        unknownEntityMentions: review.unknownEntityMentions.length,
        parseIssues: review.parseIssues.length,
      },
      conflicts: comparison.conflicts.map((item) => ({
        code: item.code,
        exactQuote: item.exactQuote,
        category: item.category,
        evidenceQuote: item.evidenceQuote,
        predicate: item.predicate || null,
        unknownSurface: item.unknownSurface || null,
      })),
      shadow: comparison.shadow.map((item) => ({
        reason: item.reason,
        kind: item.kind,
        exactQuote: item.exactQuote,
      })),
      finishReason: result.finishReason || null,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
    })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      model,
      ...requestMetrics,
      parseStatus: "ERROR",
      error: String((error as Error).message || error),
      latencyMs: Date.now() - startedAt,
    })}\n`);
  }
}

function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function arg(name: string) {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}
