import assert from "node:assert/strict";
import test from "node:test";
import { PRESSURE_CHAPTER_SEAT_IDS_V1, sha256Canonical } from "@ai-story/shared";
import { emptySeatEnvelope } from "../seat-control-persistence/envelope";
import {
  compileInitialWorldState,
  loadPublishedSangtianAEmotionPolicyV1,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import type { PrismaService } from "../../prisma.service";
import {
  PressureChapterRunRouterService,
  type RunRouteRepositoryPort,
  type StoredRunRouteRecordV1,
} from "../run-router";
import { createPublishedSangtianRouteRegistryPortV1 } from "../integration";
import { buildGenesisAtomicRecord, buildGenesisCommitReceipt } from "../genesis";
import { buildPressureMvpDecisionStateV1 } from "../persistence/mvp-decision-state";
import { PressureGenericFinaleShadowReadOnlyAdapterV1 } from "../generic-shadow";
import {
  AuthoritativePressureReplayTargetRouteResolverV1,
  PrismaPressureReplayNewTargetFactoryV1,
  SangtianPressureReplayPolicyV1,
  createPressureReplayProductionBundleV1,
} from "../replay-production";
import {
  ContentBoundSeatPrivateProjectionPortV1,
  compileSangtianSeatPrivateProjectionFromCapturedAuthoritiesV1,
  FailClosedSangtianAEmotionObserverResolverV1,
  FrozenAEmotionPresentationAdapterV1,
  FrozenSangtianFinaleConfigurationResolverV1,
  PrismaAEmotionSeatDeliveryBindingAdapterV1,
  PrismaAuthoritativeChapterWorldReaderV1,
  PrismaDeterministicDefaultAuthorityAdapterV1,
  PrismaDurableN7FinaleHandoffReaderV1,
  PrismaProductPressureGameCapabilityReaderV1,
  SangtianFrozenSeatPresentationCatalogV1,
  createPressureChapterInternalProductionPortsV1,
  readPinnedPressureRouteV1,
} from ".";

class RouteRepository implements RunRouteRepositoryPort {
  value: StoredRunRouteRecordV1 | null = null;

  async findByRunId() {
    return this.value ? structuredClone(this.value) : null;
  }

  async insertIfAbsent(record: StoredRunRouteRecordV1) {
    if (!this.value) this.value = structuredClone(record);
    return { status: "INSERTED" as const, record: structuredClone(this.value) };
  }
}

function makeSeatSnapshot(
  runId: string,
  routeHash: string,
  stateHash: string,
  controlEpoch: number,
  activeController: () => string,
  genesisHash = sha256Canonical("product-genesis"),
) {
  const policyBase = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "seat-policy-v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline-policy",
    takeoverDeadlinePolicyHash: sha256Canonical("deadline-policy"),
    deterministicDefaultPolicyRef: "default-policy",
    deterministicDefaultPolicyHash: sha256Canonical("default-policy"),
    humanReclaimAllowed: true,
  };
  return {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId,
    participantMode: "SOLO" as const,
    routeHash,
    genesisHash,
    genesisAtomicRecordHash: sha256Canonical("genesis-record"),
    initialTopologyHash: sha256Canonical("topology"),
    controlTopologyVersion: "six-seat-control-v1",
    frozenPolicy: { ...policyBase, policyHash: sha256Canonical(policyBase) },
    stateRevision: 3,
    timelineLength: 7,
    timelineHeadHash: sha256Canonical("timeline"),
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const designatedAiControllerId = seatId === "zhejiang_governor"
        ? "ai:run-product-adapters:zhejiang-governor"
        : `ai:${seatId}`;
      return {
        seatId,
        mode: "AI_ACTIVE" as const,
        originalHumanControllerId: null,
        designatedAiControllerId,
        activeControllerId: seatId === "zhejiang_governor"
          ? activeController()
          : designatedAiControllerId,
        controlEpoch,
        submissionFenceToken: sha256Canonical(`${seatId}:submit`),
        reclaimFenceToken: null,
        lastAuthorityEventHash: sha256Canonical(`${seatId}:event`),
      };
    }),
    initializationInputHash: sha256Canonical("init"),
    stateHash,
  };
}

