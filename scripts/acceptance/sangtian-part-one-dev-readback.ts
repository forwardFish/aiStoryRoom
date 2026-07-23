import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function compactText(value: unknown, limit = 280) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit * 2) return normalized;
  return `${normalized.slice(0, limit)} … ${normalized.slice(-limit)}`;
}

function suspectTerms(value: unknown) {
  if (typeof value !== "string") return [];
  const terms = [
    "田契抄本", "存目抄本", "借阅人", "借阅过", "笔迹", "墨色", "县丞", "远亲",
    "口供", "供述", "失踪", "封条破损", "封条被动", "仓单", "账房", "暗账线索",
    "册面编号", "田契目录", "重新粘贴", "页码", "主簿"
  ];
  return terms.filter((term) => value.includes(term));
}

async function main() {
  const requestedRunId = argument("run-id");
  const latest = requestedRunId ? null : await prisma.storyRun.findFirst({
    where: { templateKey: "sangtian", id: { startsWith: "solo_" } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  const runId = requestedRunId || latest?.id;
  if (!runId) throw new Error("No Sangtian Solo run found; pass --run-id <solo run id>");
  const [run, turns, attempts, submissions, actions, resolutions, decisionSets, narratives] = await Promise.all([
    prisma.storyRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true, currentDay: true, worldSequence: true, engineVersion: true, strategyVersion: true, stateJson: true }
    }),
    prisma.actorTurn.findMany({ where: { runId }, orderBy: { turnIndex: "asc" }, select: { id: true, turnIndex: true, status: true, situationTitle: true, situationNarrative: true, contextJson: true } }),
    prisma.soloGenerationAttempt.findMany({ where: { runId }, orderBy: { createdAt: "asc" }, select: { id: true, triggerType: true, status: true, providerCallCount: true, contextSnapshotHash: true, confirmedResolutionJson: true, rawOutput: true, parsedOutput: true, issueCodesJson: true, failureReason: true, timingsJson: true } }),
    prisma.decisionSubmission.findMany({ where: { runId }, orderBy: { submittedAt: "asc" }, select: { id: true, turnId: true, playerActionId: true, candidateId: true, rawIntentJson: true, normalizedIntentJson: true, immutableIntentHash: true, status: true, submittedAt: true, resolvedAt: true } }),
    prisma.playerAction.findMany({ where: { runId }, orderBy: { createdAt: "asc" }, select: { id: true, actionType: true, targetType: true, targetId: true, targetText: true, method: true, intent: true, normalizedJson: true, status: true, resolvedJson: true } }),
    prisma.actionResolution.findMany({ where: { runId }, orderBy: { resolvedAt: "asc" }, select: { id: true, turnId: true, playerActionId: true, appliedWorldSequence: true, outcomeJson: true, statePatchJson: true, resultNarrative: true, nextHook: true, qualityStatus: true, resolvedAt: true } }),
    prisma.decisionSet.findMany({ where: { runId }, orderBy: { generatedAt: "asc" }, select: { turnId: true, framing: true, candidatesJson: true, qualityStatus: true, generatedAt: true } }),
    prisma.narrativeEntry.findMany({ where: { runId }, orderBy: { worldSequence: "asc" }, select: { entryType: true, content: true, worldSequence: true, sourceEventIdsJson: true } })
  ]);
  if (process.argv.includes("--summary")) {
    const state = run?.stateJson as any;
    console.log(JSON.stringify({
      runId,
      status: run?.status,
      currentDay: run?.currentDay,
      worldSequence: run?.worldSequence,
      partOne: state?.partOne,
      soloStory: state?.soloStory,
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        triggerType: attempt.triggerType,
        status: attempt.status,
        providerCallCount: attempt.providerCallCount,
        issueCodes: attempt.issueCodesJson,
        failureReason: attempt.failureReason,
        rawOutputCharacterCount: attempt.rawOutput?.length || 0,
        rawOutputPreview: attempt.rawOutput?.slice(0, 1200) || null,
        timings: attempt.timingsJson
      })),
      actionCount: actions.length,
      resolutionCount: resolutions.length,
      nextDecisionCount: (decisionSets.at(-1)?.candidatesJson as any[])?.length || 0
    }, null, 2));
    return;
  }
  if (process.argv.includes("--player-view")) {
    const latestResolution = resolutions.at(-1) as any;
    const latestDecisions = decisionSets.at(-1)?.candidatesJson as any[] | undefined;
    console.log(JSON.stringify({
      runId,
      turn: latestResolution ? resolutions.length : 0,
      title: turns.at(-1)?.situationTitle,
      resultNarrative: latestResolution?.resultNarrative || null,
      nextSituationNarrative: latestResolution?.nextHook || turns.at(-1)?.situationNarrative || null,
      visibleChanges: latestResolution?.outcomeJson?.endingState?.visibleChanges || [],
      decisions: (latestDecisions || []).map((decision) => ({
        description: decision.description
      })),
      partOneEvent: latestResolution?.outcomeJson?.partOneEvent || null,
      partOneProgressReport: latestResolution?.outcomeJson?.partOneProgressReport || null
    }, null, 2));
    return;
  }
  if (process.argv.includes("--audit-view")) {
    const latestResolution = resolutions.at(-1) as any;
    const latestAttempt = attempts.at(-1) as any;
    const latestDecisions = decisionSets.at(-1)?.candidatesJson as any[] | undefined;
    const state = run?.stateJson as any;
    const resultNarrative = latestResolution?.resultNarrative || "";
    const nextHook = latestResolution?.nextHook || turns.at(-1)?.situationNarrative || "";
    console.log(JSON.stringify({
      runId,
      run: {
        status: run?.status,
        currentDay: run?.currentDay,
        worldSequence: run?.worldSequence,
        partOne: state?.partOne,
        soloStory: state?.soloStory
      },
      counts: {
        turns: turns.length,
        attempts: attempts.length,
        submissions: submissions.length,
        actions: actions.length,
        resolutions: resolutions.length,
        decisionSets: decisionSets.length,
        narratives: narratives.length
      },
      provider: latestAttempt ? {
        status: latestAttempt.status,
        providerCallCount: latestAttempt.providerCallCount,
        issueCodes: latestAttempt.issueCodesJson,
        failureReason: latestAttempt.failureReason,
        rawOutputCharacterCount: latestAttempt.rawOutput?.length || 0,
        timings: latestAttempt.timingsJson
      } : null,
      playerVisible: {
        title: turns.at(-1)?.situationTitle,
        resultNarrativeCharacterCount: resultNarrative.length,
        resultNarrativePreview: compactText(resultNarrative),
        resultNarrativeSuspectTerms: suspectTerms(resultNarrative),
        nextHookCharacterCount: nextHook.length,
        nextHookPreview: compactText(nextHook),
        nextHookSuspectTerms: suspectTerms(nextHook),
        visibleChanges: latestResolution?.outcomeJson?.endingState?.visibleChanges || [],
        decisions: (latestDecisions || []).map((decision) => ({
          id: decision.id,
          label: decision.label,
          description: decision.description,
          method: decision.intentDraft?.method,
          concreteCost: decision.concreteCost,
          expectedCountermove: decision.expectedCountermove,
          decisionKernelId: decision.intentDraft?.decisionKernelId,
          affordanceTemplateId: decision.intentDraft?.affordanceTemplateId
        }))
      },
      authoritative: {
        partOneEvent: latestResolution?.outcomeJson?.partOneEvent || null,
        partOneProgressReport: latestResolution?.outcomeJson?.partOneProgressReport || null,
        statePatch: latestResolution?.statePatchJson || null
      }
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({ run, turns, attempts, submissions, actions, resolutions, decisionSets, narratives }, null, 2));
}

void main().finally(() => prisma.$disconnect());
