import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalize,
  computeImmutableHash,
  readJson,
  repoRoot,
  sha256Bytes,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const REVIEWER_VERSION = "sangtian-track-b-and-adaptation-review-v1.2.0";
const EVIDENCE_RELEASE_ID = "sangtian-part-one-evidence-v1.0.0";
const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
const baseUrl = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").trim().replace(/\/+$/, "");
const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
const model = String(process.env.AUTHORING_REVIEW_MODEL || "deepseek-chat").trim();
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for independent authoring review");

const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const evidenceRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived/evidence-v2/published", EVIDENCE_RELEASE_ID);
const candidateRoot = resolve(authoringRoot, "mechanisms/candidates/part-01-v3");
const approvedMechanismRoot = resolve(authoringRoot, "mechanisms/approved/part-01-v3");
const reviewRoot = resolve(authoringRoot, "reviews/track-b-and-adaptation-v3");
const requirementSet = await readJson(resolve(authoringRoot, "requirements/part-01.requirements.json"));
const adaptationSet = await readJson(resolve(authoringRoot, "adaptation/part-01.adaptation-decisions.json"));
const requirementById = new Map(requirementSet.requirements.map((item) => [item.requirementId, item]));
const adaptationById = new Map(adaptationSet.adaptations.map((item) => [item.adaptationDecisionId, item]));

const claimById = new Map();
for (const name of (await readdir(resolve(evidenceRoot, "claims"))).filter((entry) => entry.endsWith(".claims.json"))) {
  const claimSet = await readJson(resolve(evidenceRoot, "claims", name));
  for (const claim of claimSet.claims) claimById.set(claim.claimId, claim);
}

function parseJsonObject(rawText) {
  return JSON.parse(rawText.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, ""));
}

