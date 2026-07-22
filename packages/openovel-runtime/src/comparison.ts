import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileSoloStoryContext } from "../../../apps/api/src/solo-story-engine/context-compiler";
import type { ContextCompileInput } from "../../../apps/api/src/solo-story-engine/types";
import { prettyJson } from "./canonical";
import { compileShadowContext } from "./context-compiler";
import { compileEvidencePackage } from "./evidence-compiler";
import { openovelPaths } from "./paths";
import { compileWorldBible } from "./world-bible-compiler";
import type { ShadowRuntimeFixture } from "./types";

export function compareContexts(repoRoot?: string, fixtureOverride?: ShadowRuntimeFixture) {
  const paths = openovelPaths(repoRoot);
  const fixture = fixtureOverride || JSON.parse(readFileSync(paths.fixturePath, "utf8")) as ShadowRuntimeFixture;
  const evidencePackage = compileEvidencePackage(paths.repoRoot);
  const worldBible = compileWorldBible(paths.repoRoot, evidencePackage);
  const shadow = compileShadowContext(fixture, evidencePackage, worldBible);
  const legacyInput = {
    ...fixture,
    facts: worldBible.runtimeFacts,
    relevantScriptCards: worldBible.contextCards
  } as unknown as ContextCompileInput;
  const legacyResult = compileSoloStoryContext(legacyInput);
  if (!legacyResult.ok) throw new Error(`LEGACY_CONTEXT_COMPILE_FAILED: ${legacyResult.code}`);
  const legacy = legacyResult.context.renderedWorkingSet;
  const writerWorkingSet = shadow.renderedWriterWorkingSet;
  const forbiddenLegacy = fixture.forbiddenDisclosures.filter((term) => legacy.includes(term));
  const forbiddenShadow = fixture.forbiddenDisclosures.filter((term) => writerWorkingSet.includes(term));
  const report = {
    schemaVersion: "openovel_context_comparison_v2",
    fixtureId: fixture.fixtureId,
    generatedAt: new Date().toISOString(),
    gates: {
      shadowOnly: true,
      playerTrafficAffected: false,
      soloTakeoverEligible: false,
      multiplayerEligible: false,
      stageStatus: "READY_FOR_ONE_SHADOW_TURN"
    },
    legacy: {
      snapshotHash: legacyResult.context.snapshotHash,
      characterCount: legacy.length,
      estimatedTokens: Math.ceil(legacy.length / 2),
      sourceClaimCitationCount: countMatches(legacy, /DM1566-C\d{2}-CL\d{3}/g),
      epistemicLabelCount: countMatches(legacy, /(character_statement|character_belief|objective_event|objective_state|unverified|supported)/g),
      adaptationLabelCount: countMatches(legacy, /T3_ADAPTATION/g),
      playerActionLast: legacy.endsWith(`【玩家行动】${fixture.playerIntent.userFacingText}`),
      forbiddenDisclosureMatches: forbiddenLegacy
    },
    shadow: {
      snapshotHash: shadow.snapshotHash,
      characterCount: writerWorkingSet.length,
      estimatedTokens: Math.ceil(writerWorkingSet.length / 2),
      sourceClaimCitationCount: countMatches(writerWorkingSet, /DM1566-C\d{2}-CL\d{3}/g),
      epistemicLabelCount: countMatches(writerWorkingSet, /(character_statement|character_belief|objective_event|objective_state|unverified|supported)/g),
      adaptationLabelCount: countMatches(writerWorkingSet, /T3_ADAPTATION/g),
      auditSourceClaimCitationCount: countMatches(shadow.renderedWorkingSet, /DM1566-C\d{2}-CL\d{3}/g),
      auditEpistemicLabelCount: countMatches(shadow.renderedWorkingSet, /(character_statement|character_belief|objective_event|objective_state|unverified|supported)/g),
      validationPolicyLeakCount: countMatches(writerWorkingSet, /validationPatterns|stateLockAssertions|STATE_LOCKS_JSON|firstParagraphOnly|ACTION_RESTAGED_|UNCONFIRMED_/g),
      presetDecisionAnswerCount: countMatches(writerWorkingSet, /在簿册上具名接受巡抚的分责条件|划去簿册上巡抚的条件记录|立即落印放行文书/g),
      minimalCanonEntryCount: shadow.minimalCanonEntryIds.length,
      serverGroundingClaimCount: shadow.serverGrounding.evidenceClaimIds.length,
      causalArcCount: shadow.causalTurn.arcsAfter.length,
      npcReactionEnvelopeCount: shadow.causalTurn.npcReactionEnvelopes.length,
      allowedEventTypeCount: shadow.causalTurn.allowedEventEnvelope.allowedEventTypes.length,
      requiredEventTypeCount: shadow.causalTurn.allowedEventEnvelope.requiredEventTypes.length,
      decisionAffordanceCount: shadow.causalTurn.decisionAffordances.length,
      deterministicMaterialChange: shadow.causalTurn.deterministicMaterialChange.anyMaterialChange,
      playerActionLast: shadow.playerActionLast,
      forbiddenDisclosureMatches: forbiddenShadow,
      includedEvidenceClaimIds: shadow.includedEvidenceClaimIds,
      excludedEvidenceClaimIds: shadow.excludedEvidenceClaimIds
    },
    conclusions: [
      "The Writer receives semantic fact boundaries rather than machine validation rules.",
      "Line-addressed claims and epistemic labels remain in the server audit packet and are server-bound after generation.",
      "Recent Canon is reduced to a deduplicated minimum sufficient tail.",
      "The Causal Turn Engine supplies NPC reaction, allowed-event, and decision-affordance envelopes without prewriting visible answers.",
      "Writer event drafts are limited to server-compiled event types and are validated against the narration before any state projection.",
      "The comparison does not publish either context to a player or room."
    ],
    workingSets: { legacy, shadow: writerWorkingSet, shadowAudit: shadow.renderedWorkingSet }
  };
  return { fixture, evidencePackage, worldBible, shadow, legacyContext: legacyResult.context, report };
}

