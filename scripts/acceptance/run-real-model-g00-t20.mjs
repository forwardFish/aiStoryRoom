import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const runtimeEntry = resolve(repoRoot, "apps/openovel-runtime/dist/server.js");
const auditEntry = resolve(repoRoot, "apps/openovel-runtime/dist/audit.js");
const pathsEntry = resolve(repoRoot, "apps/openovel-runtime/dist/paths.js");
const evidenceRoot = resolve(
  process.env.AI_STORY_REAL_MODEL_EVIDENCE_ROOT
    || resolve(repoRoot, "docs/auto-execute/evidence/chatgpt-pro-real-model"),
);
const timeoutMs = boundedInteger(
  process.env.AI_STORY_REAL_MODEL_TIMEOUT_MS,
  6_300_000,
  60_000,
  7_200_000,
);
const turnTimeoutMs = boundedInteger(
  process.env.AI_STORY_REAL_MODEL_TURN_TIMEOUT_MS,
  420_000,
  30_000,
  600_000,
);
const inputPricePerMillion = nonNegativeNumber(
  process.env.AI_STORY_INPUT_PRICE_PER_MILLION,
  0.435,
);
const outputPricePerMillion = nonNegativeNumber(
  process.env.AI_STORY_OUTPUT_PRICE_PER_MILLION,
  0.87,
);
const expectedModel = requiredExactModel(
  process.env.OPENOVEL_MODEL || "deepseek-v4-pro",
);
const providerBaseUrl = requiredDeepSeekBaseUrl(
  process.env.OPENOVEL_PROVIDER_BASE_URL || "https://api.deepseek.com",
);
const apiKey = firstText([
  process.env.OPENOVEL_PROVIDER_API_KEY,
  process.env.OPENOVEL_API_KEY,
  process.env.DEEPSEEK_API_KEY,
]);

mkdirSync(evidenceRoot, { recursive: true });
if (!existsSync(runtimeEntry)) {
  throw new Error(`REAL_MODEL_RUNTIME_BUILD_MISSING:${runtimeEntry}`);
}
if (!existsSync(auditEntry) || !existsSync(pathsEntry)) {
  throw new Error("REAL_MODEL_AUDIT_BUILD_MISSING");
}
if (!apiKey) throw new Error("REAL_MODEL_API_KEY_MISSING");
assertExactModelEnvironment(expectedModel);
if (String(process.env.OPENOVEL_DEEPSEEK_THINKING || "disabled").trim() !== "disabled") {
  throw new Error("REAL_MODEL_THINKING_MUST_BE_DISABLED");
}

const startedAt = new Date().toISOString();
const deadline = Date.now() + timeoutMs;
const acceptanceId = `chatgpt_pro_${Date.now()}_${randomBytes(4).toString("hex")}`;
const workspaceRoot = resolve(evidenceRoot, "workspaces", acceptanceId);
mkdirSync(workspaceRoot, { recursive: true });
writeJson(resolve(evidenceRoot, "run-configuration.json"), {
  schemaVersion: "omw.chatgpt-pro-real-model-configuration.v1",
  repository: "forwardFish/aiStoryRoom",
  branch: "codex/chatgpt-pro-ai-story-convergence",
  acceptanceId,
  providerBaseUrl,
  expectedModel,
  models: modelEnvironment(expectedModel),
  thinking: "disabled",
  reviewMode: "OFF",
  apiKeyPresent: true,
  sequence: ["G00-T05", "G00-T20"],
  timeoutMs,
  turnTimeoutMs,
  pricing: {
    inputPerMillion: inputPricePerMillion,
    outputPerMillion: outputPricePerMillion,
    currency: "USD",
  },
  startedAt,
});

const port = await reservePort();
const token = `acceptance-${randomBytes(16).toString("hex")}`;
const stdoutPath = resolve(evidenceRoot, "runtime.stdout.log");
const stderrPath = resolve(evidenceRoot, "runtime.stderr.log");
const runtime = startRuntime({ port, token, workspaceRoot, stdoutPath, stderrPath });