async function callReviewer({ reviewKey, kind, candidate, requirements, claims, adaptations = [] }) {
  const systemPrompt = [
    "你是《桑田诏》原著证据层到玩法层的独立边界审核员，不是编剧，也不负责润色。",
    "审核目标是防止把原著后续当成房间必然未来、防止把人物说法当客观事实、防止把游戏新增设定伪装成原著事实，同时确认候选确实能服务列出的剧情需求。",
    kind === "MECHANISM"
      ? "对 Gameplay Mechanism：检查 preconditions、actor/authority、allowedMoves、countermoves、stateEffects、delayedConsequences、invariants、strength 与 limitations 是否由给出的 Claim 支持，或已明确留给 Adaptation Gap。弱推断不得成为无条件强制规则。"
      : "对 Adaptation Decision：允许 invent_for_gameplay、split 等改编，但 intentionalDifferences 必须诚实，必须保留列出的原著 invariant，且不能预先宣布幕后主使、关键证据已存在或原著后续必然发生。",
    "只输出最终 JSON：{\"verdict\":\"PASS|FAIL|NEEDS_HUMAN_REVIEW\",\"issues\":[{\"issueType\":\"短标签\",\"severity\":\"BLOCKER|HIGH|MEDIUM|LOW\",\"reason\":\"不超过200汉字\"}]}。不要输出修改稿。没有最终成立的问题就返回 PASS 和空数组。",
  ].join("\n");
  const userPrompt = JSON.stringify({ kind, candidate, requirements, relevantAdaptationDecisions: adaptations, reviewedClaims: claims }, null, 2);
  const startedAt = new Date().toISOString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.1,
      max_tokens: 1400,
    }),
  });
  const completedAt = new Date().toISOString();
  const payload = await response.json().catch(() => null);
  const rawText = String(payload?.choices?.[0]?.message?.content || "").trim();
  const providerRecord = {
    schemaVersion: "sangtian-authoring-review-provider-record-v1",
    reviewKey,
    kind,
    provider: "deepseek",
    model: String(payload?.model || model),
    providerRequestId: response.headers.get("x-request-id") || response.headers.get("x-deepseek-request-id"),
    providerCallCount: 1,
    startedAt,
    completedAt,
    httpStatus: response.status,
    inputHash: sha256Bytes(Buffer.from(`${systemPrompt}\n${userPrompt}`, "utf8")),
    rawOutputHash: rawText ? sha256Bytes(Buffer.from(rawText, "utf8")) : null,
    rawText,
    usage: payload?.usage ?? null,
  };
  await writeJson(resolve(reviewRoot, "raw", `${reviewKey}.provider.json`), providerRecord);
  let parsed;
  try {
    if (!response.ok) throw new Error(String(payload?.error?.message || `HTTP ${response.status}`));
    if (!rawText) throw new Error("Empty reviewer output");
    parsed = parseJsonObject(rawText);
  } catch (error) {
    parsed = { verdict: "FAIL", issues: [{ issueType: "REVIEWER_OUTPUT_INVALID", severity: "BLOCKER", reason: error instanceof Error ? error.message : String(error) }] };
  }
  const issues = Array.isArray(parsed.issues) ? parsed.issues.map((issue) => ({
    issueType: String(issue?.issueType || "UNCLASSIFIED_REVIEW_ISSUE").slice(0, 120),
    severity: ["BLOCKER", "HIGH", "MEDIUM", "LOW"].includes(issue?.severity) ? issue.severity : "HIGH",
    reason: String(issue?.reason || "Reviewer returned an issue without a reason.").slice(0, 800),
  })) : [{ issueType: "REVIEWER_ISSUES_NOT_ARRAY", severity: "BLOCKER", reason: "Reviewer output did not contain an issues array." }];
  const hasHigh = issues.some((issue) => ["BLOCKER", "HIGH"].includes(issue.severity));
  const hasMedium = issues.some((issue) => issue.severity === "MEDIUM");
  const verdict = hasHigh ? "FAIL" : hasMedium || parsed.verdict === "NEEDS_HUMAN_REVIEW" ? "NEEDS_HUMAN_REVIEW" : parsed.verdict === "PASS" ? "PASS" : "FAIL";
  const reviewBase = {
    schemaVersion: "sangtian-authoring-candidate-review-v1",
    reviewKey,
    kind,
    reviewerVersion: REVIEWER_VERSION,
    provider: "deepseek",
    model: providerRecord.model,
    providerRecordHash: sha256Bytes(Buffer.from(JSON.stringify(providerRecord), "utf8")),
    candidateHash: computeImmutableHash(candidate),
    requirementIds: requirements.map((item) => item.requirementId),
    sourceClaimIds: claims.map((item) => item.claimId),
    verdict,
    issues,
    reviewedAt: completedAt,
  };
  const review = { ...reviewBase, immutableHash: computeImmutableHash(reviewBase) };
  await writeJson(resolve(reviewRoot, `${reviewKey}.review.json`), review);
  return { review, providerRecord };
}

const reviews = [];
const approvedAdaptations = [];
const approvedAdaptationById = new Map();
const mechanismFiles = (await readdir(candidateRoot)).filter((name) => name.endsWith(".json") && name !== "manifest.json").sort();
const totalReviews = mechanismFiles.length + adaptationSet.adaptations.length;
for (const [index, adaptation] of adaptationSet.adaptations.entries()) {
  const requirements = requirementSet.requirements.filter((item) => item.adaptationGapIds.includes(adaptation.adaptationDecisionId));
  const claims = [...new Set(requirements.flatMap((item) => item.sourceClaimIds))].map((id) => claimById.get(id)).filter(Boolean);
  const { review } = await callReviewer({ reviewKey: adaptation.adaptationDecisionId, kind: "ADAPTATION", candidate: adaptation, requirements, claims });
  reviews.push(review);
  if (review.verdict === "PASS") {
    const approved = {
      ...adaptation,
      reviewStatus: "APPROVED",
      approvedBy: `${REVIEWER_VERSION}:${review.model}`,
      approvedAt: review.reviewedAt,
    };
    const validation = await validateWithSchema("adaptation-decision-v2", approved);
    if (!validation.valid) throw new Error(`${adaptation.adaptationDecisionId} approved schema invalid: ${JSON.stringify(validation.errors)}`);
    approvedAdaptations.push(approved);
    approvedAdaptationById.set(approved.adaptationDecisionId, approved);
  }
  console.log(JSON.stringify({ progress: `${index + 1}/${totalReviews}`, reviewKey: adaptation.adaptationDecisionId, verdict: review.verdict }, null, 2));
}

