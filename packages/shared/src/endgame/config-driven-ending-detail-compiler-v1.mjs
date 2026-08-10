import { createHash } from "node:crypto";
import { canonicalizeJcs } from "./endgame-package-v1.contract.mjs";
import { resolveFrozenEndgamePackageForRunV1 } from "./endgame-package-loader-v1.mjs";
import {
  assertEndgameAdjudicationV3,
  evaluateDerivedEndgameMetricsV1,
  finalizeEndgameAdjudicationV3
} from "./config-driven-endgame-adjudicator-v1.mjs";
import {
  collectCommittedEndgameFactsV1,
  assertEndgameFactStoreV1
} from "./endgame-fact-store-v1.mjs";
import {
  ConfigDrivenEndingDetailError,
  PLAYER_SAFE_VISIBILITIES,
  assertExactObject,
  compareText,
  deepFreeze,
  sortRecord
} from "./ending-detail-common-v1.mjs";
import {
  buildScoringProfiles,
  compileSlot,
  resolveScene,
  resolveStyle
} from "./ending-detail-selection-v1.mjs";
import {
  assertCompiledBlueprintEvidence,
  enforceMinimumVariation,
  enrichResolvedAxes
} from "./ending-detail-blueprint-support-v1.mjs";

export const ENDING_DETAIL_BLUEPRINT_SCHEMA_VERSION = "ending_detail_blueprint_v2";

const COMPILER_INPUT_KEYS = Object.freeze(["runPackageBinding", "adjudication", "factStore", "state"]);

export function compileConfigDrivenEndingDetailsV2(input) {
  assertExactObject(input, COMPILER_INPUT_KEYS, "detail compiler input");
  const { runPackageBinding, adjudication, factStore, state } = input;
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertEndgameAdjudicationV3(runPackageBinding, adjudication);
  assertEndgameFactStoreV1(runPackageBinding, factStore);
  const committedFacts = collectCommittedEndgameFactsV1({ runPackageBinding, factStore });
  const futureFact = committedFacts.find((fact) => fact.sourceRevision > adjudication.sourceRevision);
  if (futureFact) {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_FUTURE_FACT",
      "Facts committed after the frozen adjudication cannot enter its detail blueprint.",
      { factId: futureFact.factId, factSourceRevision: futureFact.sourceRevision, sourceRevision: adjudication.sourceRevision }
    );
  }

  const replayedAdjudication = finalizeEndgameAdjudicationV3({
    runPackageBinding,
    sourceRevision: adjudication.sourceRevision,
    metrics: adjudication.finalMetrics,
    state,
    facts: committedFacts
  });
  if (canonicalizeJcs(replayedAdjudication) !== canonicalizeJcs(adjudication)) {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_ADJUDICATION_INPUT_MISMATCH",
      "Detail compilation inputs do not replay to the frozen adjudication."
    );
  }

  const packageDocument = snapshot.packageDocument;
  const safeFacts = committedFacts.filter((fact) => PLAYER_SAFE_VISIBILITIES.has(fact.visibility));
  const derived = evaluateDerivedEndgameMetricsV1({
    definitions: packageDocument.derivedMetrics,
    metrics: adjudication.finalMetrics,
    state,
    facts: committedFacts
  });
  const axisOutcomes = Object.fromEntries(adjudication.resolvedAxes.map((axis) => [axis.axisId, axis.outcomeId]));
  const ruleContext = {
    metrics: derived.allMetrics,
    state,
    facts: safeFacts,
    axisOutcomes
  };
  const scoringProfiles = buildScoringProfiles(packageDocument.detailCompilation.scoringProfiles);
  const slots = {};
  const slotFactRefs = new Set();
  for (const slot of packageDocument.detailCompilation.slots.slice().sort((left, right) => compareText(left.slotId, right.slotId))) {
    const compiled = compileSlot(slot, safeFacts, scoringProfiles);
    slots[slot.slotId] = compiled.items;
    for (const factId of compiled.factRefs) slotFactRefs.add(factId);
  }

  const style = resolveStyle(packageDocument.detailCompilation.styleProfiles, ruleContext, safeFacts);
  const scene = resolveScene(packageDocument.detailCompilation.sceneArchetypes, ruleContext, safeFacts);
  const resolvedAxes = enrichResolvedAxes(packageDocument.outcomeAxes, adjudication.resolvedAxes);
  const allowedFactRefs = new Set(slotFactRefs);
  for (const factId of style?.evidenceRefs ?? []) allowedFactRefs.add(factId);
  for (const factId of scene.anchorFactRefs) allowedFactRefs.add(factId);

  enforceMinimumVariation({
    minimumVariation: packageDocument.detailCompilation.minimumVariation,
    slots,
    selectedFactIds: slotFactRefs,
    facts: safeFacts
  });

  const body = {
    schemaVersion: ENDING_DETAIL_BLUEPRINT_SCHEMA_VERSION,
    resolvedAxes,
    style,
    slots: sortRecord(slots),
    scene,
    allowedFactRefs: [...allowedFactRefs].sort(compareText),
    sourceRevision: adjudication.sourceRevision
  };
  const endingFingerprint = createHash("sha256")
    .update(Buffer.from(canonicalizeJcs({ packageRef: runPackageBinding.packageRef, blueprint: body }), "utf8"))
    .digest("hex");
  const blueprint = JSON.parse(canonicalizeJcs({ ...body, endingFingerprint }));
  assertCompiledBlueprintEvidence(blueprint, safeFacts);
  return deepFreeze(blueprint);
}
