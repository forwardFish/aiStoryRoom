import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readJson,
  repoRoot,
  sha256Bytes,
  writeJson,
} from "./lib/contract-utils.mjs";

const REVIEWER_VERSION = "sangtian-evidence-independent-review-v1.2.1";
const DEFAULT_ROOT = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived/evidence-v2/candidates/sangtian-part-one-evidence-seed-v5/track-a-evidence");
const candidateRoot = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT;
const reviewRoot = resolve(candidateRoot, "../reviews");
const derivedRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived");
const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
const baseUrl = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").trim().replace(/\/+$/, "");
const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
const model = String(process.env.EVIDENCE_REVIEW_MODEL || "deepseek-chat").trim();
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for independent evidence review");

function readJsonLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function listFiles(path, suffix) {
  const entries = await readdir(path, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(child, suffix));
    else if (entry.name.endsWith(suffix)) result.push(child);
  }
  return result.sort();
}

const paragraphCache = new Map();
async function sourceTextFor(scene) {
  if (!paragraphCache.has(scene.chapterId)) {
    paragraphCache.set(scene.chapterId, readJsonLines(await readFile(resolve(derivedRoot, `paragraphs/${scene.chapterId}.jsonl`), "utf8")));
  }
  const paragraphs = paragraphCache.get(scene.chapterId);
  const ref = scene.sourceRefs[0];
  const startIndex = paragraphs.findIndex((entry) => entry.paragraphId === ref.paragraphStartId);
  const endIndex = paragraphs.findIndex((entry) => entry.paragraphId === ref.paragraphEndId);
  return paragraphs.slice(startIndex, endIndex + 1)
    .filter((entry) => entry.kind === "content")
    .map((entry) => `[${entry.paragraphId} L${entry.lineStart}-${entry.lineEnd}] ${entry.text}`)
    .join("\n");
}