try {
  await waitForHealth(port, runtime, deadline);
  const providerDescription = await runtimeJson(port, token, "/internal/openovel/providers");
  assertRealProviderDescription(providerDescription, expectedModel);
  writeJson(resolve(evidenceRoot, "provider-description.json"), providerDescription);

  const shortRun = await runPlaythrough({
    label: "g00-t05",
    runId: `${acceptanceId}_t05`,
    targetTurns: 5,
    chooseOption: (options, turnNumber) => options[(turnNumber - 1) % options.length],
    port,
    token,
    workspaceRoot,
    deadline,
  });
  if (shortRun.audit.verdict !== "PASS") {
    throw new Error(`REAL_MODEL_G00_T05_PLAYER_ACCEPTANCE_FAILED:${JSON.stringify(shortRun.audit.player)}`);
  }

  const longRun = await runPlaythrough({
    label: "g00-t20",
    runId: `${acceptanceId}_t20`,
    targetTurns: 20,
    chooseOption: (options, turnNumber) => (
      turnNumber % 2 === 0 ? options[options.length - 1] : options[0]
    ),
    port,
    token,
    workspaceRoot,
    deadline,
  });
  if (longRun.audit.verdict !== "PASS") {
    throw new Error(`REAL_MODEL_G00_T20_PLAYER_ACCEPTANCE_FAILED:${JSON.stringify(longRun.audit.player)}`);
  }
  if (!longRun.finalPublicRun.storyComplete && longRun.finalPublicRun.status !== "COMPLETED") {
    throw new Error(`REAL_MODEL_T20_NOT_COMPLETED:${longRun.finalPublicRun.status}`);
  }

  const runtimeCalls = [shortRun, longRun].flatMap((run) => run.modelCalls);
  const playerReviewCalls = [shortRun, longRun].flatMap((run) => run.playerReviewCalls);
  const allObservedModels = unique([
    ...runtimeCalls.map((call) => call.model).filter(Boolean),
    ...playerReviewCalls.map((call) => call.model).filter(Boolean),
  ]);
  const allObservedProviders = unique([
    String(providerDescription.provider || ""),
    ...runtimeCalls.map((call) => call.provider).filter(Boolean),
    ...playerReviewCalls.map((call) => call.provider).filter(Boolean),
  ]);
  assertNoFixtureSignals({
    providerDescription,
    runtimeCalls,
    playerReviewCalls,
    allObservedModels,
    allObservedProviders,
  });
  assertOnlyExpectedModel(allObservedModels, expectedModel);
  const providerCallCount = runtimeCalls.filter((call) => !call.error).length
    + playerReviewCalls.filter((call) => !call.error).length;
  if (providerCallCount < 1) throw new Error("REAL_MODEL_PROVIDER_CALL_EVIDENCE_MISSING");

  const usage = addUsage([
    ...runtimeCalls,
    ...playerReviewCalls,
  ]);
  const estimatedCostUsd = Number((
    usage.inputTokens * inputPricePerMillion / 1_000_000
    + usage.outputTokens * outputPricePerMillion / 1_000_000
  ).toFixed(8));
  const summary = {
    schemaVersion: "omw.chatgpt-pro-real-model-acceptance.v2",
    verdict: "PASS",
    repository: "forwardFish/aiStoryRoom",
    branch: "codex/chatgpt-pro-ai-story-convergence",
    acceptanceId,
    providerBaseUrl,
    expectedModel,
    observedModels: allObservedModels,
    observedProviders: allObservedProviders,
    providerCallCount,
    fixtureSignalCount: 0,
    pricing: {
      inputPerMillion: inputPricePerMillion,
      outputPerMillion: outputPricePerMillion,
      currency: "USD",
      estimatedTotal: estimatedCostUsd,
    },
    usage,
    shortRun: summarizePlaythrough(shortRun),
    longRun: summarizePlaythrough(longRun),
    generatedAt: new Date().toISOString(),
  };
  writeJson(resolve(evidenceRoot, "real-model-acceptance-summary.json"), summary);
  // Backwards-compatible file name used by older candidate workflows.
  writeJson(resolve(evidenceRoot, "real-model-g00-t20-summary.json"), {
    schemaVersion: "omw.chatgpt-pro-real-model-g00-t20.v2",
    verdict: summary.verdict,
    repository: summary.repository,
    branch: summary.branch,
    providerBaseUrl,
    expectedModel,
    observedModels: allObservedModels,
    observedProviders: allObservedProviders,
    providerCallCount,
    fixtureSignalCount: 0,
    opening: longRun.checkpoints[0],
    turns: longRun.checkpoints.slice(1),
    turnCount: longRun.turns.length,
    audit: longRun.audit,
    generatedAt: summary.generatedAt,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await stopRuntime(runtime);
}

async function runPlaythrough(input) {
  assertBeforeDeadline(input.deadline, `${input.label}:start`);
  const runRoot = resolve(evidenceRoot, input.label);
  mkdirSync(runRoot, { recursive: true });
  const created = await runtimeJson(input.port, input.token, "/internal/openovel/runs", {
    method: "POST",
    body: JSON.stringify({
      runId: input.runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
      storyPackageVersion: "candidate",
      openingVersion: "candidate",
    }),
  });
  assert(created.turnNumber === 0, `${input.label}:G00_TURN_NUMBER`);
  assert(created.status === "READY", `${input.label}:G00_STATUS:${created.status}`);
  assert(hasText(created.prologueNarrative), `${input.label}:G00_NARRATIVE_MISSING`);
  validatePublicOptions(created.options, `${input.label}:G00`);
  const initialPrivate = readPrivateCheckpoint(input.workspaceRoot, input.runId, "G00");
  const checkpoints = [{
    checkpoint: "G00",
    turnId: "G00",
    turnNumber: 0,
    playerAction: null,
    selectedOption: null,
    narrative: created.prologueNarrative,
    publicOptions: created.options,
    publicStatus: created.status,
    publicTurnNumber: created.turnNumber,
    canonBinding: initialPrivate.canonBinding,
    settlement: null,
    nextBeatPlan: null,
    criticalState: initialPrivate.criticalState,
    narrativeOwner: "OPENING",
    fallbackReason: null,
    reviewStatus: "NOT_APPLICABLE",
    warnings: [],
    modelCalls: [],
  }];

  let currentOptions = created.options;
  let lastPublicRun = created;
  const turns = [];
  for (let turnNumber = 1; turnNumber <= input.targetTurns; turnNumber += 1) {
    assertBeforeDeadline(input.deadline, `${input.label}:T${pad(turnNumber)}`);
    validatePublicOptions(currentOptions, `${input.label}:T${pad(turnNumber)}:before`);
    const selected = input.chooseOption(currentOptions, turnNumber);
    if (!selected) throw new Error(`${input.label}:OPTION_SELECTION_FAILED:T${pad(turnNumber)}`);
    const actionResponse = await runtimeJson(
      input.port,
      input.token,
      `/internal/openovel/runs/${encodeURIComponent(input.runId)}/actions`,
      {
        method: "POST",
        body: JSON.stringify({
          action: selected.label,
          boundOption: { id: selected.id, label: selected.label },
          submissionId: `${input.runId}_T${pad(turnNumber)}`,
        }),
      },
      turnTimeoutMs,
    );
    assert(actionResponse.turnNumber === turnNumber, `${input.label}:TURN_NUMBER:${turnNumber}`);
    assert(actionResponse.turnId === `T${pad(turnNumber)}`, `${input.label}:TURN_ID:${turnNumber}`);
    assert(hasText(actionResponse.narration), `${input.label}:NARRATIVE_MISSING:T${pad(turnNumber)}`);
    const publicRun = await runtimeJson(
      input.port,
      input.token,
      `/internal/openovel/runs/${encodeURIComponent(input.runId)}`,
    );
    assert(publicRun.turnNumber === turnNumber, `${input.label}:PUBLIC_TURN:${turnNumber}`);
    assert(publicRun.prologueNarrative === "", `${input.label}:G00_REPEATED:T${pad(turnNumber)}`);
    const privateCheckpoint = readPrivateCheckpoint(
      input.workspaceRoot,
      input.runId,
      `T${pad(turnNumber)}`,
    );
    const checkpoint = {
      checkpoint: `T${pad(turnNumber)}`,
      turnId: actionResponse.turnId,
      turnNumber,
      playerAction: selected.label,
      selectedOption: { id: selected.id, label: selected.label },
      narrative: actionResponse.narration,
      publicOptions: actionResponse.options,
      publicStatus: publicRun.status,
      publicTurnNumber: publicRun.turnNumber,
      canonBinding: privateCheckpoint.canonBinding,
      settlement: privateCheckpoint.settlement,
      nextBeatPlan: privateCheckpoint.nextBeatPlan,
      criticalState: privateCheckpoint.criticalState,
      narrativeOwner: privateCheckpoint.narrativeOwner,
      fallbackReason: privateCheckpoint.fallbackReason,
      reviewStatus: privateCheckpoint.reviewStatus,
      warnings: privateCheckpoint.warnings,
      modelCalls: privateCheckpoint.modelCalls,
      storyComplete: actionResponse.storyComplete === true,
      ending: actionResponse.ending || null,
    };
    checkpoints.push(checkpoint);
    turns.push(checkpoint);
    writeJson(resolve(runRoot, "turns", `${checkpoint.turnId}.json`), checkpoint);
    currentOptions = actionResponse.options || [];
    lastPublicRun = publicRun;
    if (actionResponse.storyComplete) {
      if (turnNumber !== input.targetTurns) {
        throw new Error(`${input.label}:STORY_COMPLETED_EARLY:T${pad(turnNumber)}`);
      }
      if (currentOptions.length !== 0) {
        throw new Error(`${input.label}:COMPLETED_RUN_EXPOSED_OPTIONS`);
      }
    } else {
      validatePublicOptions(currentOptions, `${input.label}:T${pad(turnNumber)}:after`);
    }
  }

  validateOpeningCardinality(input.workspaceRoot, input.runId);
  const background = await waitForStorykeeper({
    workspaceRoot: input.workspaceRoot,
    runId: input.runId,
    targetTurns: input.targetTurns,
    deadline: input.deadline,
  });
  if (background.deadLetters.length) {
    throw new Error(`${input.label}:STORYKEEPER_DEAD_LETTER:${background.deadLetters.join(",")}`);
  }
  const playerReview = await reviewPlaythrough({
    label: input.label,
    checkpoints,
    providerBaseUrl,
    apiKey,
    model: expectedModel,
    evidenceRoot: runRoot,
    deadline: input.deadline,
  });
  const reviewsPath = resolve(runRoot, "player-reviews.json");
  writeJson(reviewsPath, playerReview.reviews);
  const { auditOpenNovelRun } = await import(pathToFileURL(auditEntry).href);
  const { workspacePaths } = await import(pathToFileURL(pathsEntry).href);
  const audit = await auditOpenNovelRun(
    workspacePaths(input.workspaceRoot, input.runId),
    {
      targetTurns: input.targetTurns,
      reviews: playerReview.reviews,
      pricing: {
        inputPerMillion: inputPricePerMillion,
        outputPerMillion: outputPricePerMillion,
        currency: "USD",
      },
    },
  );
  writeJson(resolve(runRoot, "acceptance-audit.json"), audit);
  writeJson(resolve(runRoot, "checkpoint-index.json"), checkpoints);
  writeFileSync(
    resolve(runRoot, "canon.md"),
    String(lastPublicRun.canon || ""),
    "utf8",
  );
  if (audit.currentTurn !== input.targetTurns) {
    throw new Error(`${input.label}:AUDIT_TURN_COUNT:${audit.currentTurn}`);
  }
  if (audit.technical.passed !== true || audit.player.passed !== true) {
    throw new Error(`${input.label}:AUDIT_NOT_PASS:${JSON.stringify(audit)}`);
  }
  const allModelCalls = readAllModelCalls(input.workspaceRoot, input.runId);
  if (allModelCalls.some((call) => call.error)) {
    throw new Error(`${input.label}:RECORDED_MODEL_ERROR:${JSON.stringify(allModelCalls.filter((call) => call.error))}`);
  }
  if (turns.some((turn) => turn.fallbackReason || ["FALLBACK", "PROTECTED_RENDERER"].includes(String(turn.narrativeOwner)))) {
    throw new Error(`${input.label}:UNEXPECTED_FOREGROUND_FALLBACK`);
  }
  writeJson(resolve(runRoot, "model-calls.json"), allModelCalls);
  writeJson(resolve(runRoot, "storykeeper.json"), background);
  return {
    label: input.label,
    runId: input.runId,
    targetTurns: input.targetTurns,
    checkpoints,
    turns,
    audit,
    finalPublicRun: lastPublicRun,
    modelCalls: allModelCalls,
    playerReviewCalls: playerReview.calls,
    background,
    evidenceRoot: runRoot,
  };
}

function readPrivateCheckpoint(workspaceRootValue, runId, turnId) {
  const runRoot = resolve(workspaceRootValue, runId);
  const stateRoot = resolve(runRoot, "story/state");
  const sceneLogPath = resolve(runRoot, "story/canon/scene_log.jsonl");
  const head = readJsonIfExists(resolve(runRoot, "head.json"), null);
  const state = readJsonIfExists(resolve(stateRoot, "part-one-state.json"), null);
  const settlementEvents = readJsonLines(resolve(stateRoot, "part-one-events.jsonl"));
  const settlement = turnId === "G00"
    ? null
    : [...settlementEvents].reverse().find((event) => event.turnNumber === numericTurnId(turnId)) || null;
  const sceneEvents = readJsonLines(sceneLogPath)
    .filter((event) => turnId === "G00" ? event.turnId === "G00" : event.turnId === turnId);
  const disposition = [...sceneEvents].reverse().find((event) => (
    event.type === "foreground_narrative_disposition"
  )) || null;
  const warningEvents = sceneEvents.filter((event) => (
    event.type === "shadow_warning"
    || event.type === "foreground_failed"
    || event.type === "foreground_narrator_unavailable"
  ));
  const callsDir = resolve(stateRoot, "model-calls");
  const modelCalls = existsSync(callsDir)
    ? readdirSync(callsDir)
        .filter((name) => turnId !== "G00" && name.startsWith(`${turnId}.`) && name.endsWith(".json"))
        .sort()
        .flatMap((name) => {
          const call = readJsonIfExists(resolve(callsDir, name), null);
          if (!call) return [];
          return [{
            turnId,
            stage: call.stage || null,
            attempt: call.attempt || 1,
            model: call.result?.model || null,
            provider: providerHost(providerBaseUrl),
            requestId: call.result?.requestId || null,
            inputTokens: Number(call.result?.usage?.inputTokens || 0),
            outputTokens: Number(call.result?.usage?.outputTokens || 0),
            latencyMs: Number(call.result?.latencyMs || 0),
            finishReason: call.result?.finishReason || null,
            error: call.error || null,
            sourceFile: relative(evidenceRoot, resolve(callsDir, name)).replaceAll("\\", "/"),
          }];
        })
    : [];
  const canonBinding = head
    ? {
        turnId: head.turnId || null,
        turnNumber: head.turnNumber ?? null,
        stateRevision: head.stateRevision ?? null,
        commitId: head.commitId || head.headHash || head.hash || null,
        manifestHash: head.manifestHash || null,
        stateHash: sha256(state),
      }
    : {
        turnId: "G00",
        turnNumber: 0,
        stateRevision: 0,
        commitId: null,
        manifestHash: null,
        stateHash: sha256(state),
      };
  return {
    canonBinding,
    settlement: settlement ? summarizeSettlement(settlement) : null,
    nextBeatPlan: settlement?.narrativePlan?.nextStoryBeat || null,
    criticalState: summarizeCriticalState(state),
    narrativeOwner: disposition?.narrativeOwner || null,
    fallbackReason: disposition?.fallbackReason || null,
    reviewStatus: disposition?.reviewObservation?.status || "NOT_RECORDED",
    warnings: warningEvents.map((event) => ({
      type: event.type,
      code: event.code || null,
      message: event.message || event.error || null,
    })),
    modelCalls,
  };
}

function summarizeSettlement(event) {
  return {
    eventId: event.eventId || null,
    turnNumber: event.turnNumber ?? null,
    actionSource: event.actionSource || null,
    decisionKernelId: event.decisionKernelId || null,
    affordanceTemplateId: event.affordanceTemplateId || null,
    changedStatePaths: Array.isArray(event.changedStatePaths) ? event.changedStatePaths : [],
    createdPendingConsequenceIds: Array.isArray(event.createdPendingConsequenceIds)
      ? event.createdPendingConsequenceIds
      : [],
    duePendingConsequenceIds: Array.isArray(event.duePendingConsequenceIds)
      ? event.duePendingConsequenceIds
      : [],
    authoritativeObservableFacts: Array.isArray(event.authoritativeObservableFacts)
      ? event.authoritativeObservableFacts
      : [],
    authoritativeNpcReactions: Array.isArray(event.authoritativeNpcReactions)
      ? event.authoritativeNpcReactions
      : [],
    authoritativeWorldMoves: Array.isArray(event.authoritativeWorldMoves)
      ? event.authoritativeWorldMoves
      : [],
    nextDecisionPoint: event.nextDecisionPoint || null,
    sectionTransitioned: event.sectionTransitioned === true,
  };
}

function summarizeCriticalState(state) {
  if (!state || typeof state !== "object") return null;
  return {
    partId: state.partId || null,
    sectionId: state.sectionId || null,
    turnNumber: state.turnNumber ?? null,
    scene: state.scene || null,
    reform: state.reform || null,
    review: state.review || null,
    evidence: state.evidence || null,
    witness: state.witness || null,
    grain: state.grain || null,
    merchant: state.merchant || null,
    land: state.land || null,
    report: state.report || null,
    responsibility: state.responsibility || null,
    relations: state.relations || null,
    knowledgeTransfers: state.knowledgeTransfers || [],
    pendingConsequences: state.pendingConsequences || [],
    completedKernelIds: state.completedKernelIds || [],
    causalArcStages: state.causalArcStages || {},
    lastCommittedEventId: state.lastCommittedEventId || null,
    partCompletionStatus: state.partCompletionStatus || null,
    durableStateHash: sha256(state.durableState || null),
  };
}

async function waitForStorykeeper(input) {
  const sceneLogPath = resolve(
    input.workspaceRoot,
    input.runId,
    "story/canon/scene_log.jsonl",
  );
  while (Date.now() < input.deadline) {
    const events = readJsonLines(sceneLogPath);
    const applied = events
      .filter((event) => event.type === "storykeeper_applied")
      .map((event) => String(event.turnId || event.itemId || ""));
    const deadLetters = events
      .filter((event) => event.type === "storykeeper_dead_letter")
      .map((event) => String(event.turnId || event.itemId || "UNKNOWN"));
    if (deadLetters.length) return { applied, deadLetters };
    if (applied.length >= input.targetTurns) return { applied, deadLetters };
    await delay(500);
  }
  throw new Error(`STORYKEEPER_ACCEPTANCE_TIMEOUT:${input.runId}:${input.targetTurns}`);
}

function readAllModelCalls(workspaceRootValue, runId) {
  const callsDir = resolve(
    workspaceRootValue,
    runId,
    "story/state/model-calls",
  );
  if (!existsSync(callsDir)) return [];
  return readdirSync(callsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const call = readJsonIfExists(resolve(callsDir, name), null);
      if (!call) return [];
      return [{
        turnId: String(call.turnId || name.split(".")[0] || ""),
        stage: call.stage || null,
        attempt: call.attempt || 1,
        model: call.result?.model || null,
        provider: providerHost(providerBaseUrl),
        requestId: call.result?.requestId || null,
        inputTokens: Number(call.result?.usage?.inputTokens || 0),
        outputTokens: Number(call.result?.usage?.outputTokens || 0),
        latencyMs: Number(call.result?.latencyMs || 0),
        finishReason: call.result?.finishReason || null,
        error: call.error || null,
        sourceFile: relative(evidenceRoot, resolve(callsDir, name)).replaceAll("\\", "/"),
      }];
    });
}

async function reviewPlaythrough(input) {
  const reviewRoot = resolve(input.evidenceRoot, "player-review-calls");
  mkdirSync(reviewRoot, { recursive: true });
  const batches = chunk(input.checkpoints, 5);
  const reviews = [];
  const calls = [];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    assertBeforeDeadline(input.deadline, `${input.label}:player-review:${batchIndex + 1}`);
    const batch = batches[batchIndex];
    const requestPayload = {
      schemaVersion: "omw.player-review-input.v1",
      product: "Our Many Worlds / 桑田诏 / 单人第一部分",
      rule: "像真实玩家一样判断，不因为系统字段存在就自动通过。任何重大连续性冲突、替玩家追加命令、报告式正文、NPC 无主动性、选项不承接正文或不愿继续，都必须明确给 false 并写入 blockingProblems。",
      checkpoints: batch.map((checkpoint) => ({
        checkpoint: checkpoint.checkpoint,
        playerAction: checkpoint.playerAction,
        narrative: checkpoint.narrative,
        publicOptions: (checkpoint.publicOptions || []).map((option) => option.label),
        settlement: checkpoint.settlement,
        previousCriticalState: previousCriticalState(input.checkpoints, checkpoint.checkpoint),
        criticalState: checkpoint.criticalState,
        narrativeOwner: checkpoint.narrativeOwner,
        fallbackReason: checkpoint.fallbackReason,
      })),
    };
    const messages = [
      {
        role: "system",
        content: [
          "你是严格的互动历史小说玩家验收员，不是开发者，也不是文案润色助手。",
          "只根据玩家可见正文、选择和提供的权威结算摘要判断。",
          "返回严格 JSON 对象，唯一顶层字段 reviews。",
          "每个 checkpoint 必须恰好返回一项，字段为 checkpoint, actionResponded, choiceImpactVisible, novelLike, worldToneFit, npcAgency, playerAgencyPreserved, causalGrounded, coherent, optionsUnderstandable, optionsDistinct, optionsExecutable, freeInputAvailable, wantsToContinue, reportLike, majorContinuityError, blockingProblems, notes。",
          "G00 的 actionResponded 和 choiceImpactVisible 必须是 null；其他回合必须是 boolean。",
          "若正文只是政策说明/状态摘要、NPC 没有主动行动、玩家选择没有可感知结果、关键事实冲突、选项含混或不承接停止点，则对应字段必须为 false。",
          "不得省略字段，不得使用 markdown。",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(requestPayload) },
    ];
    const call = await directDeepSeekCall({
      profile: "player-review",
      messages,
      model: input.model,
      providerBaseUrl: input.providerBaseUrl,
      apiKey: input.apiKey,
      maxTokens: Math.min(8_000, 1_200 + batch.length * 1_000),
      timeoutMs: turnTimeoutMs,
    });
    const callPath = resolve(reviewRoot, `batch-${String(batchIndex + 1).padStart(2, "0")}.json`);
    writeJson(callPath, { request: requestPayload, result: call });
    calls.push({
      stage: "player-review",
      model: call.model,
      provider: providerHost(input.providerBaseUrl),
      requestId: call.requestId || null,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      latencyMs: call.latencyMs,
      finishReason: call.finishReason || null,
      error: null,
      sourceFile: relative(evidenceRoot, callPath).replaceAll("\\", "/"),
    });
    const parsed = parseJsonObject(call.text, `PLAYER_REVIEW_JSON_INVALID:${input.label}:${batchIndex + 1}`);
    const rows = Array.isArray(parsed.reviews) ? parsed.reviews : [];
    const expectedIds = batch.map((checkpoint) => checkpoint.checkpoint);
    if (rows.length !== expectedIds.length) {
      throw new Error(`PLAYER_REVIEW_CARDINALITY:${input.label}:${rows.length}:${expectedIds.length}`);
    }
    const byCheckpoint = new Map(rows.map((row) => [String(row.checkpoint || ""), row]));
    for (const checkpoint of batch) {
      const rawReview = byCheckpoint.get(checkpoint.checkpoint);
      if (!rawReview) throw new Error(`PLAYER_REVIEW_MISSING:${checkpoint.checkpoint}`);
      reviews.push(normalizePlayerReview(rawReview, checkpoint));
    }
  }
  return { reviews, calls };
}

function normalizePlayerReview(raw, checkpoint) {
  const isOpening = checkpoint.checkpoint === "G00";
  const optionLabels = (checkpoint.publicOptions || []).map((option) => String(option.label || "").trim());
  const structuralOptions = optionLabels.length >= 2
    && optionLabels.length <= 4
    && new Set(optionLabels).size === optionLabels.length;
  const settlementChanged = isOpening || Boolean(
    checkpoint.settlement
    && (
      (checkpoint.settlement.changedStatePaths || []).length
      || (checkpoint.settlement.authoritativeNpcReactions || []).length
      || (checkpoint.settlement.authoritativeWorldMoves || []).length
    )
  );
  const review = {
    checkpoint: checkpoint.checkpoint,
    actionResponded: isOpening ? null : requiredBoolean(raw.actionResponded, `${checkpoint.checkpoint}.actionResponded`),
    choiceImpactVisible: isOpening
      ? null
      : requiredBoolean(raw.choiceImpactVisible, `${checkpoint.checkpoint}.choiceImpactVisible`) && settlementChanged,
    novelLike: requiredBoolean(raw.novelLike, `${checkpoint.checkpoint}.novelLike`),
    worldToneFit: requiredBoolean(raw.worldToneFit, `${checkpoint.checkpoint}.worldToneFit`),
    npcAgency: requiredBoolean(raw.npcAgency, `${checkpoint.checkpoint}.npcAgency`),
    playerAgencyPreserved: requiredBoolean(raw.playerAgencyPreserved, `${checkpoint.checkpoint}.playerAgencyPreserved`),
    causalGrounded: requiredBoolean(raw.causalGrounded, `${checkpoint.checkpoint}.causalGrounded`) && (isOpening || Boolean(checkpoint.settlement)),
    coherent: requiredBoolean(raw.coherent, `${checkpoint.checkpoint}.coherent`),
    optionsUnderstandable: requiredNullableBoolean(raw.optionsUnderstandable, `${checkpoint.checkpoint}.optionsUnderstandable`),
    optionsDistinct: requiredNullableBoolean(raw.optionsDistinct, `${checkpoint.checkpoint}.optionsDistinct`) && structuralOptions,
    optionsExecutable: requiredNullableBoolean(raw.optionsExecutable, `${checkpoint.checkpoint}.optionsExecutable`) && structuralOptions,
    freeInputAvailable: true,
    wantsToContinue: requiredBoolean(raw.wantsToContinue, `${checkpoint.checkpoint}.wantsToContinue`),
    reportLike: requiredBoolean(raw.reportLike, `${checkpoint.checkpoint}.reportLike`),
    majorContinuityError: requiredBoolean(raw.majorContinuityError, `${checkpoint.checkpoint}.majorContinuityError`),
    blockingProblems: Array.isArray(raw.blockingProblems)
      ? raw.blockingProblems.map(String).filter(Boolean)
      : [],
    notes: String(raw.notes || "").slice(0, 1_000),
  };
  if (checkpoint.storyComplete) {
    review.optionsUnderstandable = null;
    review.optionsDistinct = null;
    review.optionsExecutable = null;
  }
  return review;
}

async function directDeepSeekCall(input) {
  const endpoint = `${normalizeProviderApiRoot(input.providerBaseUrl)}/chat/completions`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: 0,
        max_tokens: input.maxTokens,
        stream: false,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
    const requestId = response.headers.get("x-request-id")
      || response.headers.get("x-deepseek-request-id")
      || undefined;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`PLAYER_REVIEW_PROVIDER_HTTP_${response.status}:${JSON.stringify(payload).slice(0, 500)}`);
    }
    const text = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("PLAYER_REVIEW_PROVIDER_EMPTY");
    return {
      text,
      model: String(payload?.model || input.model),
      requestId,
      finishReason: payload?.choices?.[0]?.finish_reason || null,
      usage: {
        inputTokens: Number(payload?.usage?.prompt_tokens || 0),
        outputTokens: Number(payload?.usage?.completion_tokens || 0),
      },
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function startRuntime(input) {
  writeFileSync(input.stdoutPath, "", "utf8");
  writeFileSync(input.stderrPath, "", "utf8");
  const child = spawn(process.execPath, [runtimeEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(input.port),
      OPENOVEL_RUNTIME_HOST: "127.0.0.1",
      OPENOVEL_WORKSPACE_ROOT: input.workspaceRoot,
      OPENOVEL_INTERNAL_TOKEN: input.token,
      OPENOVEL_PROVIDER_BASE_URL: providerBaseUrl,
      OPENOVEL_PROVIDER_API_KEY: apiKey,
      OPENOVEL_API_KEY: apiKey,
      DEEPSEEK_API_KEY: apiKey,
      OPENOVEL_MODEL: expectedModel,
      OPENOVEL_NARRATOR_MODEL: expectedModel,
      OPENOVEL_REVIEWER_MODEL: expectedModel,
      OPENOVEL_OPTIONS_MODEL: expectedModel,
      OPENOVEL_STORYKEEPER_MODEL: expectedModel,
      OPENOVEL_DEEPSEEK_THINKING: "disabled",
      OPENOVEL_TRUTH_REVIEW_MODE: "OFF",
      OPENOVEL_PROVIDER_TIMEOUT_MS: String(Math.min(300_000, turnTimeoutMs)),
      OPENOVEL_OPTIONS_TIMEOUT_MS: String(Math.min(180_000, turnTimeoutMs)),
      OPENOVEL_MIRROR_URL: "",
      OPENOVEL_PLAYTEST_ENABLED: "0",
      OPENOVEL_ALLOW_FIXTURE_PROVIDER: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => appendFileSync(input.stdoutPath, chunk));
  child.stderr?.on("data", (chunk) => appendFileSync(input.stderrPath, chunk));
  return child;
}

async function waitForHealth(port, child, deadline) {
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`REAL_MODEL_RUNTIME_EXITED:${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok && (await response.json()).ok) return;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await delay(250);
  }
  throw new Error(`REAL_MODEL_RUNTIME_NOT_READY:${lastError}`);
}

async function runtimeJson(port, token, route, init = {}, requestTimeoutMs = 30_000) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`REAL_MODEL_RUNTIME_HTTP_${response.status}:${route}:${JSON.stringify(payload).slice(0, 1_000)}`);
  }
  return payload;
}

async function stopRuntime(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    delay(5_000),
  ]);
  if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("REAL_MODEL_PORT_RESERVATION_FAILED");
  const port = address.port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

function validatePublicOptions(options, label) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
    throw new Error(`${label}:PUBLIC_OPTION_COUNT:${Array.isArray(options) ? options.length : "NOT_ARRAY"}`);
  }
  const ids = options.map((option) => String(option?.id || "").trim());
  const labels = options.map((option) => String(option?.label || "").trim());
  if (ids.some((id) => !id) || labels.some((value) => !value)) {
    throw new Error(`${label}:PUBLIC_OPTION_EMPTY`);
  }
  if (new Set(ids).size !== ids.length || new Set(labels).size !== labels.length) {
    throw new Error(`${label}:PUBLIC_OPTION_DUPLICATE`);
  }
  const forbidden = /statePatch|pendingConsequence|decisionKernel|affordanceTemplate|resultCeiling|sourceRef|fixture|mock|测试|后台|内部字段/iu;
  if (labels.some((value) => forbidden.test(value))) {
    throw new Error(`${label}:PUBLIC_OPTION_INTERNAL_LEAK`);
  }
}

function validateOpeningCardinality(workspaceRootValue, runId) {
  const events = readJsonLines(resolve(workspaceRootValue, runId, "story/canon/scene_log.jsonl"));
  const openings = events.filter((event) => event.type === "opening_committed");
  if (openings.length !== 1) throw new Error(`G00_CARDINALITY:${runId}:${openings.length}`);
}

function assertRealProviderDescription(description, model) {
  if (!description?.configured) throw new Error("REAL_MODEL_PROVIDER_NOT_CONFIGURED");
  if (String(description.provider || "").toLowerCase() !== "api.deepseek.com") {
    throw new Error(`REAL_MODEL_PROVIDER_IDENTITY:${description.provider}`);
  }
  if (String(description.model || "").toLowerCase() !== model.toLowerCase()) {
    throw new Error(`REAL_MODEL_DESCRIPTION_MODEL:${description.model}`);
  }
}

function assertOnlyExpectedModel(models, model) {
  if (!models.length) throw new Error("REAL_MODEL_IDENTITY_NOT_OBSERVED");
  const unexpected = models.filter((value) => String(value).toLowerCase() !== model.toLowerCase());
  if (unexpected.length) throw new Error(`REAL_MODEL_UNEXPECTED_MODEL:${unexpected.join(",")}`);
}

function assertNoFixtureSignals(value) {
  const text = JSON.stringify(value);
  if (/fixture|mock|stub|fake-provider|local-smoke/iu.test(text)) {
    throw new Error("REAL_MODEL_FIXTURE_SIGNAL_DETECTED");
  }
}

function assertExactModelEnvironment(model) {
  const variables = [
    "OPENOVEL_MODEL",
    "OPENOVEL_NARRATOR_MODEL",
    "OPENOVEL_REVIEWER_MODEL",
    "OPENOVEL_OPTIONS_MODEL",
    "OPENOVEL_STORYKEEPER_MODEL",
  ];
  for (const variable of variables) {
    const configured = String(process.env[variable] || model).trim();
    if (configured.toLowerCase() !== model.toLowerCase()) {
      throw new Error(`REAL_MODEL_ENV_MISMATCH:${variable}:${configured}`);
    }
  }
}

function modelEnvironment(model) {
  return {
    default: model,
    narrator: String(process.env.OPENOVEL_NARRATOR_MODEL || model),
    reviewer: String(process.env.OPENOVEL_REVIEWER_MODEL || model),
    options: String(process.env.OPENOVEL_OPTIONS_MODEL || model),
    storykeeper: String(process.env.OPENOVEL_STORYKEEPER_MODEL || model),
  };
}

function requiredExactModel(value) {
  const model = String(value || "").trim();
  if (model.toLowerCase() !== "deepseek-v4-pro") {
    throw new Error(`REAL_MODEL_NAME_NOT_EXACT:${model}`);
  }
  return model;
}

function requiredDeepSeekBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "api.deepseek.com") {
    throw new Error(`REAL_MODEL_PROVIDER_NOT_EXACT:${url.toString()}`);
  }
  return `${url.protocol}//${url.host}`;
}

function normalizeProviderApiRoot(value) {
  return String(value || "").replace(/\/+$/u, "").endsWith("/v1")
    ? String(value || "").replace(/\/+$/u, "")
    : `${String(value || "").replace(/\/+$/u, "")}/v1`;
}

function providerHost(value) {
  return new URL(value).hostname.toLowerCase();
}

function summarizePlaythrough(run) {
  return {
    label: run.label,
    runId: run.runId,
    verdict: run.audit.verdict,
    targetTurns: run.targetTurns,
    turnCount: run.turns.length,
    opening: run.checkpoints[0],
    turns: run.turns,
    finalStatus: run.finalPublicRun.status,
    storyComplete: run.finalPublicRun.status === "COMPLETED",
    audit: run.audit,
    storykeeper: run.background,
    evidenceRoot: relative(evidenceRoot, run.evidenceRoot).replaceAll("\\", "/"),
  };
}

function previousCriticalState(checkpoints, checkpointId) {
  const index = checkpoints.findIndex((checkpoint) => checkpoint.checkpoint === checkpointId);
  return index > 0 ? checkpoints[index - 1].criticalState : null;
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`PLAYER_REVIEW_BOOLEAN_REQUIRED:${label}`);
  return value;
}

function requiredNullableBoolean(value, label) {
  if (value !== null && typeof value !== "boolean") {
    throw new Error(`PLAYER_REVIEW_NULLABLE_BOOLEAN_REQUIRED:${label}`);
  }
  return value;
}

function parseJsonObject(text, code) {
  const stripped = String(text || "").trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu, "$1");
  try {
    const value = JSON.parse(stripped);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NOT_OBJECT");
    return value;
  } catch (error) {
    throw new Error(`${code}:${String(error?.message || error)}:${stripped.slice(0, 500)}`);
  }
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/u).flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function readJsonIfExists(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function addUsage(calls) {
  return calls.reduce((sum, call) => ({
    inputTokens: sum.inputTokens + Number(call.inputTokens || 0),
    outputTokens: sum.outputTokens + Number(call.outputTokens || 0),
    latencyMs: sum.latencyMs + Number(call.latencyMs || 0),
    calls: sum.calls + 1,
    errors: sum.errors + (call.error ? 1 : 0),
  }), { inputTokens: 0, outputTokens: 0, latencyMs: 0, calls: 0, errors: 0 });
}

function firstText(values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function numericTurnId(turnId) {
  const match = String(turnId || "").match(/^T(\d{2})$/u);
  return match ? Number(match[1]) : 0;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function assertBeforeDeadline(deadlineValue, label) {
  if (Date.now() >= deadlineValue) throw new Error(`REAL_MODEL_ACCEPTANCE_DEADLINE:${label}`);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