async function publishedRoute(): Promise<StoredRunRouteRecordV1> {
  const release = loadPublishedSangtianActionReleaseV1();
  const repository = new RouteRepository();
  const router = new PressureChapterRunRouterService(
    repository,
    createPublishedSangtianRouteRegistryPortV1(release.routeConfiguration),
  );
  return (await router.create({
    runId: "run-product-adapters",
    routeKey: release.route.routeKey,
    participantMode: "SOLO",
    humanSeatIdsAtStart: ["zhejiang_governor"],
    runSeed: "product-adapters-seed",
  })).route;
}

test("pinned route reader accepts only the published lossless route", async () => {
  const route = await publishedRoute();
  const client = {
    pressureRunRouteSnapshot: {
      findUnique: async () => ({
        runId: route.runId,
        routeHash: route.snapshot.routeHash,
        routeJson: structuredClone(route),
      }),
    },
  };
  const read = await readPinnedPressureRouteV1(client, route.runId, route.snapshot.routeHash);
  assert.equal(read.recordHash, route.recordHash);

  const { recordHash: _oldHash, ...withoutHash } = route;
  const tamperedBase = { ...withoutHash, registryHash: sha256Canonical("unpublished-registry") };
  const tampered = { ...tamperedBase, recordHash: sha256Canonical(tamperedBase) };
  client.pressureRunRouteSnapshot.findUnique = async () => ({
    runId: route.runId,
    routeHash: route.snapshot.routeHash,
    routeJson: tampered,
  });
  await assert.rejects(
    () => readPinnedPressureRouteV1(client, route.runId),
    /PRESSURE_PRODUCT_AUTHORITY_MISMATCH/,
  );
});

test("latest replay target is derived from the hash-verified published release", async () => {
  const replay = createPressureReplayProductionBundleV1({} as PrismaService);
  const target = await replay.replayTargetRouteResolver
    .resolveLatestPressureRoute("source-run", "MULTIPLAYER");
  assert.ok(target && typeof target === "object");
  assert.equal(target.sourceRunId, "source-run");
  assert.equal(target.participantMode, "MULTIPLAYER");
  assert.equal(target.targetExperience, "LATEST_REGISTERED_ROUTE");
  assert.equal(
    target.pinnedRegistration.registration.route.runtimeProfile,
    "SANGTIAN_CONTINUOUS_CHAPTER_V1",
  );
});

test("authoritative world reader returns Genesis only under exact route/hash/sequence fences", async () => {
  const route = await publishedRoute();
  const world = compileInitialWorldState(loadSangtianPressureChapterPackageV1());
  const record = buildGenesisAtomicRecord(route, world, {
    runId: route.runId,
    idempotencyKey: "genesis:product-adapters",
    requestFingerprint: sha256Canonical("genesis-request"),
  });
  const committed = { record, receipt: buildGenesisCommitReceipt(record) };
  const tx = {
    pressureRunRouteSnapshot: {
      findUnique: async () => ({
        runId: route.runId,
        routeHash: route.snapshot.routeHash,
        routeJson: route,
      }),
    },
    pressureGenesisCommit: {
      findUnique: async () => ({ runId: route.runId, commitManifestJson: committed }),
    },
    pressureChapterSettlement: {
      findUnique: async () => null,
    },
  };
  const prisma = {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
  } as unknown as PrismaService;
  const reader = new PrismaAuthoritativeChapterWorldReaderV1(prisma);
  const source = await reader.readAuthorityBase({
    runId: route.runId,
    routeHash: route.snapshot.routeHash,
    baseWorldSequence: 0,
    baseWorldStateHash: world.stateHash,
    previousFrozenHash: record.snapshot.genesisHash,
  });
  assert.equal(source?.sourceFrozenHash, record.snapshot.genesisHash);
  assert.equal(source?.worldState.stateHash, world.stateHash);
  await assert.rejects(
    () => reader.readAuthorityBase({
      runId: route.runId,
      routeHash: route.snapshot.routeHash,
      baseWorldSequence: 0,
      baseWorldStateHash: sha256Canonical("wrong-world"),
      previousFrozenHash: record.snapshot.genesisHash,
    }),
    /PRESSURE_PRODUCT_AUTHORITY_MISMATCH.*BASE_BINDING/,
  );
});

