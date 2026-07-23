import { PrismaClient } from "@prisma/client";
import { SoloStoryEngineService } from "../../apps/api/src/solo-story-engine/solo-story-engine.service";
import { commandToRawPlayerAction } from "../../apps/api/src/solo-story-engine/runtime-mapper";
import { normalizePlayerIntent } from "../../apps/api/src/solo-story-engine/player-intent";
import { validatePlayerIntent } from "../../apps/api/src/solo-story-engine/local-validator";
import { buildActionAvailability, rawActionLockReason } from "../../apps/api/src/solo-story-engine/action-availability";
import { CreditsService } from "../../apps/api/src/credits/credits.service";
import { CreditConsumptionService } from "../../apps/api/src/credits/credit-consumption.service";
import {
  parseDecisionCopyOutput,
  parseNarratorDraft
} from "../../apps/api/src/solo-story-engine/output-parser";
import {
  validateDecisionCopy,
  validateNarratorDraft,
  validateStoryTurnOutput
} from "../../apps/api/src/solo-story-engine/output-validator";
import { compileSoloStoryContext } from "../../apps/api/src/solo-story-engine/context-compiler";
import { arbitratePlayerIntent } from "../../apps/api/src/solo-story-engine/rules-arbiter";

const prisma = new PrismaClient();
async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("usage: sangtian-part-one-runtime-debug.ts <runId>");

  const [run, role, turn] = await Promise.all([
    prisma.storyRun.findUniqueOrThrow({ where: { id: runId } }),
    prisma.storyRole.findFirstOrThrow({ where: { runId, roleKey: "zhejiang_governor" } }),
    prisma.actorTurn.findFirstOrThrow({
      where: { runId },
      include: { decisionSet: true },
      orderBy: [{ turnIndex: "desc" }, { revision: "desc" }]
    })
  ]);
  const candidates = Array.isArray(turn.decisionSet?.candidatesJson) ? turn.decisionSet.candidatesJson as any[] : [];
  const candidate = candidates[0];
  if (!candidate) throw new Error("current turn has no first candidate");
  const rawAction = commandToRawPlayerAction({
    idempotencyKey: `runtime-debug:${turn.id}`,
    turnRevision: turn.revision,
    controlEpoch: 1,
    decisionForm: "STORY_CHOICE",
    candidateId: candidate.id,
    intent: candidate.intentDraft
  } as any, candidates as any);
  const credits = new CreditsService(prisma as any);
  const creditConsumption = new CreditConsumptionService(prisma as any, credits);
  const service = new SoloStoryEngineService(prisma as any, creditConsumption) as any;
  const runtime = await service.buildRuntimeInput(run, role, turn.turnIndex, rawAction);
  const normalized = normalizePlayerIntent(rawAction);
  if (!normalized.ok) throw new Error(`normalize failed: ${normalized.issues.join("|")}`);
  const validation = validatePlayerIntent(normalized.intent, runtime.role, runtime.availableTargets);
  const availability = buildActionAvailability({
    turnStatus: turn.status,
    canHumanAct: true,
    completed: false,
    storyPublished: Boolean(turn.situationNarrative),
    decisions: candidates,
    availableTargets: runtime.availableTargets,
    activeAssetKeys: runtime.activeAssetKeys,
    affordances: runtime.actionAffordances,
    storyChoiceOnly: runtime.partOneWorkingSet.partId === "PART-01"
  });
  const lockReason = rawActionLockReason(rawAction, availability);
  const attempts = await prisma.soloGenerationAttempt.findMany({
    where: { runId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      triggerType: true,
      status: true,
      providerCallCount: true,
      issueCodesJson: true,
      failureReason: true,
      rawOutput: true,
      parsedOutput: true,
      createdAt: true,
      finishedAt: true
    }
  });
  if (process.argv.includes("--fail-stuck")) {
    const stuck = attempts.find((attempt) => attempt.status === "GENERATING");
    if (!stuck) throw new Error("No GENERATING attempt exists on this run.");
    const narrationProviderCallCount = stuck.providerCallCount >= 1 ? 1 : 0;
    const decisionProviderCallCount = stuck.providerCallCount >= 2 ? 1 : 0;
    await service.failAttempt(stuck.id, {
      ok: false,
      attempt: {
        status: "FAILED_RETRYABLE",
        providerCallCount: stuck.providerCallCount,
        narrationProviderCallCount,
        decisionProviderCallCount
      },
      playerIntent: null,
      issues: [{ code: "DEBUG_STUCK_GENERATION", message: "Diagnostic cleanup of a failed acceptance run." }]
    }, Date.now(), turn.id);
  }
  const latestWithRawOutput = attempts.find((attempt) => Boolean(attempt.rawOutput));
  const actionResolution = normalized.ok ? arbitratePlayerIntent({ role: runtime.role, intent: normalized.intent, validation }) : null;
  const compiled = actionResolution ? compileSoloStoryContext({
    role: runtime.role,
    scene: runtime.scene,
    facts: runtime.facts,
    recentCanon: runtime.recentCanon,
    pendingConsequences: runtime.pendingConsequences,
    activePressures: runtime.activePressures,
    relevantScriptCards: runtime.relevantScriptCards,
    actionResolution,
    playerIntent: normalized.intent,
    availableTargets: runtime.nextAvailableTargets,
    openingTrigger: null,
    partOneRuntime: runtime.partOneWorkingSet,
    partOneSettlement: runtime.partOneSettlement,
    maxTokenEstimate: 6_000
  }) : null;
  const latestTwoStageAudit = process.argv.includes("--validate-latest")
    && latestWithRawOutput?.rawOutput
    && latestWithRawOutput.parsedOutput
    && compiled?.ok
    ? auditLatestTwoStageAttempt(
        latestWithRawOutput.rawOutput,
        latestWithRawOutput.parsedOutput,
        compiled.context
      )
    : null;
  console.log(JSON.stringify({
    runId,
    turnId: turn.id,
    turnIndex: turn.turnIndex,
    rawAction,
    currentKernelId: runtime.partOneWorkingSet.retrievalTrace.decisionKernelId,
    normalizedIntent: normalized.intent,
    validation,
    availability,
    lockReason,
    attempts: attempts.map(({ rawOutput: _rawOutput, ...attempt }) => attempt),
    latestTwoStageAudit,
    settlementEvent: runtime.partOneSettlement?.event,
    availableTargets: runtime.availableTargets,
    nextAvailableTargets: runtime.nextAvailableTargets
  }, null, 2));
}

function auditLatestTwoStageAttempt(
  rawOutput: string,
  parsedOutput: unknown,
  context: Parameters<typeof validateStoryTurnOutput>[1]
) {
  try {
    const envelope = JSON.parse(rawOutput) as {
      schemaVersion?: string;
      narrator?: string;
      decision?: string;
    };
    if (envelope.schemaVersion !== "solo-two-stage-raw-v1") {
      throw new Error(`unexpected raw envelope: ${String(envelope.schemaVersion)}`);
    }
    const narration = parseNarratorDraft(String(envelope.narrator || ""));
    const decisionCopy = parseDecisionCopyOutput(String(envelope.decision || ""));
    const output = parsedOutput as Parameters<typeof validateStoryTurnOutput>[0];
    return {
      narrationValidation: validateNarratorDraft(narration, context),
      decisionValidation: validateDecisionCopy(decisionCopy, context),
      outputValidation: validateStoryTurnOutput(output, context),
      narrativeImmutable:
        output.resultType === "PUBLISHED_TURN"
        && `${output.story.resultNarrative}\n\n${output.story.nextSituationNarrative}` === envelope.narrator
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      narrativeImmutable: false
    };
  }
}

void main().finally(() => prisma.$disconnect());
