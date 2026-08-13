import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  computeSealedActionsHash,
  hashWithoutField,
  sha256Canonical,
  validateDecisionActionV1,
  validateOpenNovelNarrativeProjectionJobV1,
  validateWorldStateV1,
  withRunRouteHash,
  type DecisionActionV1,
  type NarrativeAudienceV1,
  type OpenNovelNarrativeProjectionJobV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  compileInitialWorldState,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import {
  buildGenesisAtomicRecord,
  buildGenesisCommitReceipt,
} from "../genesis";
import type {
  InitialRoleControlTopologyV1,
  StoredRunRouteRecordV1,
} from "../run-router";
import { PressureNarrativeAudienceProjectorV1 } from "../narrative";
import type { AuthoritativeNarrativeSnapshotCompilerPortV1 } from "../persistence";
import {
  loadSangtianNarrativeAuthorityCatalogV1,
  SANGTIAN_NARRATIVE_AUTHORITY_TARGET_V1 as TARGET,
  SangtianAuthoritativeNarrativeSnapshotCompilerV1,
  PressureNarrativeAuthorityErrorV1,
  type CommittedBeatNarrativeAuthorityV1,
} from "./index";

const HASH = (label: string): string => sha256Canonical({ label });
const PUBLIC: NarrativeAudienceV1 = { kind: "PUBLIC", seatId: null };
const GOVERNOR: NarrativeAudienceV1 = {
  kind: "SEAT",
  seatId: "zhejiang_governor",
};
const CABINET: NarrativeAudienceV1 = {
  kind: "SEAT",
  seatId: "cabinet_finance",
};
const MERCHANT: NarrativeAudienceV1 = {
  kind: "SEAT",
  seatId: "jiangnan_merchant",
};
const ADMINISTRATION: NarrativeAudienceV1 = {
  kind: "SEAT",
  seatId: "zhejiang_administration",
};

test("NA-01 loads only the final hash-pinned Sangtian content and presentation release", () => {
  const content = loadSangtianPressureChapterPackageV1();
  const release = loadPublishedSangtianActionReleaseV1();
  assert.equal(content.manifest.contentSha256, TARGET.contentPackageSha256);
  assert.equal(content.manifest.sourceCommitSha, TARGET.sourceCommitSha);
  assert.equal(
    release.catalog.catalogSha256,
    hashWithoutField(
      release.catalog as unknown as Record<string, unknown>,
      "catalogSha256",
    ),
  );
  assert.doesNotThrow(() => new SangtianAuthoritativeNarrativeSnapshotCompilerV1());
});

test("NA-02 Genesis derives exact public/seat ACLs and AudienceProjector cannot leak another seat", () => {
  const compiler = new SangtianAuthoritativeNarrativeSnapshotCompilerV1();
  const raw = genesisAuthority("narrative-genesis");
  const publicJob = boundJob(compiler, genesisJob(raw, PUBLIC), raw);
  const cabinetJob = boundJob(compiler, genesisJob(raw, CABINET), raw);
  const merchantJob = boundJob(compiler, genesisJob(raw, MERCHANT), raw);
  const administrationJob = boundJob(
    compiler,
    genesisJob(raw, ADMINISTRATION),
    raw,
  );

  assert.ok(publicJob.allowedKnowledgeIds.includes("P0-SF-03"));
  assert.ok(!publicJob.allowedKnowledgeIds.includes("P0-SF-01"));
  assert.ok(cabinetJob.allowedKnowledgeIds.includes("P0-SF-01"));
  assert.ok(!merchantJob.allowedKnowledgeIds.includes("P0-SF-01"));
  assert.ok(cabinetJob.allowedObjectVersionIds.some((id) =>
    id.startsWith("obj.cabinet_urgent_dispatch@")));
  assert.ok(!merchantJob.allowedObjectVersionIds.some((id) =>
    id.startsWith("obj.cabinet_urgent_dispatch@")));
  assert.ok(!administrationJob.allowedObjectVersionIds.some((id) =>
    id.startsWith("obj.breach_order_chain@")));

  const full = compiler.compile(cabinetJob, raw);
  assert.equal(
    sha256Canonical(full),
    sha256Canonical(compiler.compile(merchantJob, raw)),
    "the full server-side authority snapshot must not depend on the viewer",
  );
  const projected = new PressureNarrativeAudienceProjectorV1()
    .project(cabinetJob, full) as {
      knowledge: Array<{ knowledgeId: string }>;
      objects: Array<{ objectVersionId: string }>;
    };
  assert.ok(projected.knowledge.some((item) => item.knowledgeId === "P0-SF-01"));
  assert.ok(!projected.objects.some((item) =>
    item.objectVersionId.startsWith("obj.merchant_credit_network@")));
});