test("deterministic default authority returns only the current designated AI controller", async () => {
  const route = await publishedRoute();
  const authorityStateHash = sha256Canonical("seat-authority-current");
  const directiveBase = {
    schemaVersion: "pressure_seat_default_directive_v1" as const,
    runId: route.runId,
    decisionPointId: "decision.N1.1",
    seatId: "zhejiang_governor" as const,
    controlEpoch: 2,
    trigger: "HUMAN_DEADLINE" as const,
    defaultPolicyRef: "sangtian.default.absence.v1",
    defaultPolicyHash: sha256Canonical("default-policy"),
    canonicalActionPayloadHash: sha256Canonical("default-payload"),
    sourceProofHash: sha256Canonical("default-proof"),
    authorityStateHash,
    idempotencyKey: "default:N1:governor",
    requestFingerprint: sha256Canonical("default-request"),
  };
  const directive = {
    ...directiveBase,
    directiveHash: sha256Canonical(directiveBase),
  };
  let activeControllerId = "ai:run-product-adapters:zhejiang-governor";
  const seatSnapshot = makeSeatSnapshot(
    route.runId,
    route.snapshot.routeHash,
    authorityStateHash,
    directive.controlEpoch,
    () => activeControllerId,
  );
  const envelope = emptySeatEnvelope(seatSnapshot);
  envelope.directives[directive.idempotencyKey] = directive;
  let decisionStateJson = buildPressureMvpDecisionStateV1({
    workingRevision: 0,
    pin: {
      schemaVersion: "pressure_decision_pin_v1",
      chapterId: "N1",
      stateRevision: 0,
      stateFingerprint: sha256Canonical("decision-state"),
      decisionPointId: "decision.N1.1",
      kernelId: "kernel-decision.N1.1",
      optionIds: ["default-action"],
    },
    requiredSeatIds: ["zhejiang_governor"],
    policyHash: sha256Canonical("decision-policy"),
    orchestratorHash: sha256Canonical("orchestrator"),
  });
  const tx = {
    pressureRunRouteSnapshot: {
      findUnique: async () => ({
        runId: route.runId,
        routeHash: route.snapshot.routeHash,
        routeJson: route,
      }),
    },
    pressureChapterRuntime: {
      findUnique: async () => ({
        id: "chapter-runtime-N1",
        runId: route.runId,
        routeHash: route.snapshot.routeHash,
        decisionStateJson,
      }),
    },
    pressureSeatControlSnapshot: {
      findUnique: async () => ({
        runId: route.runId,
        stateRevision: 3,
        stateHash: authorityStateHash,
        version: 1,
        snapshotJson: {
          ...envelope,
          snapshot: makeSeatSnapshot(
            route.runId,
            route.snapshot.routeHash,
            authorityStateHash,
            directive.controlEpoch,
            () => activeControllerId,
          ),
        },
      }),
    },
  };
  const prisma = {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
  } as unknown as PrismaService;
  const adapter = new PrismaDeterministicDefaultAuthorityAdapterV1(prisma);
  assert.deepEqual(await adapter.authorize({
    runId: route.runId,
    routeHash: route.snapshot.routeHash,
    chapterRuntimeId: "chapter-runtime-N1",
    decisionPointId: directive.decisionPointId,
    seatId: directive.seatId,
    reason: "DEADLINE",
  }), {
    subjectId: "ai:run-product-adapters:zhejiang-governor",
    controlEpoch: 2,
  });

  activeControllerId = "spoofed-controller";
  await assert.rejects(
    () => adapter.authorize({
      runId: route.runId,
      routeHash: route.snapshot.routeHash,
      chapterRuntimeId: "chapter-runtime-N1",
      decisionPointId: directive.decisionPointId,
      seatId: directive.seatId,
      reason: "DEADLINE",
    }),
    /PRESSURE_PRODUCT_AUTHORITY_MISMATCH.*CURRENT_AI_AUTHORITY/,
  );

  activeControllerId = "ai:run-product-adapters:zhejiang-governor";
  decisionStateJson = buildPressureMvpDecisionStateV1({
    workingRevision: 0,
    pin: {
      schemaVersion: "pressure_decision_pin_v1",
      chapterId: "N1",
      stateRevision: 0,
      stateFingerprint: sha256Canonical("other-decision-state"),
      decisionPointId: "decision.N1.other",
      kernelId: "kernel-decision.N1.other",
      optionIds: ["default-action"],
    },
    requiredSeatIds: ["zhejiang_governor"],
    policyHash: sha256Canonical("decision-policy"),
    orchestratorHash: sha256Canonical("orchestrator"),
  });
  await assert.rejects(
    () => adapter.authorize({
      runId: route.runId,
      routeHash: route.snapshot.routeHash,
      chapterRuntimeId: "chapter-runtime-N1",
      decisionPointId: directive.decisionPointId,
      seatId: directive.seatId,
      reason: "DEADLINE",
    }),
    /PRESSURE_PRODUCT_AUTHORITY_MISMATCH.*CURRENT_AI_AUTHORITY/,
  );
});