export function writeContextComparison(repoRoot?: string, fixtureOverride?: ShadowRuntimeFixture) {
  const paths = openovelPaths(repoRoot);
  const result = compareContexts(paths.repoRoot, fixtureOverride);
  mkdirSync(paths.outputRoot, { recursive: true });
  const jsonPath = join(paths.outputRoot, "context-comparison.json");
  const markdownPath = join(paths.outputRoot, "context-comparison.md");
  writeFileSync(jsonPath, prettyJson(result.report), "utf8");
  writeFileSync(markdownPath, renderMarkdown(result.report), "utf8");
  return { ...result, jsonPath, markdownPath };
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length || 0;
}

function renderMarkdown(report: ReturnType<typeof compareContexts>["report"]): string {
  return `# Old context vs Openovel shadow context\n\n` +
    `Fixture: \`${report.fixtureId}\`\n\n` +
    `| Metric | Legacy | Shadow |\n|---|---:|---:|\n` +
    `| Estimated tokens | ${report.legacy.estimatedTokens} | ${report.shadow.estimatedTokens} |\n` +
    `| Source claim citations | ${report.legacy.sourceClaimCitationCount} | ${report.shadow.sourceClaimCitationCount} |\n` +
    `| Epistemic labels | ${report.legacy.epistemicLabelCount} | ${report.shadow.epistemicLabelCount} |\n` +
    `| Adaptation labels | ${report.legacy.adaptationLabelCount} | ${report.shadow.adaptationLabelCount} |\n` +
    `| Player action last | ${report.legacy.playerActionLast} | ${report.shadow.playerActionLast} |\n` +
    `| Forbidden disclosure matches | ${report.legacy.forbiddenDisclosureMatches.length} | ${report.shadow.forbiddenDisclosureMatches.length} |\n\n` +
    `Shadow audit trace retains ${report.shadow.auditSourceClaimCitationCount} source-claim citations and ${report.shadow.auditEpistemicLabelCount} epistemic labels; server grounding binds ${report.shadow.serverGroundingClaimCount} claims after generation.\n\n` +
    `Causal shadow packet: ${report.shadow.causalArcCount} arcs, ${report.shadow.npcReactionEnvelopeCount} NPC envelopes, ${report.shadow.requiredEventTypeCount}/${report.shadow.allowedEventTypeCount} required/allowed event types, and ${report.shadow.decisionAffordanceCount} decision affordances. Deterministic material change: ${report.shadow.deterministicMaterialChange}.\n\n` +
    `Writer validation-policy leaks: ${report.shadow.validationPolicyLeakCount}; preset decision answers: ${report.shadow.presetDecisionAnswerCount}; minimal Canon entries: ${report.shadow.minimalCanonEntryCount}.\n\n` +
    `## Legacy working set\n\n\`\`\`text\n${report.workingSets.legacy}\n\`\`\`\n\n` +
    `## Shadow working set\n\n\`\`\`text\n${report.workingSets.shadow}\n\`\`\`\n`;
}
