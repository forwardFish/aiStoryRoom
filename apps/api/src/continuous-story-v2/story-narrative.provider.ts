import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { DecisionCandidateV2 } from "@ai-story/shared";
import { PrismaService } from "../prisma.service";
import { operationalMetrics } from "../observability/operational-metrics";
import { sha256Canonical } from "../continuous-strategy/canonical";
import { validateStoryContextFreshnessV2, type StoryContextIdentityV2, type StoryContextSnapshotV2 } from "./story-context";
import { readCreditConsumptionConfig } from "../config/credit-consumption.config";
import {
  StoryGenerationErrorV2,
  StoryGenerationPipelineV2,
  type GenerateStoryPipelineInputV2,
  type GenerateStoryPipelineResultV2,
  type PromptExecutionRecordV2,
  type StoryModelClientV2,
  type StoryModelRequestV2,
  type StoryModelResponseV2
} from "./story-generation.pipeline";

type AgentDecisionInputV2 = {
  context: StoryContextSnapshotV2;
  contextRecordId: string;
  finalStory: string;
  candidates: DecisionCandidateV2[];
  getCurrentIdentity?: () => StoryContextIdentityV2 | Promise<StoryContextIdentityV2>;
};

type AgentDecisionResultV2 = { candidateId: string; rationale: string };

type PendingAgentDecisionV2 = {
  input: AgentDecisionInputV2;
  resolve: (result: AgentDecisionResultV2) => void;
  reject: (error: unknown) => void;
};

type PendingAgentBatchV2 = {
  items: PendingAgentDecisionV2[];
  timer: ReturnType<typeof setTimeout>;
  flushing: boolean;
};

/**
 * Production model adapter for the isolated story pipeline.
 *
 * There is intentionally no deterministic prose fallback here. Rules and
 * confirmed effects are inputs to generation, never player-visible substitute
 * stories. A provider or quality failure is persisted and returned as a
 * recoverable generation failure by the service.
 */
@Injectable()
export class StoryNarrativeProvider implements StoryModelClientV2 {
  private readonly pendingAgentBatches = new Map<string, PendingAgentBatchV2>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveContext(
    input: GenerateStoryPipelineInputV2 & { contextRecordId: string }
  ): Promise<GenerateStoryPipelineResultV2> {
    const pipeline = new StoryGenerationPipelineV2(this);
    try {
      const result = await pipeline.generate(input);
      await this.persistPromptExecutions(input.contextRecordId, result.promptExecutions);
      return result;
    } catch (error) {
      if (error instanceof StoryGenerationErrorV2) {
        await this.persistPromptExecutions(input.contextRecordId, error.promptExecutions);
      }
      throw error;
    }
  }

