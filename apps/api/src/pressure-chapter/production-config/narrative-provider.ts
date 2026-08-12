import type { NarrativeContextV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import type { NarrativeProviderPortV1 } from "@apps/openovel-runtime/pressure-narrative/ports";

export type PressureNarrativeProviderModeV1 =
  | "EXTERNAL_PROVIDER"
  | "DETERMINISTIC_FALLBACK_ONLY";

export interface PressureNarrativeProviderReadinessV1 {
  ready: true;
  mode: PressureNarrativeProviderModeV1;
  externalProviderConfigured: boolean;
  degraded: boolean;
  provider: "deepseek" | "deterministic-fallback";
  model: string | null;
}

export interface PressureNarrativeProviderConfigurationV1 {
  provider: NarrativeProviderPortV1 | null;
  readiness: PressureNarrativeProviderReadinessV1;
}

/** Narrative-only Provider construction. Decision automation never receives it. */
export function createPressureNarrativeProviderFromEnvV1(
  environment: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): PressureNarrativeProviderConfigurationV1 {
  const apiKey = clean(environment.DEEPSEEK_API_KEY);
  const requested = clean(environment.PRESSURE_NARRATIVE_PROVIDER).toLowerCase();
  if (requested && requested !== "deepseek" && requested !== "deterministic") {
    throw new Error("PRESSURE_NARRATIVE_PROVIDER_INVALID");
  }
  if (requested === "deterministic" || !apiKey) {
    return {
      provider: null,
      readiness: {
        ready: true,
        mode: "DETERMINISTIC_FALLBACK_ONLY",
        externalProviderConfigured: false,
        degraded: true,
        provider: "deterministic-fallback",
        model: null,
      },
    };
  }
  const model = clean(environment.PRESSURE_NARRATIVE_MODEL)
    || clean(environment.DEEPSEEK_MODEL)
    || "deepseek-chat";
  const endpoint = deepSeekNarrativeEndpoint(
    environment.PRESSURE_NARRATIVE_BASE_URL || environment.DEEPSEEK_BASE_URL,
  );
  return {
    provider: new DeepSeekPressureNarrativeProviderV1({
      apiKey,
      endpoint,
      model,
      fetchImpl,
    }),
    readiness: {
      ready: true,
      mode: "EXTERNAL_PROVIDER",
      externalProviderConfigured: true,
      degraded: false,
      provider: "deepseek",
      model,
    },
  };
}

export class DeepSeekPressureNarrativeProviderV1
implements NarrativeProviderPortV1 {
  constructor(private readonly options: Readonly<{
    apiKey: string;
    endpoint: string;
    model: string;
    fetchImpl: typeof fetch;
  }>) {}

  async render(context: NarrativeContextV1): Promise<unknown> {
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        response_format: { type: "json_object" },
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: providerSystemInstruction(),
          },
          {
            role: "user",
            content: JSON.stringify(context),
          },
        ],
      }),
      signal: AbortSignal.timeout(28_000),
    });
    if (!response.ok) throw new Error(`NARRATIVE_PROVIDER_HTTP_${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("NARRATIVE_PROVIDER_EMPTY_RESPONSE");
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("NARRATIVE_PROVIDER_INVALID_JSON");
    }
  }
}

export function deepSeekNarrativeEndpoint(value?: string): string {
  const raw = clean(value) || "https://api.deepseek.com";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PRESSURE_NARRATIVE_BASE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("PRESSURE_NARRATIVE_BASE_URL_UNSAFE");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/v1") url.pathname = `${path}/chat/completions`;
  else if (!path.endsWith("/chat/completions")) url.pathname = `${path}/chat/completions`;
  return url.toString();
}

function providerSystemInstruction(): string {
  return [
    "You render narrative from the supplied audience-safe Pressure context only.",
    "Return one JSON object with exactly text, usedFactRefs, and claims.",
    "usedFactRefs must contain only supplied factId values actually used.",
    "Each claim must contain kind, refId, statement and must match an allowedClaims entry.",
    "Do not invent facts, outcomes, objects, knowledge, private information, or future events.",
    "Do not include markdown fences or any text outside the JSON object.",
  ].join(" ");
}

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}
