import type { NarrativeContextV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import type { NarrativeProviderPortV1 } from "@apps/openovel-runtime/pressure-narrative/ports";
import type {
  PressureTurnPresentationContextV1,
  PressureTurnPresentationProviderPortV1,
  PressureTurnPresentationSceneObserverV1,
} from "../game-projection/decision-presentation";
import {
  compilePressureDecisionStoryPackV1,
  parsePressureStoryPackLogModeV1,
  pressureStoryPackDiagnosticLogV1,
} from "./decision-story-pack";
import {
  buildPressureTurnPresentationSystemInstructionV1,
  buildPressureStorySystemInstructionV1,
} from "./pressure-prompt-layers";
import { validateNarrativeRenderCandidateV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import type { PressureOneCallStoryProviderPortV1 } from "../story-generation";

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
  turnPresentationProvider: PressureTurnPresentationProviderPortV1 | null;
  oneCallStoryProvider: PressureOneCallStoryProviderPortV1 | null;
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
      turnPresentationProvider: null,
      oneCallStoryProvider: null,
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
  const provider = new DeepSeekPressureNarrativeProviderV1({
      apiKey,
      endpoint,
      model,
      fetchImpl,
    });
  return {
    // Normal player turns use one model call in the turn presenter. The
    // Narrative worker persists a deterministic, audience-safe authority
    // artifact and therefore receives no external Provider by default.
    provider: null,
    turnPresentationProvider: provider,
    oneCallStoryProvider: provider,
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
implements NarrativeProviderPortV1, PressureTurnPresentationProviderPortV1, PressureOneCallStoryProviderPortV1 {
  constructor(private readonly options: Readonly<{
    apiKey: string;
    endpoint: string;
    model: string;
    fetchImpl: typeof fetch;
  }>) {}

  async render(context: NarrativeContextV1): Promise<unknown> {
    const storyPack = compilePressureDecisionStoryPackV1(context);
    const storyPackLogMode = parsePressureStoryPackLogModeV1(
      process.env.PRESSURE_DECISION_STORY_PACK_LOG
        ?? process.env.PRESSURE_N1_STORY_PACK_LOG,
    );
    if (storyPack && storyPackLogMode !== "off") {
      console.info(pressureStoryPackDiagnosticLogV1(storyPack, context, storyPackLogMode));
    }
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 2_048,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: buildPressureStorySystemInstructionV1(storyPack !== null),
          },
          {
            role: "user",
            content: JSON.stringify(storyPack
              ? { storyPack, authority: providerAuthorityEnvelope(context) }
              : context),
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`NARRATIVE_PROVIDER_HTTP_${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("NARRATIVE_PROVIDER_EMPTY_RESPONSE");
    }
    let candidate: ReturnType<typeof validateNarrativeRenderCandidateV1>;
    try {
      candidate = validateNarrativeRenderCandidateV1(
        normalizeNarrativeCandidateOrderV1(JSON.parse(content)),
      );
    } catch (error) {
      const logMode = clean(process.env.PRESSURE_NARRATIVE_TRUTH_REVIEW_LOG
        ?? process.env.PRESSURE_NARRATIVE_GROUNDING_LOG).toLowerCase();
      if (logMode === "full" || logMode === "1") {
        console.info(JSON.stringify({
          event: "PRESSURE_NARRATIVE_CANDIDATE_INVALID",
          contextHash: context.contextHash,
          reason: error instanceof Error ? error.message : "UNKNOWN",
          providerContent: content,
        }));
      }
      throw new Error("NARRATIVE_PROVIDER_INVALID_OUTPUT");
    }
    return candidate;
  }

  async renderTurnPresentation(
    context: Readonly<PressureTurnPresentationContextV1>,
    onSceneText?: PressureTurnPresentationSceneObserverV1,
  ): Promise<unknown> {
    const logMode = clean(process.env.PRESSURE_DECISION_PRESENTATION_LOG).toLowerCase();
    if (logMode && logMode !== "off" && logMode !== "0") {
      console.info(JSON.stringify({
        event: "PRESSURE_TURN_PRESENTATION_CONTEXT",
        mode: logMode === "full" || logMode === "1" ? "full" : "summary",
        contextHash: context.contextHash,
        chapterId: context.chapter.chapterId,
        decisionPointId: context.decisionPointId,
        viewerSeatId: context.viewer.seatId,
        legalActionTypes: context.legalActionContracts.map((action) => action.actionType),
        sources: {
          previousNarrative: `${context.previousNarrative.projectionKind}:${context.previousNarrative.sourceId}`,
          authorityDraft: context.authorityDraft.authorityHash,
          currentPressure: "PRESSURE_SCENE_FLOW",
          currentState: "VIEWER_SAFE_GAME_PROJECTION",
          legalActions: "ACTION_PRESENTATION_CATALOG",
        },
        ...(logMode === "full" || logMode === "1" ? { context } : {}),
      }));
    }
    const streaming = typeof onSceneText === "function";
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 2_048,
        temperature: 0.55,
        ...(streaming ? {
          stream: true,
          stream_options: { include_usage: true },
        } : {}),
        messages: [
          {
            role: "system",
            content: streaming
              ? [
                  buildPressureTurnPresentationSystemInstructionV1(),
                  "sceneText必须是返回JSON的第一个字段；其后依次返回question、options、usedFactRefs、claims。JSON前后不得有其他文字。",
                ].join("\n")
              : buildPressureTurnPresentationSystemInstructionV1(),
          },
          {
            role: "user",
            content: JSON.stringify(context),
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`DECISION_PRESENTATION_PROVIDER_HTTP_${response.status}`);
    }
    const content = streaming
      ? await readStreamingTurnPresentationV1(response, onSceneText!)
      : await readBufferedTurnPresentationV1(response);
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("DECISION_PRESENTATION_PROVIDER_EMPTY_RESPONSE");
    }
    try {
      const parsed = JSON.parse(content);
      if (logMode && logMode !== "off" && logMode !== "0") {
        console.info(JSON.stringify({
          event: "PRESSURE_TURN_PRESENTATION_RESULT",
          contextHash: context.contextHash,
          result: parsed,
        }));
      }
      return parsed;
    } catch {
      throw new Error("DECISION_PRESENTATION_PROVIDER_INVALID_JSON");
    }
  }
  async renderOneCallStory(context: Readonly<Record<string, unknown>>): Promise<unknown> {
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: context.mode === "CHAPTER_SUMMARY" ? 3_072 : 2_048,
        temperature: 0.5,
        messages: [
          {
            role: "system",
            content: context.mode === "CHAPTER_SUMMARY"
              ? buildPressureChapterSummarySystemInstructionV1()
              : "一次输出连续文学剧情、具体问题与全部合法选项表达。不得新增行动、事实、效果或结果。只返回JSON。",
          },
          { role: "user", content: JSON.stringify(context) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`PRESSURE_ONE_CALL_PROVIDER_HTTP_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("PRESSURE_ONE_CALL_PROVIDER_EMPTY_RESPONSE");
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("PRESSURE_ONE_CALL_PROVIDER_INVALID_JSON");
    }
  }

}

async function readBufferedTurnPresentationV1(response: Response): Promise<unknown> {
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  return payload.choices?.[0]?.message?.content;
}

async function readStreamingTurnPresentationV1(
  response: Response,
  onSceneText: PressureTurnPresentationSceneObserverV1,
): Promise<string> {
  if (!response.body) throw new Error("DECISION_PRESENTATION_PROVIDER_STREAM_MISSING");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let content = "";
  let publishedLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split(/\r?\n/u);
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta !== "string" || !delta) continue;
      content += delta;
      const scene = extractStreamingJsonStringFieldV1(content, "sceneText").value;
      if (scene.length <= publishedLength) continue;
      publishedLength = scene.length;
      try {
        onSceneText(scene);
      } catch {
        // A disconnected viewer cannot fail the Provider request.
      }
    }
  }
  return content;
}