test("content-bound seat projection is viewer-scoped and uses only frozen resource metadata", async () => {
  const route = await publishedRoute();
  const world = compileInitialWorldState(loadSangtianPressureChapterPackageV1());
  const record = buildGenesisAtomicRecord(route, world, {
    runId: route.runId,
    idempotencyKey: "genesis:seat-private",
    requestFingerprint: sha256Canonical("genesis-seat-private-request"),
  });
  const committed = { record, receipt: buildGenesisCommitReceipt(record) };
  const authorityHash = sha256Canonical("seat-control-current");
  const seatSnapshot = makeSeatSnapshot(
    route.runId,
    route.snapshot.routeHash,
    authorityHash,
    1,
    () => "ai:run-product-adapters:zhejiang-governor",
    record.snapshot.genesisHash,
  );
  const tx = {
    pressureRunRouteSnapshot: {
      findUnique: async () => ({
        runId: route.runId,
        routeHash: route.snapshot.routeHash,
        routeJson: route,
      }),
    },
    pressureSeatControlSnapshot: {
      findUnique: async () => ({
        runId: route.runId,
        stateRevision: seatSnapshot.stateRevision,
        stateHash: authorityHash,
        version: 1,
        snapshotJson: emptySeatEnvelope(seatSnapshot),
      }),
    },
    pressureGenesisCommit: {
      findUnique: async () => ({ runId: route.runId, commitManifestJson: committed }),
    },
  };
  const prisma = {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
  } as unknown as PrismaService;
  const seatId = "zhejiang_governor" as const;
  const projection = await new ContentBoundSeatPrivateProjectionPortV1(prisma)
    .readForSeat({ runId: route.runId, seatId, sourceAuthorityHash: authorityHash });
  const capturedProjection = compileSangtianSeatPrivateProjectionFromCapturedAuthoritiesV1({
    runId: route.runId,
    seatId,
    routeSnapshot: route.snapshot,
    seatAuthority: seatSnapshot,
    world,
  });
  assert.deepEqual(capturedProjection, projection);
  const payload = projection.payload as {
    resources: Array<{ resourceId: string; value: number }>;
    tokens: unknown[];
  };
  assert.equal(projection.seatId, seatId);
  assert.equal(projection.payloadHash, sha256Canonical(projection.payload));
  assert.deepEqual(payload.resources.map((resource) => resource.resourceId), [
    "resource.silver",
    "resource.grain",
    "resource.soldiers",
    "resource.advisers",
    "resource.intelligence",
  ]);
  assert.deepEqual(payload.resources, [
    { resourceId: "resource.silver", value: 42, displayValue: "42 万两" },
    { resourceId: "resource.grain", value: 23, displayValue: "23 万石" },
    { resourceId: "resource.soldiers", value: 4, displayValue: "4/5" },
    { resourceId: "resource.advisers", value: 4, displayValue: "4 人" },
    { resourceId: "resource.intelligence", value: 2, displayValue: "2 条" },
  ]);
  assert.deepEqual(payload.tokens, []);
  const serialized = JSON.stringify(payload);
  const viewerKnown = new Set(world.knowledgeBySeat[seatId].knownFactRefs);
  for (const otherSeatId of Object.keys(world.knowledgeBySeat).filter((candidate) => candidate !== seatId)) {
    const knowledge = world.knowledgeBySeat[
      otherSeatId as keyof typeof world.knowledgeBySeat
    ];
    for (const otherSeatOnlyRef of knowledge.knownFactRefs.filter((ref) => !viewerKnown.has(ref))) {
      assert.equal(serialized.includes(otherSeatOnlyRef), false);
    }
  }

  const catalog = await new SangtianFrozenSeatPresentationCatalogV1(prisma)
    .readCatalog({ runId: route.runId, seatId });
  assert.equal(catalog?.resources["resource.grain"]?.label, "粮草");
  assert.equal(catalog?.resources["resource.intelligence"]?.label, "密报");
  assert.deepEqual(catalog?.tokens, {});
});

