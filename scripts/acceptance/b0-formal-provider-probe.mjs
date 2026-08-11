import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const evidenceRoot = resolve(required("B0_EVIDENCE_ROOT"));
const githubEnv = required("GITHUB_ENV");
const apiKey = required("B0_FORMAL_PROVIDER_API_KEY");
const providerSecretName = required("B0_PROVIDER_SECRET_NAME");
const acceptanceEnvironment = required("B0_ACCEPTANCE_ENVIRONMENT");
const baseUrl = "https://api.deepseek.com";
const model = String(process.env.B0_FORMAL_PROVIDER_MODEL || "deepseek-chat").trim();

if (!/(?:test|testing|staging|stage|preview)/i.test(acceptanceEnvironment)) {
  throw new Error("Formal provider probe requires an explicitly non-production acceptance environment");
}

process.stdout.write(`::add-mask::${apiKey}\n`);
const response = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    messages: [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: "Return one JSON object with a boolean field named ok set to true." },
    ],
    temperature: 0,
    max_tokens: 64,
    stream: false,
    response_format: { type: "json_object" },
  }),
  signal: AbortSignal.timeout(180_000),
});

const payload = await response.json().catch(() => null);
if (!response.ok) {
  const message = String(payload?.error?.message || payload?.message || `Provider HTTP ${response.status}`).slice(0, 300);
  throw new Error(`DeepSeek provider probe failed: ${message}`);
}
const text = String(payload?.choices?.[0]?.message?.content || "").trim();
if (!text) throw new Error("DeepSeek provider probe returned empty content");
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  throw new Error("DeepSeek provider probe did not return strict JSON");
}
if (parsed?.ok !== true) throw new Error("DeepSeek provider probe JSON did not confirm ok=true");

const responseModel = String(payload?.model || model);
const requestId = response.headers.get("x-request-id") || response.headers.get("x-deepseek-request-id") || String(payload?.id || "");
const identityDigest = `sha256:${sha256(`${new URL(baseUrl).hostname}|${model}|${responseModel}`)}`;
const evidence = {
  schemaVersion: 1,
  status: "READY",
  provenance: "deepseek-api-real",
  acceptanceEnvironment,
  providerSecretName,
  transport: "HTTPS_OPENAI_COMPATIBLE",
  endpointHostSha256: sha256(new URL(baseUrl).hostname),
  endpointPath: "/chat/completions",
  requestedModel: model,
  responseModel,
  modelIdentityDigest: identityDigest,
  modelIdentityDigestKind: "endpoint-requested-model-response-model-binding",
  requestIdPresent: Boolean(requestId),
  requestIdSha256: requestId ? sha256(requestId) : null,
  httpStatus: response.status,
  finishReason: payload?.choices?.[0]?.finish_reason || null,
  usage: {
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  },
  contentSha256: sha256(text),
  contentLength: text.length,
  deterministicProvider: false,
  fallbackAllowed: false,
};

await mkdir(evidenceRoot, { recursive: true });
await writeJson(resolve(evidenceRoot, "provider-provenance.json"), evidence);
await appendFile(githubEnv, [
  `OPENOVEL_PROVIDER_BASE_URL=${baseUrl}`,
  `OPENOVEL_API_KEY=${apiKey}`,
  `OPENOVEL_MODEL=${model}`,
  "B0_PROVIDER_PROVENANCE=deepseek-api-real",
  `B0_PROVIDER_MODEL_DIGEST=${identityDigest}`,
  "B0_FORMAL_PROVIDER_API_KEY=",
].join("\n") + "\n", "utf8");
process.stdout.write("B0_FORMAL_DEEPSEEK_PROVIDER_PROBE_OK\n");

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