test("NA-03 any Genesis allowlist or authority hash drift fails closed", () => {
  const compiler = new SangtianAuthoritativeNarrativeSnapshotCompilerV1();
  const raw = genesisAuthority("narrative-genesis-tamper");
  const job = boundJob(compiler, genesisJob(raw, CABINET), raw);
  assert.throws(
    () => compiler.compile({
      ...job,
      allowedKnowledgeIds: [...job.allowedKnowledgeIds, "secret.not.authorized"].sort(),
    }, raw),
    (error) => isAuthorityError(error, "PRESSURE_NARRATIVE_AUTHORITY_AUDIENCE_ALLOWLIST_MISMATCH"),
  );
  assert.throws(
    () => compiler.compile({ ...job, sourceContentHash: HASH("wrong-world") }, raw),
    (error) => isAuthorityError(error, "PRESSURE_NARRATIVE_AUTHORITY_SOURCE_BINDING_MISMATCH"),
  );
});

test("NA-04 frozen chapter compiles from the current raw reader shape with viewer-safe knowledge", () => {
  const compiler = new SangtianAuthoritativeNarrativeSnapshotCompilerV1();
  const raw = chapterAuthority("narrative-chapter");
  const publicJob = boundJob(compiler, chapterJob(raw, PUBLIC), raw);
  const cabinetJob = boundJob(compiler, chapterJob(raw, CABINET), raw);
  const merchantJob = boundJob(compiler, chapterJob(raw, MERCHANT), raw);
  assert.ok(publicJob.allowedKnowledgeIds.includes("P0-SF-03"));
  assert.ok(!publicJob.allowedKnowledgeIds.includes("P0-SF-01"));
  assert.ok(cabinetJob.allowedKnowledgeIds.includes("P0-SF-01"));
  assert.ok(!merchantJob.allowedKnowledgeIds.includes("P0-SF-01"));
  assert.ok(cabinetJob.allowedKnowledgeIds.includes("seat.cabinet_finance.arc.sequence.1"));
  assert.ok(!merchantJob.allowedKnowledgeIds.includes("seat.cabinet_finance.arc.sequence.1"));

  const snapshot = compiler.compile(publicJob, raw) as {
    publicVariant: { kind: string; chapterId: string; committedWorldSequence: number; nextChapterId: string };
  };
  assert.deepEqual(snapshot.publicVariant, {
    kind: "CHAPTER",
    chapterId: "N1",
    committedWorldSequence: 1,
    nextChapterId: "N2",
  });
});

test("NA-05 committed Beat is deterministic under relation arrival order and uses frozen action presentation", () => {
  const compiler = new SangtianAuthoritativeNarrativeSnapshotCompilerV1();
  const raw = beatAuthority("narrative-beat");
  const reversed = {
    ...structuredClone(raw),
    sealedActions: [...raw.sealedActions].reverse(),
  };
  const job = boundJob(compiler, beatJob(raw, GOVERNOR), raw);
  const reversedJob = boundJob(compiler, beatJob(reversed, GOVERNOR), reversed);
  const first = compiler.compile(job, raw);
  const second = compiler.compile(reversedJob, reversed);
  assert.equal(sha256Canonical(first), sha256Canonical(second));

  const source = first as {
    facts: Array<{ factId: string; text: string; visibility: string; authorizedSeatIds: string[] }>;
  };
  const action = source.facts.find((item) => item.factId === "action.action-a");
  assert.ok(action);
  assert.match(action.text, /组织堰区疏散/u);
  assert.deepEqual(action.authorizedSeatIds, ["zhejiang_governor"]);

  const publicJob = boundJob(compiler, beatJob(raw, PUBLIC), raw);
  assert.ok(!publicJob.allowedFactIds.includes("action.action-a"));
  assert.ok(!publicJob.allowedFactIds.includes("working.evacuationCoveragePct"));
});