for (const [index, name] of mechanismFiles.entries()) {
  const candidate = await readJson(resolve(candidateRoot, name));
  const requirements = candidate.requirementIds.map((id) => requirementById.get(id));
  const claims = candidate.sourceClaimIds.map((id) => claimById.get(id));
  if (requirements.some((item) => !item) || claims.some((item) => !item)) throw new Error(`${candidate.mechanismCandidateId} has unresolved review inputs`);
  const adaptations = [...new Set(requirements.flatMap((item) => item.adaptationGapIds))].map((id) => approvedAdaptationById.get(id)).filter(Boolean);
  const { review } = await callReviewer({ reviewKey: candidate.mechanismCandidateId, kind: "MECHANISM", candidate, requirements, claims, adaptations });
  reviews.push(review);
  if (review.verdict === "PASS") {
    const approved = { ...candidate, status: "APPROVED_FOR_T3" };
    const validation = await validateWithSchema("gameplay-mechanism-candidate-v1", approved);
    if (!validation.valid) throw new Error(`${candidate.mechanismCandidateId} approved schema invalid`);
    await writeJson(resolve(approvedMechanismRoot, `${candidate.mechanismCandidateId}.json`), approved);
  }
  console.log(JSON.stringify({ progress: `${adaptationSet.adaptations.length + index + 1}/${totalReviews}`, reviewKey: candidate.mechanismCandidateId, verdict: review.verdict }, null, 2));
}

const aggregateBase = {
  schemaVersion: "sangtian-authoring-candidate-review-set-v1",
  reviewerVersion: REVIEWER_VERSION,
  evidenceReleaseId: EVIDENCE_RELEASE_ID,
  provider: "deepseek",
  requestedModel: model,
  reviewCount: reviews.length,
  providerCallCount: reviews.length,
  mechanismReviewCount: mechanismFiles.length,
  adaptationReviewCount: adaptationSet.adaptations.length,
  passCount: reviews.filter((item) => item.verdict === "PASS").length,
  failCount: reviews.filter((item) => item.verdict === "FAIL").length,
  needsHumanReviewCount: reviews.filter((item) => item.verdict === "NEEDS_HUMAN_REVIEW").length,
  reviewHashes: reviews.map((item) => item.immutableHash),
  verdict: reviews.every((item) => item.verdict === "PASS") ? "PASS" : "FAIL",
};
const aggregate = { ...aggregateBase, immutableHash: computeImmutableHash(aggregateBase) };
await writeJson(resolve(reviewRoot, "review-set.json"), aggregate);
await writeJson(resolve(authoringRoot, "adaptation/approved/part-01-v3.adaptation-decisions.json"), {
  schemaVersion: "adaptation-decision-set-v2",
  adaptations: approvedAdaptations,
  reviewSetHash: aggregate.immutableHash,
});
await writeJson(resolve(approvedMechanismRoot, "manifest.json"), {
  schemaVersion: "sangtian-approved-mechanism-manifest-v1",
  evidenceReleaseId: EVIDENCE_RELEASE_ID,
  reviewSetHash: aggregate.immutableHash,
  mechanismCandidateIds: reviews.filter((item) => item.kind === "MECHANISM" && item.verdict === "PASS").map((item) => item.reviewKey),
  status: aggregate.verdict === "PASS" ? "APPROVED" : "BLOCKED",
});
console.log(JSON.stringify({ reviewRoot, approvedMechanismRoot, ...aggregate }, null, 2));
if (aggregate.verdict !== "PASS") process.exitCode = 1;