  async decideAgent(input: AgentDecisionInputV2): Promise<AgentDecisionResultV2> {
    if (input.candidates.length < 2) throw new Error("AGENT_DECISION_CANDIDATES_REQUIRED");
    if (readCreditConsumptionConfig().aiBatchingEnabled) return this.enqueueAgentDecisionBatch(input);
    const systemPrompt = `<role>
你正在扮演故事中的一个真实角色。你只替这个 Agent 角色选择下一项行动，不写剧情、不生成新选项。
</role>

像一个处在当前压力中的人一样判断：先守住角色目标和底线，再比较每项行动能否执行、要付出的代价、
掌握的信息是否足够、对方可能如何反制。你只能从给定候选项中选择一个 candidateId，不得创造第五个方案，
不得使用本角色不知道的信息，不得替其他角色作决定。rationale 是后台内部思考摘要，不会展示给玩家。

只输出 JSON：{"candidateId":"候选项原始 id","rationale":"用 30 至 180 个中文字符说明为何此刻选择它"}。`;
    const userPrompt = [
      `<context_snapshot hash="${input.context.identity.snapshotHash}">`,
      input.context.renderedWorkingSet,
      "</context_snapshot>",
      "# 已通过审核、此刻真实可执行的候选行动",
      JSON.stringify(input.candidates.map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        description: candidate.description,
        objective: candidate.intentDraft.objective,
        target: candidate.intentDraft.target,
        method: candidate.intentDraft.method,
        visibility: candidate.visibility,
        risk: candidate.risk,
        concreteCost: candidate.concreteCost,
        expectedCountermove: candidate.expectedCountermove
      }))),
      "# 当前最终剧情（必须读到最后一个字再判断）",
      input.finalStory
    ].join("\n\n");
    const records: PromptExecutionRecordV2[] = [];
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      const startedAt = new Date(started).toISOString();
      let response: StoryModelResponseV2 | null = null;
      try {
        response = await this.generate({ step: "AGENT_DECIDER", systemPrompt, userPrompt, responseFormat: "json_object", temperature: 0.35 });
        const parsed = parseAgentDecision(response.content);
        if (!input.candidates.some((candidate) => candidate.id === parsed.candidateId)) throw new Error("AGENT_SELECTED_UNKNOWN_CANDIDATE");
        if (parsed.rationale.length < 20 || parsed.rationale.length > 240) throw new Error("AGENT_RATIONALE_LENGTH_INVALID");
        records.push(agentExecutionRecord({ input, attempt, systemPrompt, userPrompt, response, started, startedAt, status: "SUCCESS", issueCodes: [] }));
        if (input.getCurrentIdentity) {
          const freshness = validateStoryContextFreshnessV2(input.context, await input.getCurrentIdentity());
          if (freshness.status !== "CURRENT") {
            const last = records.at(-1)!;
            last.status = "SUPERSEDED";
            last.supersededReason = freshness.reasons.join(",");
            last.issueCodes = ["CONTEXT_SUPERSEDED", ...freshness.reasons];
            await this.persistPromptExecutions(input.contextRecordId, records);
            throw new StoryGenerationErrorV2("CONTEXT_SUPERSEDED", "Agent decision context changed before commit", records, freshness.reasons);
          }
        }
        await this.persistPromptExecutions(input.contextRecordId, records);
        return parsed;
      } catch (error) {
        if (error instanceof StoryGenerationErrorV2) throw error;
        lastError = error;
        records.push(agentExecutionRecord({
          input,
          attempt,
          systemPrompt,
          userPrompt,
          response,
          started,
          startedAt,
          status: "FAILED",
          issueCodes: [response ? "INVALID_MODEL_OUTPUT" : "MODEL_CALL_FAILED"]
        }));
      }
    }
    await this.persistPromptExecutions(input.contextRecordId, records);
    const code = records.at(-1)?.issueCodes[0] === "INVALID_MODEL_OUTPUT" ? "INVALID_MODEL_OUTPUT" : "MODEL_CALL_FAILED";
    throw new StoryGenerationErrorV2(code, lastError instanceof Error ? lastError.message : String(lastError), records, [code]);
  }

  private enqueueAgentDecisionBatch(input: AgentDecisionInputV2): Promise<AgentDecisionResultV2> {
    const config = readCreditConsumptionConfig();
    const batchKey = input.context.identity.runId;
    return new Promise<AgentDecisionResultV2>((resolve, reject) => {
      let batch = this.pendingAgentBatches.get(batchKey);
      if (!batch) {
        batch = {
          items: [],
          flushing: false,
          timer: setTimeout(() => void this.flushAgentDecisionBatch(batchKey), config.aiBatchMaxWaitMs)
        };
        batch.timer.unref?.();
        this.pendingAgentBatches.set(batchKey, batch);
      }
      batch.items.push({ input, resolve, reject });
      if (batch.items.length >= config.aiBatchMaxSize) void this.flushAgentDecisionBatch(batchKey);
    });
  }

  private async flushAgentDecisionBatch(batchKey: string) {
    const batch = this.pendingAgentBatches.get(batchKey);
    if (!batch || batch.flushing) return;
    batch.flushing = true;
    clearTimeout(batch.timer);
    this.pendingAgentBatches.delete(batchKey);
    const started = Date.now();
    operationalMetrics.set("ai_batch_size", { engine: "continuous_story_v2" }, batch.items.length);
    const startedAt = new Date(started).toISOString();
    const systemPrompt = "Independently choose one legal candidate for each bounded story role. Never transfer private knowledge between roles. Return JSON {decisions:[{turnId,controlEpoch,candidateId,rationale}]}.";
    const userPrompt = JSON.stringify({
      batchSchemaVersion: "room_ai_batch_v2",
      turns: batch.items.map(({ input }) => ({
        turnId: input.context.identity.actorTurnId,
        controlEpoch: input.context.identity.controlEpoch,
        contextSnapshotHash: input.context.identity.snapshotHash,
        roleContext: input.context.renderedWorkingSet,
        finalStory: input.finalStory,
        candidates: input.candidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          description: candidate.description,
          objective: candidate.intentDraft.objective,
          target: candidate.intentDraft.target,
          method: candidate.intentDraft.method,
          visibility: candidate.visibility,
          risk: candidate.risk,
          concreteCost: candidate.concreteCost,
          expectedCountermove: candidate.expectedCountermove
        }))
      }))
    });
    let response: StoryModelResponseV2 | null = null;
    let parsed: Array<{ turnId: string; controlEpoch: number; candidateId: string; rationale: string }> = [];
    let providerError: unknown = null;
    try {
      response = await this.generate({ step: "AGENT_DECIDER", systemPrompt, userPrompt, responseFormat: "json_object", temperature: 0.35 });
      parsed = parseAgentDecisionBatch(response.content);
    } catch (error) {
      providerError = error;
    }

    await Promise.all(batch.items.map(async (item) => {
      const input = item.input;
      const exact = parsed.find((entry) => entry.turnId === input.context.identity.actorTurnId
        && entry.controlEpoch === input.context.identity.controlEpoch);
      const valid = exact && input.candidates.some((candidate) => candidate.id === exact.candidateId)
        && exact.rationale.length >= 20 && exact.rationale.length <= 240;
      const result: AgentDecisionResultV2 = valid
        ? { candidateId: exact!.candidateId, rationale: exact!.rationale }
        : {
            candidateId: input.candidates[0]!.id,
            rationale: "The batch provider did not return a valid isolated choice, so the first reviewed legal action was selected deterministically."
          };
      const individualResponse: StoryModelResponseV2 | null = response ? {
        ...response,
        content: JSON.stringify(result),
        tokenUsage: response.tokenUsage ? {
          promptTokens: divideUsage(response.tokenUsage.promptTokens, batch.items.length),
          completionTokens: divideUsage(response.tokenUsage.completionTokens, batch.items.length),
          totalTokens: divideUsage(response.tokenUsage.totalTokens, batch.items.length)
        } : undefined
      } : null;
      const record = agentExecutionRecord({
        input,
        attempt: 1,
        systemPrompt,
        userPrompt: JSON.stringify({ batchSize: batch.items.length, turnId: input.context.identity.actorTurnId }),
        response: individualResponse,
        started,
        startedAt,
        status: "SUCCESS",
        issueCodes: valid ? [] : [providerError ? "BATCH_MODEL_CALL_FAILED_FALLBACK" : "BATCH_INVALID_ROLE_OUTPUT_FALLBACK"]
      });
      try {
        if (input.getCurrentIdentity) {
          const freshness = validateStoryContextFreshnessV2(input.context, await input.getCurrentIdentity());
          if (freshness.status !== "CURRENT") {
            record.status = "SUPERSEDED";
            record.supersededReason = freshness.reasons.join(",");
            record.issueCodes = ["CONTEXT_SUPERSEDED", ...freshness.reasons];
            await this.persistPromptExecutions(input.contextRecordId, [record]);
            item.reject(new StoryGenerationErrorV2("CONTEXT_SUPERSEDED", "Agent decision context changed before commit", [record], freshness.reasons));
            return;
          }
        }
        await this.persistPromptExecutions(input.contextRecordId, [record]);
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }));
  }

  async generate(request: StoryModelRequestV2): Promise<StoryModelResponseV2> {
    const configured = String(process.env.STORY_NARRATIVE_PROVIDER || "deepseek").trim().toLowerCase();
    if (["rules", "mock", "none", "disabled"].includes(configured)) throw new Error("STORY_MODEL_PROVIDER_DISABLED");
    if (configured !== "deepseek") throw new Error(`STORY_MODEL_PROVIDER_UNSUPPORTED:${configured}`);
    const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY_REQUIRED");
    const baseUrl = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
    const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
    const modelName = modelForStoryStep(request.step);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(normalizeTimeout(process.env.STORY_NARRATIVE_TIMEOUT_MS)),
        body: JSON.stringify({
          model: modelName,
          response_format: { type: request.responseFormat },
          thinking: { type: "disabled" },
          temperature: request.temperature,
          max_tokens: maxTokensForStoryStep(request.step),
          stream: false,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt }
          ]
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`STORY_PROVIDER_HTTP_${response.status}`);
      const content = String((body as any).choices?.[0]?.message?.content || "");
      if (!content.trim()) throw new Error("STORY_PROVIDER_EMPTY_RESPONSE");
      const usage = (body as any).usage || {};
      const promptTokens = finiteNumber(usage.prompt_tokens);
      const completionTokens = finiteNumber(usage.completion_tokens);
      operationalMetrics.providerAttempt({
        engine: "continuous_story_v2",
        batchType: request.step,
        result: "success",
        inputTokens: promptTokens,
        outputTokens: completionTokens
      });
      return {
        content,
        provider: "deepseek",
        modelName,
        tokenUsage: {
          promptTokens,
          completionTokens,
          totalTokens: finiteNumber(usage.total_tokens)
        }
      };
    } catch (error) {
      operationalMetrics.providerAttempt({ engine: "continuous_story_v2", batchType: request.step, result: "failure" });
      throw error;
    }
  }

  private async persistPromptExecutions(contextSnapshotId: string, records: PromptExecutionRecordV2[]) {
    if (!records.length) return;
    await this.prisma.promptExecutionRecord.createMany({
      skipDuplicates: true,
      data: records.map((record) => ({
        id: record.executionId,
        runId: record.runId,
        roleId: record.roleId,
        actorTurnId: record.actorTurnId,
        actionResolutionId: record.actionResolutionId,
        contextSnapshotId,
        pipelineStep: record.pipelineStep,
        promptVersion: record.promptVersion,
        schemaVersion: record.schemaVersion,
        provider: record.provider,
        modelName: record.modelName,
        systemPromptHash: record.systemPromptHash,
        contextSnapshotHash: record.contextSnapshotHash,
        inputHash: record.inputHash,
        outputHash: record.outputHash,
        attempt: record.attempt,
        inputJson: {
          metadata: record.inputMetadata,
          systemPrompt: record.internalAudit.systemPrompt,
          userPrompt: record.internalAudit.userPrompt
        } as Prisma.InputJsonValue,
        outputJson: record.internalAudit.rawOutput === null ? Prisma.DbNull : { rawOutput: record.internalAudit.rawOutput } as Prisma.InputJsonValue,
        issueCodesJson: record.issueCodes as Prisma.InputJsonValue,
        tokenUsageJson: record.tokenUsage ? record.tokenUsage as Prisma.InputJsonValue : Prisma.DbNull,
        status: record.status,
        supersededReason: record.supersededReason,
        startedAt: new Date(record.startedAt),
        finishedAt: new Date(record.finishedAt),
        latencyMs: record.latencyMs
      }))
    });
  }
}

