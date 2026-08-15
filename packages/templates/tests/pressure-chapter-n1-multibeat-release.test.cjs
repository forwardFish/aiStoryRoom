const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const ROOT = resolve(__dirname, "../config/sangtian/pressure-chapter-v1");
const RELEASE = resolve(ROOT, "release");
const SOURCE_N1 = resolve(ROOT, "../pressure-spine-v1.0/source/nodes/N1");
const content = json(resolve(ROOT, "content.json"));
const manifest = json(resolve(ROOT, "manifest.json"));
const catalog = json(resolve(RELEASE, "action-presentation-catalog.json"));
const aiPolicy = json(resolve(RELEASE, "ai-decision-policy.json"));
const aEmotionPolicy = json(resolve(RELEASE, "a-emotion-policy.json"));
const orchestration = json(resolve(RELEASE, "orchestration-package.json"));
const runtimeContract = json(resolve(RELEASE, "runtime-contract.json"));
const releaseManifest = json(resolve(RELEASE, "release-manifest.json"));
const authoring = json(resolve(ROOT, "authoring/n1-multibeat-authoring-v1.json"));
const bindings = json(resolve(ROOT, "authoring/n1-beat-bindings-v1.json"));
const adaptation = json(resolve(ROOT, "authoring/n1-decision-effects-v1.json"));
const nodeSource = json(resolve(SOURCE_N1, "node.json"));
const sceneFlow = json(resolve(SOURCE_N1, "scene-flow.json"));
const core = require(resolve(RELEASE, "action-effect-compiler.cjs"));
const effectPolicy = core.loadSangtianActionEffectPolicyV1({ releaseRoot: RELEASE });
core.loadSangtianActionPresentationCatalogV1({ releaseRoot: RELEASE });

