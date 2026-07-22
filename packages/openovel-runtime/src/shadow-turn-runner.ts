import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prettyJson, sha256Canonical } from "./canonical";
import { writeContextComparison } from "./comparison";
import { openovelPaths } from "./paths";
import { normalizeAndValidateShadowOutput } from "./shadow-output-normalizer";
import { buildShadowTurnPrompt } from "./shadow-prompt";
import { buildShadowQualityRubric } from "./shadow-quality-rubric";
import type { ShadowRuntimeFixture } from "./types";

export async function runOneShadowTurn(repoRoot?: string, fixtureOverride?: ShadowRuntimeFixture) {
  const paths = openovelPaths(repoRoot);
  const comparison = writeContextComparison(paths.repoRoot, fixtureOverride);
  const prompt = buildShadowTurnPrompt(comparison.shadow, comparison.fixture);
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for a real shadow turn.");
  const baseUrl = normalizeBaseUrl(String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"));
  const model = String(process.env.OPENOVEL_SHADOW_MODEL || "deepseek-chat").trim();
  const temperature = boundedNumber(process.env.OPENOVEL_SHADOW_TEMPERATURE, 0.55, 0, 1);
  const timeoutMs = boundedInteger(process.env.OPENOVEL_SHADOW_TIMEOUT_MS, 60_000, 5_000, 120_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let providerCallCount = 0;
  let responseStatus = 0;
  let providerRequestId: string | null = null;
  let rawText = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  let providerError: string | null = null;
  try {
    providerCallCount += 1;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.userPrompt }
        ],
        response_format: { type: "json_object" },
        stream: false,
        temperature,
        max_tokens: 2600
      }),
      signal: controller.signal
    });
    responseStatus = response.status;
    providerRequestId = response.headers.get("x-request-id") || response.headers.get("x-deepseek-request-id");
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) throw new Error(String(payload?.error?.message || payload?.message || `DeepSeek HTTP ${response.status}`));
    rawText = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!rawText) throw new Error("DeepSeek returned an empty response.");
    usage = {
      inputTokens: Number(payload?.usage?.prompt_tokens || 0),
      outputTokens: Number(payload?.usage?.completion_tokens || 0)
    };
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timeout);
  }

  const normalized = providerError
    ? {
        validation: { ok: false as const, output: null, issues: [{ severity: "error" as const, code: "PROVIDER_ERROR", message: providerError }] },
        normalizedText: rawText,
        normalization: null
      }
    : normalizeAndValidateShadowOutput(rawText, comparison.shadow, comparison.fixture);
  const validation = normalized.validation;
  const qualityRubric = buildShadowQualityRubric(validation, comparison.fixture);
  const generatedAt = new Date().toISOString();
  const retryOfArtifactId = String(process.env.OPENOVEL_SHADOW_RETRY_OF || "").trim() || null;
  const artifact = {
    schemaVersion: "openovel_shadow_turn_artifact_v1",
    artifactId: `shadow-turn-${generatedAt.replace(/[:.]/g, "-")}`,
    generatedAt,
    branch: "codex/openovel-runtime-architecture",
    environment: "independent-worktree-shadow",
    fixtureId: comparison.fixture.fixtureId,
    fixtureSnapshot: comparison.fixture,
    fixtureSnapshotHash: sha256Canonical(comparison.fixture),
    retryOfArtifactId,
    immutablePlayerIntentHash: comparison.fixture.playerIntent.immutableIntentHash,
    contextPacketId: comparison.shadow.contextPacketId,
    contextSnapshotHash: comparison.shadow.snapshotHash,
    causalArcSnapshotHash: comparison.shadow.causalTurn.snapshotHash,
    affordanceSnapshotHash: comparison.shadow.causalTurn.affordanceSnapshotHash,
    allowedEventEnvelopeHash: comparison.shadow.causalTurn.allowedEventEnvelopeHash,
    promptHash: sha256Canonical(prompt),
    writerPromptHash: sha256Canonical({ systemPrompt: prompt.systemPrompt, userPrompt: prompt.userPrompt, outputSchema: prompt.outputSchema }),
    validationPolicyHash: sha256Canonical({
      actionBoundary: comparison.fixture.actionBoundary,
      stateLocks: comparison.fixture.stateLocks,
      stateLockAssertions: comparison.fixture.stateLockAssertions,
      currentStateExclusions: comparison.fixture.currentStateExclusions,
      narrativeBoundary: comparison.fixture.narrativeBoundary,
      requiredNarrativePatterns: comparison.fixture.narrativeFrame.requiredNarrativePatterns
    }),
    serverGroundingHash: comparison.shadow.serverGrounding.sourceMapHash,
    provider: {
      name: "deepseek",
      model,
      temperature,
      providerCallCount,
      responseStatus,
      providerRequestId,
      usage,
      error: providerError
    },
    validation,
    qualityRubric,
    prompt,
    rawText,
    normalizedText: normalized.normalizedText,
    normalization: normalized.normalization,
    gates: {
      shadowOnly: true,
      playerTrafficAffected: false,
      databaseTouched: false,
      soloTakeoverEligible: false,
      multiplayerEligible: false,
      stageStatus: qualityRubric.overallPassed
        ? "AWAITING_USER_STORY_CONFIRMATION"
        : validation.ok
          ? "REJECTED_QUALITY_GATE"
          : "REJECTED_HARD_CONTRACT"
    }
  };
  mkdirSync(paths.outputRoot, { recursive: true });
  const artifactPath = join(paths.outputRoot, `${artifact.artifactId}.json`);
  const latestPath = join(paths.outputRoot, "shadow-turn-latest.json");
  writeFileSync(artifactPath, prettyJson(artifact), "utf8");
  writeFileSync(latestPath, prettyJson(artifact), "utf8");
  return { artifact, artifactPath, latestPath };
}

function normalizeBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) throw new Error("DEEPSEEK_BASE_URL must be an absolute HTTP(S) URL.");
  return value.endsWith("/v1") ? value : `${value}/v1`;
}

function boundedInteger(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function boundedNumber(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}