function extractStreamingJsonStringFieldV1(
  raw: string,
  field: string,
): { value: string; complete: boolean } {
  const marker = `"${field}"`;
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) return { value: "", complete: false };
  const colonIndex = raw.indexOf(":", markerIndex + marker.length);
  if (colonIndex < 0) return { value: "", complete: false };
  let cursor = colonIndex + 1;
  while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
  if (raw[cursor] !== '"') return { value: "", complete: false };
  cursor += 1;
  let value = "";
  while (cursor < raw.length) {
    const character = raw[cursor]!;
    if (character === '"') return { value, complete: true };
    if (character !== "\\") {
      value += character;
      cursor += 1;
      continue;
    }
    if (cursor + 1 >= raw.length) break;
    const escape = raw[cursor + 1]!;
    const escapes: Record<string, string> = {
      '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f",
      n: "\n", r: "\r", t: "\t",
    };
    if (escape === "u") {
      const hex = raw.slice(cursor + 2, cursor + 6);
      if (!/^[0-9a-f]{4}$/iu.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      cursor += 6;
      continue;
    }
    if (!(escape in escapes)) break;
    value += escapes[escape];
    cursor += 2;
  }
  return { value, complete: false };
}

export function buildPressureChapterSummarySystemInstructionV1(): string {
  return [
    "你是历史小说的章末叙事者，同时负责把同一批权威事实整理成玩家可读的结构化总结。只返回一个JSON对象，不得使用Markdown。",
    "closingNarrative必须是300至900个汉字、3至6个自然段的小说式收束。要有人物动作、现场感、对话或无声反应，并让本章真实结果自然落地；最后用尚未解决的压力引出下一章。不要写成系统报告、工作清单或规则说明。",
    "可以补充不改变结算的天气、声音、表情、走动和陈设等文学细节；不得新增人物决定、灾情结果、胜负、数值、证据、因果或已完成事项。",
    "必须完整返回这些字段且不得增加字段：closingNarrative、playerActions、actualResults、completedObjectives、incompleteObjectives、metricChanges、remainingPressures、nextChapterHook。即使某个数组为空也必须返回空数组。",
    "playerActions、actualResults、completedObjectives、incompleteObjectives、remainingPressures中的引用字段必须逐项原样复制输入中的引用，数量和集合完全一致，只改写text为自然中文。",
    "metricChanges中的metricRef、label、before、delta、after、displayBefore、displayDelta、displayAfter必须逐项原样复制；不得改动、补算、合并、遗漏或增加字段。",
    "玩家可见文字不得出现actionType、factId、metricId、哈希、fence、Provider、Prompt、Reviewer或形如全大写下划线连接的内部代码。",
  ].join("\n");
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

function providerAuthorityEnvelope(context: NarrativeContextV1) {
  return Object.freeze({
    projectionKind: context.projectionKind,
    sourceId: context.sourceId,
    sourceCommitHash: context.sourceCommitHash,
    sourceContentHash: context.sourceContentHash,
    contextHash: context.contextHash,
    audience: context.audience,
    temporalInstruction: context.temporalInstruction,
    facts: context.facts,
    objects: context.objects,
    knowledge: context.knowledge,
    allowedClaims: context.allowedClaims,
    variant: context.variant,
  });
}

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}

/** Canonicalizes order-only Provider variance; schema and semantic validation remain strict. */
function normalizeNarrativeCandidateOrderV1(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  return {
    ...candidate,
    ...(Array.isArray(candidate.usedFactRefs)
      ? { usedFactRefs: [...candidate.usedFactRefs].sort((left, right) => String(left).localeCompare(String(right))) }
      : {}),
    ...(Array.isArray(candidate.claims)
      ? {
          claims: [...candidate.claims].sort((left, right) => {
            const leftClaim = left && typeof left === "object" ? left as Record<string, unknown> : {};
            const rightClaim = right && typeof right === "object" ? right as Record<string, unknown> : {};
            return `${String(leftClaim.kind)}\u0000${String(leftClaim.refId)}`
              .localeCompare(`${String(rightClaim.kind)}\u0000${String(rightClaim.refId)}`);
          }),
        }
      : {}),
  };
}