test("factory internalizes authority, narrative and frozen-stage adapters", async () => {
  const prisma = {
    $transaction: async () => { throw new Error("not called during composition"); },
  } as unknown as PrismaService;
  const resolved = await createPressureChapterInternalProductionPortsV1(
    prisma,
  );

  assert.equal(resolved.narrativeProjectorVersion, "openovel-pressure-projector-1.0.0");
  assert.equal(resolved.narrativeProviderMode, "DETERMINISTIC_FALLBACK_ONLY");
  assert.equal(typeof resolved.narrativeOutboxSignal.notifyCommitted, "function");
  assert.equal(typeof resolved.narrativeSnapshotCompiler.compile, "function");
  assert.equal(typeof resolved.openNovelNarrativeProjector.project, "function");
  assert.ok(resolved.authoritativeChapterWorld instanceof PrismaAuthoritativeChapterWorldReaderV1);
  assert.ok(resolved.deterministicDefaultAuthority instanceof PrismaDeterministicDefaultAuthorityAdapterV1);
  assert.ok(resolved.n7FinaleHandoff instanceof PrismaDurableN7FinaleHandoffReaderV1);
  assert.ok(resolved.finaleConfiguration instanceof FrozenSangtianFinaleConfigurationResolverV1);
  assert.ok(resolved.genericFinaleShadow instanceof PressureGenericFinaleShadowReadOnlyAdapterV1);
  assert.deepEqual(
    Object.getOwnPropertyNames(PressureGenericFinaleShadowReadOnlyAdapterV1.prototype),
    ["constructor", "evaluateShadow"],
  );
  assert.ok(resolved.replayTargetRouteResolver instanceof AuthoritativePressureReplayTargetRouteResolverV1);
  assert.ok(resolved.replayPolicy instanceof SangtianPressureReplayPolicyV1);
  assert.ok(resolved.replayTargetFactory instanceof PrismaPressureReplayNewTargetFactoryV1);
  assert.ok(resolved.gameCapabilities instanceof PrismaProductPressureGameCapabilityReaderV1);
  assert.ok(resolved.seatPresentationCatalog instanceof SangtianFrozenSeatPresentationCatalogV1);
  assert.ok(resolved.seatPrivateProjection instanceof ContentBoundSeatPrivateProjectionPortV1);
  assert.ok(resolved.aEmotionPresentation instanceof FrozenAEmotionPresentationAdapterV1);
  assert.ok(resolved.aEmotionObserverResolver instanceof FailClosedSangtianAEmotionObserverResolverV1);
  assert.equal(typeof resolved.aEmotionPresentation.render, "function");
  assert.equal(typeof resolved.aEmotionPresentation.present, "function");
});

test("published A-Emotion policy cannot produce OBSERVERS and its generic resolver fails closed", async () => {
  const release = loadPublishedSangtianAEmotionPolicyV1();
  const compiled = [
    release.compileTemplate({ sourceKind: "BEAT_COMMITTED", chapterId: "N1", actionType: "FORMAL_ACTION" }),
    ...(["HIGH", "LOW", "MID"] as const).map((outcomeBand) => release.compileTemplate({
      sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
      chapterId: "N1",
      outcomeBand,
    })),
    ...(["COSTLY_WIN", "LOSS", "WIN"] as const).map((verdict) => release.compileTemplate({
      sourceKind: "FINALE_COMMITTED",
      verdict,
    })),
  ];
  assert.equal(compiled.every((template) => (
    template?.audienceMode === "ACTION_BINDING_TARGETS"
      || template?.audienceMode === "SOURCE_SEAT_ONLY"
  )), true);

  const resolver = new FailClosedSangtianAEmotionObserverResolverV1();
  assert.equal(resolver.policySha256, release.artifactSha256);
  await assert.rejects(
    () => resolver.resolve({
      roomId: "run-product-adapters",
      runId: "run-product-adapters",
      resolverCode: "unpublished-observer-code",
      contextRefs: [],
    }),
    /PRESSURE_PRODUCT_UNSUPPORTED_STAGE:aEmotionObserverResolver\.resolve:OBSERVERS_NOT_PUBLISHED/u,
  );
});

test("A-Emotion seat binding rejects room/run aliasing before any database read", async () => {
  const adapter = new PrismaAEmotionSeatDeliveryBindingAdapterV1({} as PrismaService);
  await assert.rejects(
    () => adapter.resolve({
      roomId: "room-other",
      runId: "run-product-adapters",
      viewerSeatId: "zhejiang_governor",
    }),
    /PRESSURE_PRODUCT_AUTHORITY_MISMATCH:roomId:RUN_ID/,
  );
});