const seats = [
  "cabinet_finance", "jiangnan_merchant", "qingliu_law",
  "sili_weaving", "zhejiang_administration", "zhejiang_governor",
];
const n1 = content.chapters.find((chapter) => chapter.chapterId === "N1");
const catalogN1 = catalog.chapters.find((chapter) => chapter.chapterId === "N1");
const effectN1 = effectPolicy.chapterPolicies.find((chapter) => chapter.chapterId === "N1");

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function canonical(value) {
  if (value === null) return "null";
  if (["string", "boolean"].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function sha(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}
function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

class PublishedDecisionContractProbe {
  constructor(decisions) {
    this.decisions = decisions;
    this.completed = new Set();
    this.counts = new Map();
    this.committedFacts = new Set();
  }
  current() {
    return this.decisions.find((decision) => !this.completed.has(decision.decisionPointKey)) ?? null;
  }
  submit(decisionPointKey, seatId, actionType) {
    const current = this.current();
    if (!current || current.decisionPointKey !== decisionPointKey) throw new Error("DECISION_NOT_ACTIVE");
    if (!current.requiredSeatIds.includes(seatId)) throw new Error("SEAT_NOT_REQUIRED");
    if (!current.allowedActionTypes.includes(actionType)) throw new Error("ACTION_NOT_ALLOWED");
    const key = `${decisionPointKey}|${seatId}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    if (next > current.perSeatActionBudget) throw new Error("ACTION_BUDGET_EXCEEDED");
    this.counts.set(key, next);
  }
  close(decisionPointKey) {
    const current = this.current();
    if (!current || current.decisionPointKey !== decisionPointKey) throw new Error("DECISION_ALREADY_COMPLETED");
    this.completed.add(decisionPointKey);
    this.committedFacts.add(current.closeFactRef);
  }
  chapterExitReady() {
    return this.committedFacts.has(n1.closePolicy.exitPredicate.factRef);
  }
}

test("author-approved adaptation expands the two macro source beats into eight executable identities without changing authority algorithms", () => {
  assert.deepEqual(
    sceneFlow.decisionBeats.map((beat) => beat.beatId),
    ["beat.n1.prepare", "beat.n1.commit"],
  );
  assert.deepEqual(nodeSource.actionBudget, {
    preparePerSeat: 1,
    commitPerSeat: 1,
    reactionPerSeat: 0,
  });
  assert.equal(adaptation.adaptationDecision.adaptationId, "adapt.n1.multibeat.v1");
  assert.equal(
    adaptation.adaptationDecision.authorization,
    "N1_MULTIBEAT_GOAL_M1_PROJECT_OWNER_AUTHOR_APPROVAL",
  );
  assert.deepEqual(
    adaptation.adaptationDecision.sourceMacroDecisionBeatIds,
    sceneFlow.decisionBeats.map((beat) => beat.beatId),
  );
  assert.deepEqual(
    adaptation.adaptationDecision.expandedBeatIds,
    authoring.beats.map((beat) => beat.beatId),
  );
  assert.equal(adaptation.adaptationDecision.perDecisionSeatActionBudget, 1);
  assert.equal(adaptation.adaptationDecision.mayChangeActionGuardAlgorithm, false);
  assert.equal(adaptation.adaptationDecision.mayChangeAiSelectionAlgorithm, false);
  assert.equal(adaptation.adaptationDecision.mayChangeSettlementBranchSelectors, false);
  assert.equal(adaptation.authorityBoundary.resourceMutationAllowed, false);
  assert.equal(adaptation.authorityBoundary.trackDeltaWriteAllowed, false);
  assert.equal(adaptation.authorityBoundary.outcomeBandSelectionAllowed, false);
});

test("N1 B01-B08 close content, presentation, effect, adaptation, and six-seat zero-Provider AI bindings", () => {
  assert.equal(n1.decisionPoints.length, 8);
  assert.deepEqual(n1.decisionPoints.map((point) => point.ordinal), [1,2,3,4,5,6,7,8]);
  assert.equal(new Set(n1.decisionPoints.map((point) => point.decisionPointKey)).size, 8);
  assert.equal(authoring.beats.length, 8);
  assert.equal(bindings.decisionContracts.length, 8);
  assert.equal(adaptation.decisions.length, 8);

  const allWorkingRefs = new Set();
  n1.decisionPoints.forEach((decision, index) => {
    const beat = authoring.beats[index];
    const binding = bindings.decisionContracts[index];
    const authored = adaptation.decisions[index];
    assert.equal(beat.beatId, `N1.B${String(index + 1).padStart(2, "0")}`);
    assert.equal(binding.decisionContractRef, beat.decisionContractRef);
    assert.equal(authored.decisionContractRef, beat.decisionContractRef);
    assert.equal(binding.catalogDecisionPointRef, decision.decisionPointKey);
    assert.equal(authored.decisionPointId, decision.decisionPointKey);
    assert.equal(authored.activation.closeFactRef, decision.closeFactRef);
    assert.equal(decision.perSeatActionBudget, 1);
    assert.deepEqual(decision.requiredSeatIds, seats);
    assert.deepEqual(decision.allowedWorkingDeltaTypes, ["KNOWLEDGE"]);
    assert.deepEqual(decision.reaction, { enabled: false, eligibleSeatIds: [], triggerFactRef: null });
    assert.equal(decision.sourceRefs.some((ref) => ref.includes("n1-decision-effects-v1.json")), true);

    const previous = index === 0 ? null : n1.decisionPoints[index - 1].closeFactRef;
    assert.equal(authored.activation.requiredPreviousCloseFactRef, previous);
    assert.equal(authored.activation.selectionRule, "SOURCE_ORDER_AFTER_COMPLETED_DECISION");
    for (const materialRef of authored.sourceMaterialRefs) {
      assert.equal(beat.sourceMaterialRefs.includes(materialRef), true, `${beat.beatId}: ${materialRef}`);
    }

    const presentation = catalogN1.decisions.find((item) => item.decisionPointKey === decision.decisionPointKey);
    const effect = effectN1.decisions.find((item) => item.decisionPointKey === decision.decisionPointKey);
    const ai = aiPolicy.decisions.find((item) => item.decisionPointId === decision.decisionPointKey);
    assert.ok(presentation && effect && ai);
    assert.deepEqual(presentation.actions.map((item) => item.actionType), decision.allowedActionTypes);
    assert.deepEqual(effect.actions.map((item) => item.actionType), decision.allowedActionTypes);
    assert.deepEqual(ai.publishedAllowedActionTypes, decision.allowedActionTypes);
    assert.deepEqual(authored.actions.map((item) => item.actionType), decision.allowedActionTypes);
    assert.deepEqual(ai.seatPolicies.map((item) => item.seatId), seats);

    const visibleActions = decision.allowedActionTypes.filter((item) => item !== "DEFAULT_PASS");
    assert.ok(visibleActions.length >= 2 && visibleActions.length <= 3);
    for (const seatId of seats) {
      assert.deepEqual(
        ai.seatPolicies.find((item) => item.seatId === seatId).rankedNonDefaultActionTypes,
        visibleActions,
      );
      for (const actionType of decision.allowedActionTypes) {
        const compiled = core.compileSangtianActionBindingV1(effectPolicy, {
          chapterId: "N1", decisionPointKey: decision.decisionPointKey, seatId, actionType,
        });
        assert.equal(compiled.resourcePolicy, "NONE");
        assert.deepEqual(compiled.workingIntent.resourceReservations, []);
        assert.deepEqual(compiled.workingIntent.commitmentMutations, []);
        if (actionType === "DEFAULT_PASS") {
          assert.deepEqual(compiled.workingIntent.knowledgeGrants, []);
        } else {
          assert.equal(compiled.workingIntent.knowledgeGrants.length, 6);
          const refs = new Set(compiled.workingIntent.knowledgeGrants.flatMap((grant) => grant.factRefs));
          assert.equal(refs.size, 1);
          const ref = [...refs][0];
          assert.match(ref, /^working\.N1\./);
          if (seatId === seats[0]) {
            assert.equal(allWorkingRefs.has(ref), false, `working fact reused: ${ref}`);
            allWorkingRefs.add(ref);
          } else {
            assert.equal(allWorkingRefs.has(ref), true);
          }
        }
      }
    }
  });
  const expectedNonDefaultCount = n1.decisionPoints.reduce(
    (count, decision) => count + decision.allowedActionTypes.filter((item) => item !== "DEFAULT_PASS").length,
    0,
  );
  assert.equal(allWorkingRefs.size, expectedNonDefaultCount);

  assert.deepEqual(aiPolicy.selectionAlgorithm, {
    kind: "SHA256_CANONICAL_PREFIX_MODULO_RANKED_NON_DEFAULT_V1",
    digestWindow: "FIRST_8_HEX_UINT32_BE",
    rankingSource: "PUBLISHED_POLICY_EXACT_ORDER",
    defaultActionType: "DEFAULT_PASS",
  });
  assert.equal(aiPolicy.authorityBoundary.mayCreateActionTypes, false);
  assert.equal(aiPolicy.authorityBoundary.mayCompileWorkingIntent, false);
  assert.equal(aiPolicy.authorityBoundary.maySupplySettlementFacts, false);
  assert.equal(aiPolicy.authorityBoundary.unknownBindingPolicy, "FAIL_CLOSED");
  assert.equal(aiPolicy.authorityBoundary.eligibleSetMismatchPolicy, "FAIL_CLOSED");
});

test("B01-B07 advance only to the next authority pin; B08 alone makes N1 exit and summary ready", () => {
  const probe = new PublishedDecisionContractProbe(n1.decisionPoints);
  n1.decisionPoints.forEach((decision, index) => {
    assert.equal(probe.current().decisionPointKey, decision.decisionPointKey);
    assert.equal(probe.chapterExitReady(), false);
    for (const seatId of seats) {
      probe.submit(decision.decisionPointKey, seatId, decision.allowedActionTypes.find((item) => item !== "DEFAULT_PASS"));
    }
    assert.throws(
      () => probe.submit(decision.decisionPointKey, seats[0], decision.allowedActionTypes[0]),
      /ACTION_BUDGET_EXCEEDED/,
    );
    probe.close(decision.decisionPointKey);
    assert.throws(() => probe.close(decision.decisionPointKey), /DECISION_ALREADY_COMPLETED/);
    const binding = bindings.decisionContracts[index];
    if (index < 7) {
      assert.equal(binding.advanceCondition.kind, "AUTHORITY_NEXT_DECISION_PIN");
      assert.deepEqual(
        binding.advanceCondition.successorDecisionContractRefs,
        [bindings.decisionContracts[index + 1].decisionContractRef],
      );
      assert.equal(probe.current().decisionPointKey, n1.decisionPoints[index + 1].decisionPointKey);
      assert.equal(probe.chapterExitReady(), false);
    } else {
      assert.equal(binding.advanceCondition.kind, "CHAPTER_SUMMARY_READY");
      assert.deepEqual(binding.advanceCondition.successorDecisionContractRefs, []);
      assert.equal(probe.current(), null);
      assert.equal(probe.chapterExitReady(), true);
    }
  });
});

test("unknown decision/action, repeated decision, and per-decision budget exhaustion fail closed", () => {
  const probe = new PublishedDecisionContractProbe(n1.decisionPoints);
  const first = n1.decisionPoints[0];
  assert.throws(() => probe.submit("N1.unknown", seats[0], first.allowedActionTypes[1]), /DECISION_NOT_ACTIVE/);
  assert.throws(() => probe.submit(first.decisionPointKey, seats[0], "INVENTED_ACTION"), /ACTION_NOT_ALLOWED/);
  probe.submit(first.decisionPointKey, seats[0], first.allowedActionTypes[1]);
  assert.throws(() => probe.submit(first.decisionPointKey, seats[0], first.allowedActionTypes[2]), /ACTION_BUDGET_EXCEEDED/);
  assert.throws(() => core.compileSangtianActionBindingV1(effectPolicy, {
    chapterId: "N1", decisionPointKey: "N1.unknown", seatId: seats[0], actionType: "DEFAULT_PASS",
  }), /SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND/);
  assert.throws(() => core.compileSangtianActionBindingV1(effectPolicy, {
    chapterId: "N1", decisionPointKey: first.decisionPointKey, seatId: seats[0], actionType: "INVENTED_ACTION",
  }), /SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND/);
  assert.equal(aiPolicy.decisions.some((item) => item.decisionPointId === "N1.unknown"), false);
});

test("eight beats compile only Working knowledge and the original four N1 Settlement selector facts", () => {
  const confirmedActions = n1.decisionPoints.map((decision, index) => ({
    actionId: `action-${index}`,
    decisionPointKey: decision.decisionPointKey,
    seatId: seats[index % seats.length],
    actionType: decision.allowedActionTypes.find((item) => item !== "DEFAULT_PASS"),
  }));
  const compiled = core.compileSangtianChapterActionEffectsV1(effectPolicy, {
    chapterId: "N1", confirmedActions, defaultEvents: [],
  });
  assert.deepEqual(compiled.resourceReservationMutations, []);
  assert.deepEqual(compiled.chapterEndResourceDispositions, []);
  assert.deepEqual(Object.keys(compiled.settlementFacts).sort(), [
    "criticalWeirsSecuredCount", "disasterSeverity", "evacuationCoveragePct", "verifiedBreachRecordCount",
  ]);
  assert.equal(effectN1.decisions.some((decision) =>
    decision.actions.some((action) => "trackDelta" in action || "outcomeBand" in action || "resourceMutations" in action)), false);
  assert.equal(effectN1.settlementOutputBinding.trackDeltaAuthority, "ACCEPTED_CONTENT_SELECTED_BRANCH");
  assert.equal(adaptation.authorityBoundary.settlementAuthority, "sangtian.N1.settlement_v1");
  assert.equal(adaptation.authorityBoundary.trackDeltaWriteAllowed, false);
  assert.equal(adaptation.authorityBoundary.outcomeBandSelectionAllowed, false);
});

test("published canonical hashes bind authoring, content, policies, orchestration, runtime, and route registry", () => {
  assert.equal(sha(content), manifest.contentSha256);
  assert.equal(sha(without(manifest, "manifestSha256")), manifest.manifestSha256);
  assert.equal(sha(without(catalog, "catalogSha256")), catalog.catalogSha256);
  assert.equal(sha(without(effectPolicy, "policySha256")), effectPolicy.policySha256);
  assert.equal(sha(without(aiPolicy, "policySha256")), aiPolicy.policySha256);
  assert.equal(sha(without(aEmotionPolicy, "policySha256")), aEmotionPolicy.policySha256);
  assert.equal(sha(without(releaseManifest.routeRegistry, "registryHash")), releaseManifest.routeRegistry.registryHash);

  const route = releaseManifest.routeRegistry.routes[0];
  assert.equal(route.contentPackageSha256, sha(content));
  assert.equal(route.orchestrationPackageSha256, sha(orchestration));
  assert.equal(route.runtimeContractSha256, sha(runtimeContract));
  assert.equal(orchestration.actionCompilation.policySha256, effectPolicy.policySha256);
  assert.equal(orchestration.actionPresentation.catalogSha256, catalog.catalogSha256);
  assert.equal(orchestration.aiDecisionPolicy.policySha256, aiPolicy.policySha256);

  for (const artifact of [...releaseManifest.immutableInputs, ...releaseManifest.artifacts]
    .filter((item) => item.hashMode === "CANONICAL_JSON")) {
    const base = releaseManifest.immutableInputs.includes(artifact) ? RELEASE : RELEASE;
    assert.equal(sha(json(resolve(base, artifact.path))), artifact.sha256, artifact.artifactId);
  }
});