test("NA-06 the legacy four-field Beat raw shape fails closed instead of guessing chapter identity", () => {
  const compiler = new SangtianAuthoritativeNarrativeSnapshotCompilerV1();
  const raw = beatAuthority("narrative-beat-thin");
  const job = beatJob(raw, GOVERNOR);
  assert.throws(
    () => compiler.deriveAudienceAllowlist(job, {
      runId: raw.runId,
      resolutionHash: raw.resolutionHash,
      workingDeltaJson: raw.workingDelta,
      committedWorkingRevision: raw.committedWorkingRevision,
    }),
    (error) => isAuthorityError(error, "PRESSURE_NARRATIVE_AUTHORITY_BEAT_CONTEXT_MISSING"),
  );
});

test("NA-07 missing Beat decision presentation fails closed", () => {
  const compiler = new SangtianAuthoritativeNarrativeSnapshotCompilerV1();
  const raw = { ...beatAuthority("narrative-beat-presentation"), decisionPointKey: "N1.unknown" };
  const job = beatJob(raw, GOVERNOR);
  assert.throws(
    () => compiler.deriveAudienceAllowlist(job, raw),
    (error) => isAuthorityError(error, "PRESSURE_NARRATIVE_AUTHORITY_PRESENTATION_BINDING_MISSING"),
  );
});

test("NA-08 FINALE remains delegated to the existing compiler boundary", () => {
  const marker = { delegated: true };
  const delegate: AuthoritativeNarrativeSnapshotCompilerPortV1 = {
    compile(job, raw) {
      assert.equal(job.sourceAuthority, "FINALE_FROZEN");
      assert.deepEqual(raw, { terminal: true });
      return marker;
    },
  };
  const compiler = new SangtianAuthoritativeNarrativeSnapshotCompilerV1(
    undefined,
    delegate,
  );
  const job = validateOpenNovelNarrativeProjectionJobV1({
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: "finale-delegate",
    runId: "finale-run",
    audience: PUBLIC,
    sourceRuntimeProfile: TARGET.runtimeProfile,
    projectionKind: "FINALE_NARRATIVE",
    sourceAuthority: "FINALE_FROZEN",
    sourceId: "finale-source",
    sourceCommitHash: HASH("finale-commit"),
    sourceContentHash: HASH("finale-content"),
    allowedFactIds: [],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    narrativeProfileVersion: TARGET.narrativeProfileVersion,
    idempotencyKey: "finale-delegate-key",
  });
  assert.equal(compiler.compile(job, { terminal: true }), marker);
});

test("NA-09 a self-consistent but wrong presentation content binding fails closed", () => {
  const catalog = loadSangtianNarrativeAuthorityCatalogV1();
  const { catalogSha256: _oldHash, ...publishedCatalogBody } = catalog.release.catalog;
  const forgedBody = {
    ...structuredClone(publishedCatalogBody),
    sourceBinding: {
      ...structuredClone(publishedCatalogBody.sourceBinding),
      contentPackageSha256: HASH("wrong-presentation-content"),
    },
  };
  const forgedCatalog = {
    ...forgedBody,
    catalogSha256: sha256Canonical(forgedBody),
  };
  assert.throws(
    () => new SangtianAuthoritativeNarrativeSnapshotCompilerV1({
      package: catalog.package,
      release: {
        ...catalog.release,
        catalog: forgedCatalog,
      },
    }),
    (error) => isAuthorityError(
      error,
      "PRESSURE_NARRATIVE_AUTHORITY_RELEASE_BINDING_INVALID",
    ),
  );
});

