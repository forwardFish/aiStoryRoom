import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prettyJson, sha256Canonical } from "../canonical";
import { compareContexts } from "../comparison";
import { openovelPaths } from "../paths";
import { buildLandRecordReviewFixture, type PriorShadowArtifact } from "../selected-decision-transition";
import { buildShadowTurnPrompt } from "../shadow-prompt";

function main(): void {
  const paths = openovelPaths();
  const priorArtifactId = String(process.env.OPENOVEL_PRIOR_ARTIFACT_ID || "").trim();
  if (!priorArtifactId) throw new Error("OPENOVEL_PRIOR_ARTIFACT_ID is required for land-record preflight.");
  const priorPath = join(paths.outputRoot, `${priorArtifactId}.json`);
  const prior = JSON.parse(readFileSync(priorPath, "utf8")) as PriorShadowArtifact;
  const fixture = buildLandRecordReviewFixture(prior, "d1");
  const result = compareContexts(paths.repoRoot, fixture);
  const prompt = buildShadowTurnPrompt(result.shadow, fixture);
  const combined = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
  const schemaChars = JSON.stringify(prompt.outputSchema).length;
  const checks = {
    causalMaterialChange: result.shadow.causalTurn.deterministicMaterialChange.anyMaterialChange,
    reactionEnvelopePresent: result.shadow.causalTurn.npcReactionEnvelopes.length > 0,
    requiredEventsPresent: result.shadow.causalTurn.allowedEventEnvelope.requiredEventTypes.length > 0,
    affordancesSufficient: result.shadow.causalTurn.decisionAffordances.length >= fixture.narrativeFrame.decisionPolicy.minimum,
    playerActionLast: result.shadow.playerActionLast,
    serverMetadataAbsent: !/actorRef|targetRefs|affordanceId|decisionClass|basisAffordanceId/u.test(combined),
    validatorPolicyAbsent: !/validationPatterns|stateLockAssertions|ACTION_RESTAGED_|UNCONFIRMED_/u.test(combined),
      systemPromptCompact: prompt.systemPrompt.length < 1100,
    userPromptCompact: prompt.userPrompt.length < 6000,
    outputSchemaCompact: schemaChars < 2200,
    shadowOnly: result.shadow.soloTakeoverEligible === false
  };
  const preflight = {
    schemaVersion: "openovel_land_record_preflight_v1",
    generatedAt: new Date().toISOString(),
    priorArtifactId,
    fixtureId: fixture.fixtureId,
    checks,
    ok: Object.values(checks).every(Boolean),
    metrics: {
      systemChars: prompt.systemPrompt.length,
      userChars: prompt.userPrompt.length,
      schemaChars,
      writerTokenEstimate: result.shadow.tokenEstimate,
      causalArcCount: result.shadow.causalTurn.arcsAfter.length,
      npcReactionEnvelopeCount: result.shadow.causalTurn.npcReactionEnvelopes.length,
      requiredEventTypes: result.shadow.causalTurn.allowedEventEnvelope.requiredEventTypes,
      decisionAffordanceIds: result.shadow.causalTurn.decisionAffordances.map((item) => item.affordanceId)
    },
    hashes: {
      contextSnapshotHash: result.shadow.snapshotHash,
      causalArcSnapshotHash: result.shadow.causalTurn.snapshotHash,
      affordanceSnapshotHash: result.shadow.causalTurn.affordanceSnapshotHash,
      allowedEventEnvelopeHash: result.shadow.causalTurn.allowedEventEnvelopeHash,
      promptHash: sha256Canonical(prompt)
    },
    gates: {
      providerCalled: false,
      playerTrafficAffected: false,
      databaseTouched: false,
      soloTakeoverEligible: false,
      multiplayerEligible: false
    },
    comparison: result.report,
    prompt
  };
  mkdirSync(paths.outputRoot, { recursive: true });
  const outputPath = join(paths.outputRoot, "land-record-preflight.json");
  writeFileSync(outputPath, prettyJson(preflight), "utf8");
  if (!preflight.ok) {
    console.error(`LAND_RECORD_PREFLIGHT_FAIL path=${outputPath}`);
    for (const [name, passed] of Object.entries(checks)) if (!passed) console.error(`CHECK_FAIL ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`LAND_RECORD_PREFLIGHT_PASS systemChars=${preflight.metrics.systemChars} userChars=${preflight.metrics.userChars} schemaChars=${schemaChars} writerTokens=${preflight.metrics.writerTokenEstimate} path=${outputPath}`);
  console.log("PROVIDER_CALLED=false SOLO_TAKEOVER=false MULTIPLAYER=false");
}

main();
