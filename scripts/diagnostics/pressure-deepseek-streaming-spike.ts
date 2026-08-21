import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import {
  compilePressureTurnPresentationContextV1,
  validatePressureTurnPresentationCandidateV1,
  type PressureTurnPresentationInputV1,
} from "../../apps/api/src/pressure-chapter/game-projection/decision-presentation";
import {
  deepSeekNarrativeEndpoint,
} from "../../apps/api/src/pressure-chapter/production-config/narrative-provider";
import {
  buildPressureTurnPresentationSystemInstructionV1,
} from "../../apps/api/src/pressure-chapter/production-config/pressure-prompt-layers";

type JsonRecord = Record<string, unknown>;

type SpikeCase = Readonly<{
  caseId: string;
  seatId: "zhejiang_governor" | "zhejiang_administration" | "jiangnan_merchant";
  roleName: string;
  previousActionType: string;
  previousActionText: string;
  previousEffectText: string;
}>;

type SpikeResult = Readonly<{
  caseId: string;
  seatId: string;
  roleName: string;
  model: string;
  promptCharacters: number;
  providerHeadersMs: number | null;
  providerTtftMs: number | null;
  sceneFirstCharacterMs: number | null;
  firstSentenceMs: number | null;
  sceneCompleteMs: number | null;
  candidateCompleteMs: number;
  validationMs: number | null;
  protocolValid: boolean;
  existingValidatorPassed: boolean;
  actionTypeSetMatches: boolean;
  factRefsValid: boolean;
  sceneCharacters: number;
  outputCharacters: number;
  finishReason: string | null;
  error: string | null;
  sceneExcerpt: string | null;
}>;

const CASES: readonly SpikeCase[] = Object.freeze([
  {
    caseId: "fixed-governor",
    seatId: "zhejiang_governor",
    roleName: "浙江总督",
    previousActionType: "EVACUATE_WEIRS",
    previousActionText: "先发堰区疏散令。",
    previousEffectText: "先把可送达的差役与船路用于高风险村落疏散，并明确第一批接令对象。",
  },
  {
    caseId: "inaction-administration",
    seatId: "zhejiang_administration",
    roleName: "浙江省府",
    previousActionType: "DEFAULT_PASS",
    previousActionText: "先不签押，让书吏把两道命令各自放着，等天亮再说。",
    previousEffectText: "不追加疏散、守堰或证据命令；水势、旧令和其他席位行动继续推进。",
  },
  {
    caseId: "complex-merchant",
    seatId: "jiangnan_merchant",
    roleName: "江南商会",
    previousActionType: "EVACUATE_WEIRS",
    previousActionText: "我可以立刻调船撤民，但先让省府在收据上写清楚：船粮由谁接、损失由谁认；若还想把商会当作无名垫款人，我就只送已经具名的那一段航路。",
    previousEffectText: "先把可送达的差役与船路用于高风险村落疏散，并明确第一批接令对象。",
  },
]);

const MODEL = clean(process.env.PRESSURE_STREAMING_SPIKE_MODEL)
  || "deepseek-v4-flash";
const API_KEY = clean(process.env.DEEPSEEK_API_KEY);
const ENDPOINT = deepSeekNarrativeEndpoint(
  process.env.PRESSURE_NARRATIVE_BASE_URL || process.env.DEEPSEEK_BASE_URL,
);
const OUTPUT_PATH = resolve(
  process.cwd(),
  process.env.PRESSURE_STREAMING_SPIKE_OUTPUT
    || `.codex-runtime/pressure-deepseek-streaming-spike-${Date.now()}.json`,
);

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (!API_KEY) throw new Error("PRESSURE_STREAMING_SPIKE_API_KEY_MISSING");
  const results: SpikeResult[] = [];
  for (const [index, spikeCase] of CASES.entries()) {
    console.error(`\n[${index + 1}/${CASES.length}] ${spikeCase.caseId} · ${spikeCase.roleName}`);
    results.push(await runCase(spikeCase));
  }
  const evidence = Object.freeze({
    schemaVersion: "pressure_deepseek_streaming_spike_v1",
    generatedAt: new Date().toISOString(),
    branch: "codex/pressure-deepseek-streaming-spike-v1",
    baselineCommit: "6f7deb711ce19423a056082261fd8345ee4c3954",
    model: MODEL,
    endpointOrigin: new URL(ENDPOINT).origin,
    sampleSize: results.length,
    scope: "FEASIBILITY_ONLY_NOT_P95",
    actionSaveMeasured: false,
    actionSaveMeasurementNote: "Isolated Provider spike; no database mutation was authorized or performed.",
    summary: summarize(results),
    results,
  });
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.error(`\nEvidence: ${OUTPUT_PATH}`);
  console.error(JSON.stringify(evidence.summary, null, 2));
  if (results.some((result) => !result.existingValidatorPassed)) process.exitCode = 2;
}