function genesisAuthority(runId: string) {
  const loaded = loadSangtianPressureChapterPackageV1();
  const release = loadPublishedSangtianActionReleaseV1();
  const topologyBase: Omit<InitialRoleControlTopologyV1, "topologyHash"> = {
    schemaVersion: "pressure_initial_role_control_topology_v1",
    controlTopologyVersion: release.routeRegistration.controlTopologyVersion,
    participantMode: "SOLO",
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      seatId,
      mode: index === 0 ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  const controlTopology: InitialRoleControlTopologyV1 = {
    ...topologyBase,
    topologyHash: sha256Canonical(topologyBase),
  };
  const registration = release.routeRegistration;
  const snapshot = withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId,
    route: structuredClone(registration.route),
    contentPackageVersion: registration.contentPackageVersion,
    contentPackageSha256: registration.contentPackageSha256,
    orchestrationPackageVersion: registration.orchestrationPackageVersion,
    orchestrationPackageSha256: registration.orchestrationPackageSha256,
    runtimeContractVersion: registration.runtimeContractVersion,
    runtimeContractSha256: registration.runtimeContractSha256,
    testMatrixVersion: registration.testMatrixVersion,
    testMatrixSha256: registration.testMatrixSha256,
    runSeed: `seed-${runId}`,
    narrativeProfileVersion: registration.narrativeProfileVersion,
    featureSetVersion: registration.featureSetVersion,
    resultContractRegistryVersion: registration.resultContractRegistryVersion,
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [PRESSURE_CHAPTER_SEAT_IDS_V1[0]],
    controlTopologyVersion: registration.controlTopologyVersion,
    initialRoleControlSnapshotHash: controlTopology.topologyHash,
  });
  const routeBase: Omit<StoredRunRouteRecordV1, "recordHash"> = {
    schemaVersion: "pressure_stored_run_route_v1",
    runId,
    routeKey: registration.routeKey,
    registryVersion: "narrative-authority-test-registry-v1",
    registryHash: HASH("narrative-authority-test-registry"),
    handlerKey: registration.handlerKey,
    resultAdapterKey: registration.resultAdapterKey,
    presentationSchemaVersion: registration.presentationSchemaVersion,
    rendererKey: registration.rendererKey,
    createRequestFingerprint: HASH(`create:${runId}`),
    snapshot,
    controlTopology,
  };
  const route: StoredRunRouteRecordV1 = {
    ...routeBase,
    recordHash: sha256Canonical(routeBase),
  };
  const record = buildGenesisAtomicRecord(
    route,
    compileInitialWorldState(loaded),
    {
      runId,
      idempotencyKey: `genesis:${runId}`,
      requestFingerprint: HASH(`genesis:${runId}`),
    },
  );
  const committed = {
    record,
    receipt: buildGenesisCommitReceipt(record),
  };
  return {
    runId,
    commitManifestJson: committed,
    commitHash: record.commit.commitHash,
  };
}

function chapterAuthority(runId: string) {
  const world0 = compileInitialWorldState(loadSangtianPressureChapterPackageV1());
  const { stateHash: _oldHash, ...worldBody } = world0;
  const world = validateWorldStateV1({
    ...worldBody,
    worldSequence: 1,
    stateHash: sha256Canonical({ ...worldBody, worldSequence: 1 }),
  });
  const carryBody = {
    nextChapterId: "N2" as const,
    unlockedContentRefs: ["chapter.N2"],
    unresolvedCommitmentRefs: [],
    pendingConsequenceRefs: [],
  };
  return {
    runId,
    bundleHash: HASH(`bundle:${runId}`),
    frozenWorldStateJson: world,
    causalEdgesJson: [],
    carryForwardJson: {
      ...carryBody,
      carryForwardHash: sha256Canonical(carryBody),
    },
  };
}