function modelForStoryStep(step: StoryModelRequestV2["step"]): string {
  // Interactive Solo uses the fast chat model by default. A slower premium
  // writer remains opt-in through STORY_WRITER_MODEL; the generic legacy
  // DEEPSEEK_MODEL must not silently turn every player click into a minute-long wait.
  const narrativeModel = String(process.env.STORY_WRITER_MODEL || process.env.STORY_NARRATIVE_MODEL || process.env.STORY_FAST_MODEL || process.env.ROLE_AGENT_MODEL || "deepseek-chat").trim();
  const fastModel = String(process.env.STORY_FAST_MODEL || process.env.ROLE_AGENT_MODEL || "deepseek-chat").trim();
  if (step === "WRITER") return narrativeModel;
  if (step === "DECISION_DESIGNER") return String(process.env.STORY_DECISION_MODEL || fastModel).trim();
  if (step === "AGENT_DECIDER") return String(process.env.STORY_AGENT_MODEL || fastModel).trim();
  return String(process.env.STORY_REVIEW_MODEL || fastModel).trim();
}

function maxTokensForStoryStep(step: StoryModelRequestV2["step"]): number {
  if (step === "WRITER") return 1_900;
  if (step === "DECISION_DESIGNER") return 850;
  if (step === "AGENT_DECIDER") return 320;
  return 500;
}
function parseAgentDecision(raw: string): { candidateId: string; rationale: string } {
  const normalized = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(normalized) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AGENT_DECISION_JSON_REQUIRED");
  const record = value as Record<string, unknown>;
  const candidateId = typeof record.candidateId === "string" ? record.candidateId.trim() : "";
  const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
  if (!candidateId || !rationale) throw new Error("AGENT_DECISION_FIELDS_REQUIRED");
  return { candidateId, rationale };
}

