import { resolve } from "node:path";
import {
  computeImmutableHash,
  readJson,
  repoRoot,
  sha256Bytes,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const REVIEWER_VERSION = "sangtian-narrative-style-review-v1.0.0";
const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
const baseUrl = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").trim().replace(/\/+$/, "");
const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
const model = String(process.env.STYLE_REVIEW_MODEL || "deepseek-chat").trim();
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for independent style review");

const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const draft = await readJson(resolve(authoringRoot, "narrative/style-profile.json"));
const evidenceRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived/evidence-v2/published/sangtian-part-one-evidence-v1.0.0");
const anchorSceneIds = [
  "DM1566-C02-GOVERNOR-GRAIN-RESPONSIBILITY",
  "DM1566-C04-JOINT-REPORT-CONTEST",
  "DM1566-C06-LAND-PRICE-DEBATE",
  "DM1566-C07-MERCHANT-LEDGER-BARGAIN",
];
const anchors = [];
for (const sceneId of anchorSceneIds) {
  const scene = await readJson(resolve(evidenceRoot, "scenes", `${sceneId}.scene.json`));
  const claimSet = await readJson(resolve(evidenceRoot, "claims", `${sceneId}.claims.json`));
  anchors.push({ sceneId, title: scene.title, claims: claimSet.claims.map((claim) => ({ claimType: claim.claimType, speakerRef: claim.speakerRef, statement: claim.statement })) });
}

const systemPrompt = [
  "你是独立的中文历史小说叙事规范审核员，不负责代写正文。",
  "审核这份 NarrativeStyleProfile 是否能让《桑田诏》生成清楚、克制、有场景感的历史小说文字，同时让普通玩家看懂决定。",
  "重点检查：第三人称限知是否阻止全知泄露；人物声音是否与证据锚点相容；是否依靠现代管理术语或假古文；是否要求每回合先回应上次选择；是否会诱导模型复述系统字段；字数预算是否足以构成场景。",
  "不得要求复制原著独特句子，也不得把 evidence anchor 中的人物说法变成客观事实。",
  "只输出 JSON：{\"verdict\":\"PASS|FAIL|NEEDS_HUMAN_REVIEW\",\"issues\":[{\"issueType\":\"短标签\",\"severity\":\"BLOCKER|HIGH|MEDIUM|LOW\",\"reason\":\"不超过200汉字\"}]}。不要输出改写稿；没有问题返回 PASS 和空数组。",
].join("\n");
const userPrompt = JSON.stringify({ draftProfile: draft, approvedEvidenceAnchors: anchors }, null, 2);
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
    max_tokens: 1200,
  }),
});
const completedAt = new Date().toISOString();
const payload = await response.json().catch(() => null);
const rawText = String(payload?.choices?.[0]?.message?.content || "").trim();
const providerRecord = {
  schemaVersion: "sangtian-style-review-provider-record-v1",
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
await writeJson(resolve(authoringRoot, "reviews/narrative-style-v1/provider.json"), providerRecord);

let parsed;
try {
  if (!response.ok) throw new Error(String(payload?.error?.message || `HTTP ${response.status}`));
  parsed = JSON.parse(rawText.replace(/^```json\s*/i, "").replace(/\s*```$/, ""));
} catch (error) {
  parsed = { verdict: "FAIL", issues: [{ issueType: "REVIEWER_OUTPUT_INVALID", severity: "BLOCKER", reason: error instanceof Error ? error.message : String(error) }] };
}
const issues = Array.isArray(parsed.issues) ? parsed.issues.map((issue) => ({
  issueType: String(issue?.issueType || "UNCLASSIFIED"),
  severity: ["BLOCKER", "HIGH", "MEDIUM", "LOW"].includes(issue?.severity) ? issue.severity : "HIGH",
  reason: String(issue?.reason || "Missing reason").slice(0, 800),
})) : [{ issueType: "ISSUES_NOT_ARRAY", severity: "BLOCKER", reason: "issues must be an array" }];
const verdict = issues.some((issue) => ["BLOCKER", "HIGH"].includes(issue.severity))
  ? "FAIL"
  : issues.some((issue) => issue.severity === "MEDIUM") || parsed.verdict === "NEEDS_HUMAN_REVIEW"
    ? "NEEDS_HUMAN_REVIEW"
    : parsed.verdict === "PASS" ? "PASS" : "FAIL";
const reviewBase = {
  schemaVersion: "sangtian-narrative-style-review-v1",
  reviewerVersion: REVIEWER_VERSION,
  provider: "deepseek",
  model: providerRecord.model,
  providerRecordHash: sha256Bytes(Buffer.from(JSON.stringify(providerRecord), "utf8")),
  draftProfileHash: computeImmutableHash(draft),
  anchorSceneIds,
  verdict,
  issues,
  reviewedAt: completedAt,
};
const review = { ...reviewBase, immutableHash: computeImmutableHash(reviewBase) };
await writeJson(resolve(authoringRoot, "reviews/narrative-style-v1/review.json"), review);
if (verdict === "PASS") {
  const approved = {
    ...draft,
    version: "1.0.0",
    reviewerId: `${REVIEWER_VERSION}:${providerRecord.model}`,
    approvedAt: completedAt,
  };
  const validation = await validateWithSchema("narrative-style-profile-v1", approved);
  if (!validation.valid) throw new Error(`Approved style profile schema invalid: ${JSON.stringify(validation.errors)}`);
  await writeJson(resolve(authoringRoot, "narrative/style-profile.approved.json"), approved);
}
console.log(JSON.stringify({ review, approvedProfilePath: verdict === "PASS" ? resolve(authoringRoot, "narrative/style-profile.approved.json") : null }, null, 2));
if (verdict !== "PASS") process.exitCode = 1;