function beatAuthority(runId: string): CommittedBeatNarrativeAuthorityV1 {
  const chapterRuntimeId = `chapter-runtime:${runId}`;
  const decisionPointId = `decision-point:${runId}`;
  const actions = [
    actionFixture({
      actionId: "action-a",
      runId,
      chapterRuntimeId,
      decisionPointId,
      seatId: "zhejiang_governor",
      actionType: "EVACUATE_WEIRS",
      ordinal: 1,
    }),
    actionFixture({
      actionId: "action-b",
      runId,
      chapterRuntimeId,
      decisionPointId,
      seatId: "qingliu_law",
      actionType: "SEAL_BREACH_RECORD",
      ordinal: 1,
    }),
  ];
  const workingDelta = {
    workingFactMutations: [
      { factRef: "evacuationCoveragePct", before: 0, after: 70 },
      { factRef: "verifiedBreachRecordCount", before: 0, after: 1 },
    ],
    commitmentMutations: [],
    knowledgeMutations: [],
    seatArcWorkingMutations: [],
  };
  const stateAfter = {
    schemaVersion: "pressure_chapter_working_state_v1" as const,
    runId,
    chapterId: "N1" as const,
    revision: 1,
    facts: {
      evacuationCoveragePct: 70,
      criticalWeirsSecuredCount: 0,
      verifiedBreachRecordCount: 1,
      disasterSeverity: 4,
    },
    counters: {},
    satisfiedRequirementIds: [],
    completedDecisionPointIds: [],
    settledReactions: [],
    lastBeatId: null,
  };
  const body = {
    schemaVersion: "sangtian_beat_resolution_v1" as const,
    runId,
    chapterRuntimeId,
    decisionPointId,
    baseWorkingRevision: 0,
    committedWorkingRevision: 1,
    inputWorkingStateHash: HASH(`working-before:${runId}`),
    sealedActionIds: actions.map((action) => action.actionId).sort(),
    sealedActionsHash: computeSealedActionsHash(actions),
    resolverVersion: "sangtian-beat-resolver-1.0.0",
    workingDelta,
    reservationMutations: [],
    reactionContextRef: null,
    nextDecisionContextRef: null,
  };
  return {
    schemaVersion: "pressure_committed_beat_narrative_authority_v1",
    runId,
    chapterRuntimeId,
    chapterId: "N1",
    decisionPointId,
    decisionPointKey: "N1.weir_crisis",
    baseWorkingRevision: body.baseWorkingRevision,
    committedWorkingRevision: body.committedWorkingRevision,
    inputWorkingStateHash: body.inputWorkingStateHash,
    sealedActionIds: body.sealedActionIds,
    sealedActionsHash: body.sealedActionsHash,
    sealedActions: actions,
    sealedActionAudiences: actions.map((action) => ({
      actionId: action.actionId,
      audienceSeatIds: action.seatId === "zhejiang_governor"
        ? ["zhejiang_governor"]
        : [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    })),
    resolverVersion: body.resolverVersion,
    workingDelta,
    workingDeltaHash: sha256Canonical(workingDelta),
    stateAfter,
    stateAfterHash: sha256Canonical(stateAfter),
    reservationMutations: [],
    reactionContextRef: null,
    nextDecisionContextRef: null,
    nextDecisionPin: null,
    resolutionHash: sha256Canonical(body),
    contentPackageSha256: TARGET.contentPackageSha256,
  };
}

function actionFixture(input: {
  actionId: string;
  runId: string;
  chapterRuntimeId: string;
  decisionPointId: string;
  seatId: DecisionActionV1["seatId"];
  actionType: string;
  ordinal: number;
}): DecisionActionV1 {
  const payload = {};
  const command = {
    runId: input.runId,
    chapterRuntimeId: input.chapterRuntimeId,
    decisionPointId: input.decisionPointId,
    seatId: input.seatId,
    controlEpoch: 0,
    expectedWorkingRevision: 0,
    actionOrdinal: input.ordinal,
    actionRevision: 1,
    actionType: input.actionType,
    payload,
  };
  const withoutSeal = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: input.actionId,
    ...command,
    chapterId: "N1" as const,
    status: "SEALED" as const,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: `action:${input.runId}:${input.actionId}`,
    requestFingerprint: computeDecisionActionRequestFingerprint(command),
  };
  return validateDecisionActionV1({
    ...withoutSeal,
    sealedHash: sha256Canonical(withoutSeal),
  });
}