function parseAgentDecisionBatch(raw: string): Array<{ turnId: string; controlEpoch: number; candidateId: string; rationale: string }> {
  const normalized = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(normalized) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AGENT_BATCH_JSON_REQUIRED");
  const decisions = (value as Record<string, unknown>).decisions;
  if (!Array.isArray(decisions)) throw new Error("AGENT_BATCH_DECISIONS_REQUIRED");
  return decisions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("AGENT_BATCH_DECISION_OBJECT_REQUIRED");
    const record = entry as Record<string, unknown>;
    const turnId = typeof record.turnId === "string" ? record.turnId.trim() : "";
    const controlEpoch = Number(record.controlEpoch);
    const candidateId = typeof record.candidateId === "string" ? record.candidateId.trim() : "";
    const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
    if (!turnId || !Number.isInteger(controlEpoch) || !candidateId || !rationale) throw new Error("AGENT_BATCH_DECISION_FIELDS_REQUIRED");
    return { turnId, controlEpoch, candidateId, rationale };
  });
}

function agentExecutionRecord(input: {
  input: {
    context: StoryContextSnapshotV2;
    finalStory: string;
    candidates: DecisionCandidateV2[];
  };
  attempt: number;
  systemPrompt: string;
  userPrompt: string;
  response: StoryModelResponseV2 | null;
  started: number;
  startedAt: string;
  status: "SUCCESS" | "FAILED";
  issueCodes: string[];
}): PromptExecutionRecordV2 {
  const finished = Date.now();
  const context = input.input.context;
  return {
    executionId: randomUUID(),
    runId: context.identity.runId,
    roleId: context.identity.roleId,
    actorTurnId: context.identity.actorTurnId,
    actionResolutionId: null,
    worldSequence: context.identity.worldSequence,
    turnRevision: context.identity.turnRevision,
    pipelineStep: "AGENT_DECIDER",
    promptVersion: "many-worlds-agent-decider-v2.1",
    schemaVersion: "story-pipeline-v2.1",
    provider: input.response?.provider || "unavailable",
    modelName: input.response?.modelName || "unavailable",
    systemPromptHash: sha256Canonical(input.systemPrompt),
    contextSnapshotHash: context.identity.snapshotHash,
    inputHash: sha256Canonical({ contextSnapshotHash: context.identity.snapshotHash, story: input.input.finalStory, candidates: input.input.candidates }),
    outputHash: input.response ? sha256Canonical(input.response.content) : null,
    attempt: input.attempt,
    startedAt: input.startedAt,
    finishedAt: new Date(finished).toISOString(),
    latencyMs: finished - input.started,
    tokenUsage: input.response?.tokenUsage || null,
    status: input.status,
    issueCodes: input.issueCodes,
    supersededReason: null,
    inputMetadata: {
      candidateCount: input.input.candidates.length,
      storyTextHash: sha256Canonical(input.input.finalStory),
      finalStoryAtPromptTail: input.userPrompt.trim().endsWith(input.input.finalStory)
    },
    internalAudit: {
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      rawOutput: input.response?.content || null
    }
  };
}

function normalizeTimeout(raw: unknown) {
  const value = Number(raw || 60_000);
  return Number.isFinite(value) ? Math.max(3_000, Math.min(90_000, Math.trunc(value))) : 60_000;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function divideUsage(value: number | undefined, divisor: number): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.round(value / Math.max(1, divisor)));
}