function parseJsonObject(rawText) {
  const trimmed = rawText.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function normalizeIssue(issue, scene, claimById) {
  const artifactId = typeof issue?.artifactId === "string" && issue.artifactId.trim() ? issue.artifactId.trim() : scene.artifactId;
  const sourceRefs = claimById.get(artifactId)?.sourceRefs ?? scene.sourceRefs;
  return {
    artifactId,
    issueType: String(issue?.issueType || "UNCLASSIFIED_REVIEW_ISSUE").slice(0, 120),
    severity: ["BLOCKER", "HIGH", "MEDIUM", "LOW"].includes(issue?.severity) ? issue.severity : "HIGH",
    sourceRefs,
    reason: String(issue?.reason || "Reviewer returned an issue without a reason.").slice(0, 1600),
  };
}

const sceneFiles = await listFiles(resolve(candidateRoot, "scenes"), ".scene.json");
const aggregateReviews = [];
let providerCallCount = 0;
for (const [index, sceneFile] of sceneFiles.entries()) {
  const scene = await readJson(sceneFile);
  const claimSet = await readJson(resolve(candidateRoot, "claims", `${scene.sceneId}.claims.json`));
  const claimById = new Map(claimSet.claims.map((claim) => [claim.claimId, claim]));
  const sourceText = await sourceTextFor(scene);
  const systemPrompt = [
    "你是独立的《大明王朝1566》原著证据审核员，不是改写者，也不是游戏编剧。",
    "只审核候选 Scene 和 Claim 是否被下面逐段原文支持。不得因为结论适合游戏就放宽标准。",
    "重点检查：source span 是否支持；人物说法/信念/意图是否被错误升级成客观事实；主客体与说话人是否正确；是否偷用了后文知识；knownBy 是否超出在场或明确的信息传递。",
    "每条 Claim 是从 source span 选择出的原子证据单元，不承诺复述该 span 的所有对白和动作。本审核只判断候选实际写出的 Claim 与 Scene 元数据是否真实、精确、不越界；不得仅因原文还有其他动作、时间副词、伴随动作或后续动作未被抽取而报 missing_action。候选是否覆盖剧情需求由独立 Coverage Gate 审核，不属于你的职责。",
    "只有当 Claim 明确声称一份完整过程或完整清单，而遗漏的条件会使该 Claim 本身变成虚假、错误归因或实质误导时，才可报告 omission；必须指出遗漏如何改变这条 Claim 的真假，不能以‘原文还写了别的动作’作为理由。",
    "先在内部完成判断，再只输出最终仍成立的问题。不得把已自行撤销、降级后认为不构成问题或理由中写明‘claim is supported/no issue’的候选问题放进 issues。每条 reason 不超过 200 个汉字，不复述推理过程。没有最终成立的问题就返回 {\"verdict\":\"PASS\",\"issues\":[]}。",
    "不要提供更好的改写。只返回 JSON 对象：{\"verdict\":\"PASS|FAIL|NEEDS_HUMAN_REVIEW\",\"issues\":[{\"artifactId\":\"候选 artifactId 或 claimId\",\"issueType\":\"短标签\",\"severity\":\"BLOCKER|HIGH|MEDIUM|LOW\",\"reason\":\"具体理由\"}]}。",
    "PASS 只能在没有 BLOCKER/HIGH 且不存在需要人工判断的歧义时使用。",
  ].join("\n");
  const userPrompt = JSON.stringify({
    scene: {
      artifactId: scene.artifactId,
      sceneId: scene.sceneId,
      title: scene.title,
      presentCharacterRefs: scene.presentCharacterRefs,
      sourceRefs: scene.sourceRefs,
    },
    claims: claimSet.claims.map((claim) => ({
      claimId: claim.claimId,
      claimType: claim.claimType,
      subjectRef: claim.subjectRef,
      predicate: claim.predicate,
      statement: claim.statement,
      speakerRef: claim.speakerRef,
      truthStatus: claim.truthStatus,
      epistemicStatus: claim.epistemicStatus,
      knownBy: claim.knownBy,
      runtimeAvailability: claim.runtimeAvailability,
      mustNotBeTreatedAsObjectiveFact: claim.mustNotBeTreatedAsObjectiveFact,
    })),
    exactSourceParagraphs: sourceText,
  }, null, 2);

  const startedAt = new Date().toISOString();
  providerCallCount += 1;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.1,
      max_tokens: 2200,
    }),
  });
  const completedAt = new Date().toISOString();
  const payload = await response.json().catch(() => null);
  const rawText = String(payload?.choices?.[0]?.message?.content || "").trim();
  const providerRecord = {
    schemaVersion: "sangtian-evidence-review-provider-record-v1",
    reviewedArtifactId: scene.artifactId,
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
  await writeJson(resolve(reviewRoot, "raw", `${scene.sceneId}.provider.json`), providerRecord);

  let parsed;
  let parseError = null;
  try {
    if (!response.ok) throw new Error(String(payload?.error?.message || `HTTP ${response.status}`));
    if (!rawText) throw new Error("Empty reviewer output");
    parsed = parseJsonObject(rawText);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    parsed = { verdict: "FAIL", issues: [{ artifactId: scene.artifactId, issueType: "REVIEWER_OUTPUT_INVALID", severity: "BLOCKER", reason: parseError }] };
  }
  const issues = Array.isArray(parsed.issues) ? parsed.issues.map((issue) => normalizeIssue(issue, scene, claimById)) : [normalizeIssue({ artifactId: scene.artifactId, issueType: "REVIEWER_ISSUES_NOT_ARRAY", severity: "BLOCKER", reason: "Reviewer output did not contain an issues array." }, scene, claimById)];
  const hasHigh = issues.some((issue) => ["BLOCKER", "HIGH"].includes(issue.severity));
  const hasMedium = issues.some((issue) => issue.severity === "MEDIUM");
  const derivedVerdict = hasHigh || parseError ? "FAIL" : hasMedium || parsed.verdict === "NEEDS_HUMAN_REVIEW" ? "NEEDS_HUMAN_REVIEW" : parsed.verdict === "PASS" ? "PASS" : "FAIL";
  const review = {
    schemaVersion: "dm1566_evidence_review_v2",
    reviewId: `REVIEW-${scene.sceneId}-R1`,
    reviewerType: "MODEL_INDEPENDENT",
    reviewerVersion: REVIEWER_VERSION,
    provider: "deepseek",
    model: providerRecord.model,
    providerRecordHash: sha256Bytes(Buffer.from(JSON.stringify(providerRecord), "utf8")),
    reviewedArtifactIds: [scene.artifactId, ...scene.claimIds],
    verdict: derivedVerdict,
    issues,
    reviewedAt: completedAt,
  };
  await writeJson(resolve(reviewRoot, `${scene.sceneId}.review.json`), review);
  aggregateReviews.push(review);
  console.log(JSON.stringify({ progress: `${index + 1}/${sceneFiles.length}`, sceneId: scene.sceneId, verdict: review.verdict, issueCount: issues.length, providerCallCount }, null, 2));
}

const aggregate = {
  schemaVersion: "dm1566_evidence_review_set_v2",
  reviewerVersion: REVIEWER_VERSION,
  provider: "deepseek",
  model,
  sceneReviewCount: aggregateReviews.length,
  providerCallCount,
  passCount: aggregateReviews.filter((review) => review.verdict === "PASS").length,
  failCount: aggregateReviews.filter((review) => review.verdict === "FAIL").length,
  needsHumanReviewCount: aggregateReviews.filter((review) => review.verdict === "NEEDS_HUMAN_REVIEW").length,
  reviews: aggregateReviews,
  verdict: aggregateReviews.length === sceneFiles.length && aggregateReviews.every((review) => review.verdict === "PASS") ? "PASS" : "FAIL",
};
await writeJson(resolve(reviewRoot, "review-set.json"), aggregate);
console.log(JSON.stringify(aggregate, null, 2));
if (aggregate.verdict !== "PASS") process.exitCode = 1;