function genesisJob(
  raw: ReturnType<typeof genesisAuthority>,
  audience: NarrativeAudienceV1,
): OpenNovelNarrativeProjectionJobV1 {
  const committed = raw.commitManifestJson;
  return jobBase({
    runId: raw.runId,
    audience,
    projectionKind: "GENESIS_NARRATIVE",
    sourceAuthority: "GENESIS_FROZEN",
    sourceId: committed.record.snapshot.genesisHash,
    sourceCommitHash: committed.record.commit.commitHash,
    sourceContentHash: committed.record.snapshot.initialWorldState.stateHash,
  });
}

function chapterJob(
  raw: ReturnType<typeof chapterAuthority>,
  audience: NarrativeAudienceV1,
): OpenNovelNarrativeProjectionJobV1 {
  return jobBase({
    runId: raw.runId,
    audience,
    projectionKind: "CHAPTER_NARRATIVE",
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: raw.bundleHash,
    sourceCommitHash: raw.bundleHash,
    sourceContentHash: raw.frozenWorldStateJson.stateHash,
  });
}

function beatJob(
  raw: Pick<
    CommittedBeatNarrativeAuthorityV1,
    "runId" | "resolutionHash" | "workingDeltaHash"
  >,
  audience: NarrativeAudienceV1,
): OpenNovelNarrativeProjectionJobV1 {
  return jobBase({
    runId: raw.runId,
    audience,
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: raw.resolutionHash,
    sourceCommitHash: raw.resolutionHash,
    sourceContentHash: raw.workingDeltaHash,
  });
}

function jobBase(input: {
  runId: string;
  audience: NarrativeAudienceV1;
  projectionKind: OpenNovelNarrativeProjectionJobV1["projectionKind"];
  sourceAuthority: OpenNovelNarrativeProjectionJobV1["sourceAuthority"];
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
}): OpenNovelNarrativeProjectionJobV1 {
  const audienceKey = input.audience.kind === "PUBLIC"
    ? "public"
    : input.audience.seatId!;
  return validateOpenNovelNarrativeProjectionJobV1({
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: `${input.projectionKind}:${input.runId}:${audienceKey}`,
    runId: input.runId,
    audience: input.audience,
    sourceRuntimeProfile: TARGET.runtimeProfile,
    projectionKind: input.projectionKind,
    sourceAuthority: input.sourceAuthority,
    sourceId: input.sourceId,
    sourceCommitHash: input.sourceCommitHash,
    sourceContentHash: input.sourceContentHash,
    allowedFactIds: [],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    narrativeProfileVersion: TARGET.narrativeProfileVersion,
    idempotencyKey: `${input.projectionKind}:${input.runId}:${audienceKey}:${input.sourceCommitHash}`,
  });
}

function boundJob(
  compiler: SangtianAuthoritativeNarrativeSnapshotCompilerV1,
  job: OpenNovelNarrativeProjectionJobV1,
  raw: Readonly<unknown>,
): OpenNovelNarrativeProjectionJobV1 {
  const allowlist = compiler.deriveAudienceAllowlist(job, raw);
  return validateOpenNovelNarrativeProjectionJobV1({
    ...job,
    allowedFactIds: allowlist.allowedFactIds,
    allowedObjectVersionIds: allowlist.allowedObjectVersionIds,
    allowedKnowledgeIds: allowlist.allowedKnowledgeIds,
  });
}

function isAuthorityError(error: unknown, code: string): boolean {
  return error instanceof PressureNarrativeAuthorityErrorV1 && error.code === code;
}