async function runCase(spikeCase: SpikeCase): Promise<SpikeResult> {
  const input = buildInput(spikeCase);
  const context = compilePressureTurnPresentationContextV1(input);
  const systemInstruction = [
    buildPressureTurnPresentationSystemInstructionV1(),
    "这是流式协议可行性测试。仍然只返回一个JSON对象，键必须严格按sceneText、question、options、usedFactRefs、claims的顺序出现。",
    "sceneText必须是第一个字段。不要在JSON前后输出解释、Markdown或代码围栏。",
  ].join("\n");
  const userContent = JSON.stringify(context);
  const providerStartedAt = performance.now();
  let providerHeadersMs: number | null = null;
  let providerTtftMs: number | null = null;
  let sceneFirstCharacterMs: number | null = null;
  let firstSentenceMs: number | null = null;
  let sceneCompleteMs: number | null = null;
  let validationMs: number | null = null;
  let protocolValid = false;
  let existingValidatorPassed = false;
  let actionTypeSetMatches = false;
  let factRefsValid = false;
  let finishReason: string | null = null;
  let error: string | null = null;
  let rawContent = "";
  let streamedScene = "";
  let finalScene = "";
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 2_048,
        temperature: 0.55,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    providerHeadersMs = elapsed(providerStartedAt);
    if (!response.ok || !response.body) {
      const detail = (await response.text()).replace(/\s+/gu, " ").slice(0, 300);
      throw new Error(`HTTP_${response.status}:${detail}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let printedSceneLength = 0;
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
          choices?: Array<{
            delta?: { content?: unknown };
            finish_reason?: unknown;
          }>;
        };
        const choice = event.choices?.[0];
        if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (typeof delta !== "string" || delta.length === 0) continue;
        if (providerTtftMs === null) providerTtftMs = elapsed(providerStartedAt);
        rawContent += delta;
        const partial = extractJsonStringField(rawContent, "sceneText");
        streamedScene = partial.value;
        if (streamedScene && sceneFirstCharacterMs === null) {
          sceneFirstCharacterMs = elapsed(providerStartedAt);
        }
        if (firstSentenceMs === null && /[。！？!?]/u.test(streamedScene)) {
          firstSentenceMs = elapsed(providerStartedAt);
        }
        if (partial.complete && sceneCompleteMs === null) {
          sceneCompleteMs = elapsed(providerStartedAt);
        }
        if (streamedScene.length > printedSceneLength) {
          process.stdout.write(streamedScene.slice(printedSceneLength));
          printedSceneLength = streamedScene.length;
        }
      }
    }
    process.stdout.write("\n");
    const parsed = JSON.parse(rawContent);
    protocolValid = true;
    const validationStartedAt = performance.now();
    const candidate = validatePressureTurnPresentationCandidateV1(parsed, context);
    validationMs = elapsed(validationStartedAt);
    existingValidatorPassed = true;
    finalScene = candidate.sceneText;
    const actualActions = candidate.options.map((option) => option.actionType).sort();
    const expectedActions = context.legalActionContracts.map((option) => option.actionType).sort();
    actionTypeSetMatches = JSON.stringify(actualActions) === JSON.stringify(expectedActions);
    const allowedFacts = new Set(context.authorityDraft.currentAuthorityState.map((fact) => fact.factId));
    factRefsValid = candidate.usedFactRefs.every((factRef) => allowedFacts.has(factRef));
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    console.error(`FAILED: ${error}`);
  }
  const candidateCompleteMs = elapsed(providerStartedAt);
  return Object.freeze({
    caseId: spikeCase.caseId,
    seatId: spikeCase.seatId,
    roleName: spikeCase.roleName,
    model: MODEL,
    promptCharacters: [...systemInstruction, ...userContent].length,
    providerHeadersMs,
    providerTtftMs,
    sceneFirstCharacterMs,
    firstSentenceMs,
    sceneCompleteMs,
    candidateCompleteMs,
    validationMs,
    protocolValid,
    existingValidatorPassed,
    actionTypeSetMatches,
    factRefsValid,
    sceneCharacters: [...finalScene || streamedScene].length,
    outputCharacters: [...rawContent].length,
    finishReason,
    error,
    sceneExcerpt: (finalScene || streamedScene).trim().slice(0, 160) || null,
  });
}

function buildInput(spikeCase: SpikeCase): PressureTurnPresentationInputV1 {
  const configRoot = resolve(
    process.cwd(),
    "packages/templates/config/sangtian/pressure-chapter-v1",
  );
  const publicDoc = jsonFile(resolve(
    configRoot,
    "authoring/n1-authorial-public-mainline-v1.json",
  ));
  const seatDoc = jsonFile(resolve(
    configRoot,
    `authoring/n1-authorial-seat-${spikeCase.seatId}-v1.json`,
  ));
  const beatDoc = jsonFile(resolve(
    configRoot,
    "authoring/n1-multibeat-authoring-v1.json",
  ));
  const catalog = jsonFile(resolve(
    configRoot,
    "release/action-presentation-catalog.json",
  ));
  const publicScene = nestedRecord(publicDoc, ["publicMainline", "beatScenes", "B02"]);
  const seatScene = nestedRecord(seatDoc, ["seatLens", "beatScenes", "B02"]);
  const authoredBeat = ((beatDoc.beats as unknown[]) ?? []).find((value) =>
    isRecord(value) && value.beatId === "N1.B02"
  );
  if (!isRecord(authoredBeat)) throw new Error("SPIKE_N1_B02_AUTHORING_MISSING");
  const chapter = ((catalog.chapters as unknown[]) ?? []).find((value) =>
    isRecord(value) && value.chapterId === "N1"
  );
  if (!isRecord(chapter)) throw new Error("SPIKE_N1_CATALOG_MISSING");
  const decision = ((chapter.decisions as unknown[]) ?? []).find((value) =>
    isRecord(value) && value.decisionPointKey === "N1.dispatch_route"
  );
  if (!isRecord(decision)) throw new Error("SPIKE_N1_B02_DECISION_MISSING");
  const options = ((decision.actions as unknown[]) ?? [])
    .filter((value) => isRecord(value) && value.actionType !== "DEFAULT_PASS")
    .map((value) => {
      if (!isRecord(value)) throw new Error("SPIKE_N1_OPTION_INVALID");
      return {
        code: text(value.actionType, "action.actionType"),
        actionType: text(value.actionType, "action.actionType"),
        preferredEntry: text(value.preferredEntry, "action.preferredEntry") as
          "TALK" | "INVESTIGATE" | "TOKEN" | "PLAN" | "DEFER",
        label: text(value.label, "action.label"),
        description: text(value.description, "action.description"),
      };
    });
  return {
    chapter: {
      chapterRuntimeId: `streaming-spike:N1:${spikeCase.seatId}`,
      chapterId: "N1",
      chapterNumber: 1,
      title: "九堰将决",
      phase: "ACTIVE",
      workingRevision: 0,
    },
    viewer: {
      seatId: spikeCase.seatId,
      roleName: spikeCase.roleName,
      control: {
        mode: "HUMAN_ACTIVE",
        controlEpoch: 1,
        canSubmit: true,
        canReclaim: false,
        submissionFenceToken: "a".repeat(64),
        reclaimFenceToken: null,
      },
    },
    situation: {
      goal: "让第一道命令真正到达能够执行的人手与船路。",
      risk: "有印无收件、旧令拦路和船已开却无人接收正在消耗最后窗口。",
      judgment: "只能确认已有执行链，或追回未送达部分改投。",
    },
    metrics: [],
    resources: [],
    narrative: {
      status: "FALLBACK_PUBLISHED",
      projectionKind: "GENESIS_NARRATIVE",
      sourceAuthority: "GENESIS_FROZEN",
      sourceId: "streaming-spike-genesis",
      sourceCommitHash: "b".repeat(64),
      text: text(
        nestedRecord(publicDoc, ["publicMainline", "opening"]).text,
        "publicMainline.opening.text",
      ),
      contentHash: "c".repeat(64),
      renderMode: "AUTHORED_FALLBACK",
    },
    decision: {
      decisionPointId: "N1.dispatch_route",
      mode: "SOLO_BEAT",
      requirement: "REQUIRED",
      title: "第一道令已经出门，接下来如何确认送达？",
      summary: text(decision.purpose, "decision.purpose"),
      expectedWorkingRevision: 0,
      options,
      submitLabel: "确认正式行动",
      customActionAllowed: true,
    },
    previousPlayerAction: {
      decisionPointId: "N1.weir_crisis",
      actionType: spikeCase.previousActionType,
      displayText: spikeCase.previousActionText,
      effectText: spikeCase.previousEffectText,
    },
    currentBeatStory: {
      beatId: "N1.B02",
      title: text(authoredBeat.title, "beat.title"),
      storyPurpose: text(authoredBeat.storyPurpose, "beat.storyPurpose"),
      authorialMaterials: [
        material("publicMainline.beatScenes.B02", publicScene),
        material(`seatLenses.seat.${spikeCase.seatId}.beatScenes.B02`, seatScene),
      ],
    },
  };
}

function material(materialRef: string, source: JsonRecord) {
  const factRefs = Array.isArray(source.factRefs)
    ? source.factRefs.map((value) => String(value))
    : String(source.factRefs ?? "").split(/\s+/u).filter(Boolean);
  return {
    materialRef,
    title: text(source.title, `${materialRef}.title`),
    text: text(source.text, `${materialRef}.text`),
    stopCondition: typeof source.stopCondition === "string"
      ? source.stopCondition
      : null,
    requiredFactRefs: factRefs,
    supportedByAuthority: true,
  };
}

function extractJsonStringField(
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

function summarize(results: readonly SpikeResult[]) {
  const successful = results.filter((result) => result.existingValidatorPassed);
  const streamed = results.filter((result) => result.protocolValid);
  return {
    successful: successful.length,
    failed: results.length - successful.length,
    providerTtftMs: statistics(streamed.map((result) => result.providerTtftMs)),
    firstSentenceMs: statistics(streamed.map((result) => result.firstSentenceMs)),
    sceneCompleteMs: statistics(streamed.map((result) => result.sceneCompleteMs)),
    candidateCompleteMs: statistics(streamed.map((result) => result.candidateCompleteMs)),
    speedupToFirstSentence: streamed.map((result) => ({
      caseId: result.caseId,
      savedMs: result.firstSentenceMs === null
        ? null
        : Math.max(0, result.candidateCompleteMs - result.firstSentenceMs),
    })),
    allProtocolsValid: results.every((result) => result.protocolValid),
    allExistingValidatorsPassed: results.every((result) => result.existingValidatorPassed),
    allActionSetsMatch: results.every((result) => result.actionTypeSetMatches),
    allFactRefsValid: results.every((result) => result.factRefsValid),
  };
}

function statistics(values: readonly (number | null)[]) {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  const middle = Math.floor(present.length / 2);
  const median = present.length % 2 === 0
    ? (present[middle - 1]! + present[middle]!) / 2
    : present[middle]!;
  return {
    minimum: present[0],
    median,
    maximum: present[present.length - 1],
  };
}

function jsonFile(path: string): JsonRecord {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error(`SPIKE_JSON_INVALID:${path}`);
  return value;
}

function nestedRecord(source: JsonRecord, path: readonly string[]): JsonRecord {
  let value: unknown = source;
  for (const key of path) {
    if (!isRecord(value)) throw new Error(`SPIKE_PATH_INVALID:${path.join(".")}`);
    value = value[key];
  }
  if (!isRecord(value)) throw new Error(`SPIKE_PATH_INVALID:${path.join(".")}`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`SPIKE_TEXT_INVALID:${path}`);
  }
  return value.trim();
}

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}

function elapsed(startedAt: number): number {
  return Math.round(Math.max(0, performance.now() - startedAt) * 100) / 100;
}
