import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeSealedActionsHash,
  isSha256,
  nextChapterId,
  sha256Canonical,
  validateBeatResolutionV1,
  validateCarryForwardV1,
  validateCausalEdgesV1,
  validateDecisionActionV1,
  validateOpenNovelNarrativeProjectionJobV1,
  validateWorldStateV1,
  type CausalEdgeV1,
  type DecisionActionV1,
  type NarrativeAudienceV1,
  type OpenNovelNarrativeProjectionJobV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  compileInitialWorldState,
  type LoadedSangtianPressureChapterPackageV1,
  type PublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import {
  validateCommittedGenesis,
  type CommittedGenesisV1,
} from "../genesis";
import type { AuthoritativeNarrativeSnapshotCompilerPortV1 } from "../persistence";
import { FinaleAuthoritativeNarrativeSnapshotCompilerV1 } from "../narrative-production/finale-authority-compiler";
import {
  assertSangtianNarrativeAuthorityCatalogV1,
  loadSangtianNarrativeAuthorityCatalogV1,
  SANGTIAN_NARRATIVE_AUTHORITY_TARGET_V1 as TARGET,
  type SangtianNarrativeAuthorityCatalogV1,
} from "./catalog";
import type {
  AuthoritativeNarrativeClaimV1,
  AuthoritativeNarrativeFactV1,
  AuthoritativeNarrativeKnowledgeV1,
  AuthoritativeNarrativeObjectV1,
  AuthoritativeNarrativeSourceSnapshotV1,
  CommittedBeatNarrativeAuthorityV1,
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
  NarrativeAuthorityAclV1,
  NarrativeAuthorityAudienceAllowlistV1,
  NonFinaleNarrativeVariantV1,
} from "./contracts";
import {
  PRESSURE_NARRATIVE_AUTHORITY_ERROR_CODES_V1 as ERROR,
  PressureNarrativeAuthorityErrorV1,
  failPressureNarrativeAuthorityV1,
} from "./errors";

type MutableAclV1 = { public: boolean; seats: Set<SeatIdV1> };

interface RawGenesisAuthorityV1 {
  runId: string;
  commitManifestJson: unknown;
  commitHash: string;
}

interface RawChapterAuthorityV1 {
  runId: string;
  bundleHash: string;
  frozenWorldStateJson: unknown;
  causalEdgesJson: unknown;
  carryForwardJson: unknown;
}

/**
 * Pure committed-authority dispatcher. Finale remains owned by the existing
 * compiler; this module adds P0, committed beats and frozen chapters only.
 */
export class SangtianAuthoritativeNarrativeSnapshotCompilerV1
implements AuthoritativeNarrativeSnapshotCompilerPortV1,
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1 {
  private readonly content: LoadedSangtianPressureChapterPackageV1;
  private readonly release: PublishedSangtianActionReleaseV1;

  constructor(
    catalog: SangtianNarrativeAuthorityCatalogV1 =
      loadSangtianNarrativeAuthorityCatalogV1(),
    private readonly finaleCompiler: AuthoritativeNarrativeSnapshotCompilerPortV1 =
      new FinaleAuthoritativeNarrativeSnapshotCompilerV1(),
  ) {
    this.content = catalog.package;
    this.release = catalog.release;
    assertSangtianNarrativeAuthorityCatalogV1(catalog);
  }

  compile(
    jobValue: Readonly<OpenNovelNarrativeProjectionJobV1>,
    rawAuthority: Readonly<unknown>,
  ): unknown {
    const job = validateOpenNovelNarrativeProjectionJobV1(jobValue);
    if (
      job.sourceAuthority === "FINALE_FROZEN"
      || job.sourceAuthority === "LEGACY_TERMINAL_COMMITTED"
    ) {
      return this.finaleCompiler.compile(job, rawAuthority);
    }
    const source = this.compileNonFinale(job, rawAuthority);
    assertJobAllowlists(job, source);
    return structuredClone(source);
  }

  deriveAudienceAllowlist(
    jobValue: Readonly<OpenNovelNarrativeProjectionJobV1>,
    rawAuthority: Readonly<unknown>,
  ): NarrativeAuthorityAudienceAllowlistV1 {
    const job = validateOpenNovelNarrativeProjectionJobV1(jobValue);
    if (
      job.sourceAuthority === "FINALE_FROZEN"
      || job.sourceAuthority === "LEGACY_TERMINAL_COMMITTED"
    ) {
      return failPressureNarrativeAuthorityV1(
        ERROR.UNSUPPORTED_AUTHORITY,
        "narrativeJob.sourceAuthority",
        "FINALE_ALLOWLIST_IS_OWNED_BY_TERMINAL_COMMIT",
      );
    }
    const source = this.compileNonFinale(job, rawAuthority);
    return deriveAllowlist(source, job.audience);
  }

  private compileNonFinale(
    job: OpenNovelNarrativeProjectionJobV1,
    rawAuthority: Readonly<unknown>,
  ): AuthoritativeNarrativeSourceSnapshotV1 {
    assertPublishedJobProfile(job);
    if (job.sourceAuthority === "GENESIS_FROZEN") {
      return compileGenesis(job, rawAuthority, this.content);
    }
    if (job.sourceAuthority === "CHAPTER_WORKING") {
      return compileBeat(job, rawAuthority, this.content, this.release);
    }
    if (job.sourceAuthority === "CHAPTER_FROZEN") {
      return compileChapter(job, rawAuthority, this.content);
    }
    return failPressureNarrativeAuthorityV1(
      ERROR.UNSUPPORTED_AUTHORITY,
      "narrativeJob.sourceAuthority",
      job.sourceAuthority,
    );
  }
}

function compileGenesis(
  job: OpenNovelNarrativeProjectionJobV1,
  rawValue: unknown,
  loaded: LoadedSangtianPressureChapterPackageV1,
): AuthoritativeNarrativeSourceSnapshotV1 {
  const row = genesisRow(rawValue);
  const committed = committedGenesis(row.commitManifestJson);
  const { record } = committed;
  const snapshot = record.snapshot;
  const world = snapshot.initialWorldState;
  if (
    row.runId !== record.runId
    || row.commitHash !== record.commit.commitHash
    || snapshot.contentPackageSha256 !== TARGET.contentPackageSha256
    || snapshot.orchestrationPackageSha256 !== TARGET.orchestrationPackageSha256
    || loaded.manifest.contentSha256 !== snapshot.contentPackageSha256
  ) {
    mismatch("rawGenesisAuthority", "COMMITTED_GENESIS_OR_RELEASE_BINDING");
  }
  assertJobIdentity(job, {
    runId: record.runId,
    projectionKind: "GENESIS_NARRATIVE",
    sourceAuthority: "GENESIS_FROZEN",
    sourceId: snapshot.genesisHash,
    sourceCommitHash: record.commit.commitHash,
    sourceContentHash: world.stateHash,
  });
  assertGenesisWorldMatchesCatalog(world, loaded);

  const facts: AuthoritativeNarrativeFactV1[] = [];
  loaded.content.genesis.lockedFacts.forEach((text, index) => {
    facts.push(publicFact(
      `context.P0.locked.${String(index + 1).padStart(2, "0")}`,
      text,
      "FROZEN",
    ));
  });
  for (const factId of Object.keys(loaded.content.genesis.factValues).sort(compareText)) {
    facts.push(publicFact(
      factId,
      `${factId} = ${scalarText(world.factValues[factId])}`,
      "FROZEN",
    ));
  }
  facts.push(...trackFacts(world, loaded, "FROZEN"));

  const index = worldKnowledgeIndex(world);
  const objects = compileWorldObjects(world, loaded, index);
  const knowledge = compileWorldKnowledge(world, loaded, index);
  const claims = standardClaims(facts, objects, knowledge, [{
    kind: "TEMPORAL",
    refId: "P0.GENESIS_FROZEN",
    statement: `${loaded.content.genesis.title}：${loaded.content.genesis.pressure}`,
    required: true,
    ...publicAcl(),
  }]);
  const variant: NonFinaleNarrativeVariantV1 = {
    kind: "GENESIS",
    stageId: "P0",
    openingHook: `${loaded.content.genesis.title}：${loaded.content.genesis.pressure}`,
  };
  return sourceSnapshot(job, facts, objects, knowledge, claims, variant);
}

function compileBeat(
  job: OpenNovelNarrativeProjectionJobV1,
  rawValue: unknown,
  loaded: LoadedSangtianPressureChapterPackageV1,
  release: PublishedSangtianActionReleaseV1,
): AuthoritativeNarrativeSourceSnapshotV1 {
  const raw = committedBeat(rawValue);
  const actions = raw.sealedActions
    .map((action) => validateDecisionAction(action))
    .sort((left, right) => compareText(left.actionId, right.actionId));
  const beat = validateBeat({
    schemaVersion: "sangtian_beat_resolution_v1",
    runId: raw.runId,
    chapterRuntimeId: raw.chapterRuntimeId,
    decisionPointId: raw.decisionPointId,
    baseWorkingRevision: raw.baseWorkingRevision,
    committedWorkingRevision: raw.committedWorkingRevision,
    inputWorkingStateHash: raw.inputWorkingStateHash,
    sealedActionIds: raw.sealedActionIds,
    sealedActionsHash: raw.sealedActionsHash,
    resolverVersion: raw.resolverVersion,
    workingDelta: raw.workingDelta,
    reservationMutations: raw.reservationMutations,
    reactionContextRef: raw.reactionContextRef,
    nextDecisionContextRef: raw.nextDecisionContextRef,
    resolutionHash: raw.resolutionHash,
  }, actions);
  if (
    raw.contentPackageSha256 !== TARGET.contentPackageSha256
    || raw.workingDeltaHash !== sha256Canonical(beat.workingDelta)
    || raw.sealedActionsHash !== computeSealedActionsHash(actions)
  ) mismatch("rawBeatAuthority", "COMMITTED_BEAT_HASH_OR_CONTENT_BINDING");

  const chapter = loaded.content.chapters.find((item) => item.chapterId === raw.chapterId);
  const point = chapter?.decisionPoints.find(
    (item) => item.decisionPointKey === raw.decisionPointKey,
  );
  if (!chapter || !point) presentationMissing("rawBeatAuthority.decisionPointKey");
  if (
    beat.runId !== job.runId
    || actions.some((action) => (
      action.runId !== beat.runId
      || action.chapterRuntimeId !== beat.chapterRuntimeId
      || action.chapterId !== raw.chapterId
      || action.decisionPointId !== beat.decisionPointId
    ))
  ) mismatch("rawBeatAuthority.sealedActions", "ACTION_AUTHORITY_BINDING");
  assertJobIdentity(job, {
    runId: beat.runId,
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: beat.resolutionHash,
    sourceCommitHash: beat.resolutionHash,
    sourceContentHash: raw.workingDeltaHash,
  });

  const facts: AuthoritativeNarrativeFactV1[] = [];
  chapter.lockedFacts.forEach((text, index) => {
    facts.push(publicFact(
      `context.${raw.chapterId}.locked.${String(index + 1).padStart(2, "0")}`,
      text,
      "COMMITTED_WORKING",
    ));
  });
  const actionSeats = canonicalSeats(actions.map((action) => action.seatId));
  const participantAcl = authorizedAcl(actionSeats);
  for (const action of actions) {
    let presentation;
    try {
      presentation = release.readActionPresentation({
        contentPackageVersion: TARGET.contentPackageVersion,
        contentPackageHash: TARGET.contentPackageSha256,
        chapterId: raw.chapterId,
        decisionPointKey: raw.decisionPointKey,
        actionType: action.actionType,
      });
    } catch (cause) {
      presentationMissing(
        `rawBeatAuthority.sealedActions.${action.actionId}.actionType`,
        safeCause(cause),
      );
    }
    const seat = loaded.content.genesis.seats.find((item) => item.seatId === action.seatId);
    if (!seat) presentationMissing(`content.genesis.seats.${action.seatId}`);
    facts.push({
      factId: `action.${action.actionId}`,
      text: `${seat.displayName}提交“${presentation.label}”：${presentation.description}`,
      temporalStatus: "COMMITTED_WORKING",
      ...authorizedAcl([action.seatId]),
    });
  }
  for (const mutation of beat.workingDelta.workingFactMutations) {
    facts.push({
      factId: `working.${mutation.factRef}`,
      text: `${mutation.factRef}: ${scalarText(mutation.before)} -> ${scalarText(mutation.after)}`,
      temporalStatus: "COMMITTED_WORKING",
      ...participantAcl,
    });
  }
  for (const mutation of beat.workingDelta.commitmentMutations) {
    facts.push({
      factId: `commitment.${mutation.commitmentId}`,
      text: `${mutation.commitmentId}: ${mutation.operation}; seats=${mutation.seatIds.join(",")}`,
      temporalStatus: "COMMITTED_WORKING",
      ...authorizedAcl(mutation.seatIds),
    });
  }
  for (const mutation of beat.workingDelta.seatArcWorkingMutations) {
    facts.push({
      factId: `seat.${mutation.seatId}.working_arc.${mutation.sourceActionId}`,
      text: `${mutation.seatId} 的章内个人线变化 ${signed(mutation.progressDelta)}`,
      temporalStatus: "COMMITTED_WORKING",
      ...authorizedAcl([mutation.seatId]),
    });
  }
  for (const mutation of beat.reservationMutations) {
    facts.push({
      factId: `reservation.${mutation.reservationKey}`,
      text: `${mutation.resourceId}: ${mutation.operation} ${mutation.amount}`,
      temporalStatus: "COMMITTED_WORKING",
      ...authorizedAcl([mutation.seatId]),
    });
  }
  sortAndAssertUnique(facts, (item) => item.factId, "source.facts");

  const knowledge: AuthoritativeNarrativeKnowledgeV1[] = beat.workingDelta.knowledgeMutations
    .flatMap((mutation) => [
      ...mutation.addFactRefs.map((ref) => ({
        knowledgeId: `knowledge.${mutation.seatId}.added.${ref}`,
        text: `${ref} 已加入 ${mutation.seatId} 的章内知识边界`,
        ...authorizedAcl([mutation.seatId]),
      })),
      ...mutation.removeFactRefs.map((ref) => ({
        knowledgeId: `knowledge.${mutation.seatId}.removed.${ref}`,
        text: `${ref} 已从 ${mutation.seatId} 的章内知识边界移除`,
        ...authorizedAcl([mutation.seatId]),
      })),
    ]);
  sortAndAssertUnique(knowledge, (item) => item.knowledgeId, "source.knowledge");
  const objects: AuthoritativeNarrativeObjectV1[] = [];
  const claims = standardClaims(facts, objects, knowledge, [{
    kind: "TEMPORAL",
    refId: `beat.${beat.resolutionHash}`,
    statement: `${chapter.title}的“${point.purpose}”已提交章内反馈；尚未形成章末冻结世界。`,
    required: true,
    ...publicAcl(),
  }]);
  const variant: NonFinaleNarrativeVariantV1 = {
    kind: "BEAT",
    chapterId: raw.chapterId,
    workingRevision: beat.committedWorkingRevision,
    temporalBoundary: "WORKING_NOT_FROZEN",
  };
  return sourceSnapshot(job, facts, objects, knowledge, claims, variant);
}

function compileChapter(
  job: OpenNovelNarrativeProjectionJobV1,
  rawValue: unknown,
  loaded: LoadedSangtianPressureChapterPackageV1,
): AuthoritativeNarrativeSourceSnapshotV1 {
  const row = chapterRow(rawValue);
  const world = validateWorld(row.frozenWorldStateJson, "rawChapterAuthority.frozenWorldStateJson");
  const causalEdges = validateCausal(row.causalEdgesJson);
  const carry = validateCarry(row.carryForwardJson);
  const chapterId = CHAPTER_IDS_V1[world.worldSequence - 1];
  if (!chapterId) invalid("rawChapterAuthority.frozenWorldStateJson.worldSequence", "CHAPTER_1_TO_7");
  const chapter = loaded.content.chapters.find((item) => item.chapterId === chapterId);
  if (!chapter) presentationMissing(`content.chapters.${chapterId}`);
  const expectedNext = nextChapterId(chapterId);
  if (carry.nextChapterId !== expectedNext) {
    mismatch("rawChapterAuthority.carryForwardJson.nextChapterId", `EXPECTED_${expectedNext}`);
  }
  if (row.runId !== job.runId) mismatch("rawChapterAuthority.runId");
  assertJobIdentity(job, {
    runId: row.runId,
    projectionKind: "CHAPTER_NARRATIVE",
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: row.bundleHash,
    // The current read model exposes the immutable bundle hash as its commit
    // fence. A future richer read may additionally expose settlement commitHash.
    sourceCommitHash: row.bundleHash,
    sourceContentHash: world.stateHash,
  });

  const facts: AuthoritativeNarrativeFactV1[] = [];
  chapter.lockedFacts.forEach((text, index) => {
    facts.push(publicFact(
      `context.${chapterId}.locked.${String(index + 1).padStart(2, "0")}`,
      text,
      "FROZEN",
    ));
  });
  facts.push(...trackFacts(world, loaded, "FROZEN"));
  const index = worldKnowledgeIndex(world);
  for (const factId of Object.keys(world.factValues).sort(compareText)) {
    const acl = aclForKnownRef(index, factId);
    if (!acl) continue;
    facts.push({
      factId,
      text: `${factId} = ${scalarText(world.factValues[factId])}`,
      temporalStatus: "FROZEN",
      ...acl,
    });
  }
  const objects = compileWorldObjects(world, loaded, index);
  const knowledge = compileWorldKnowledge(world, loaded, index);
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    const arc = world.seatArcs[seatId];
    knowledge.push({
      knowledgeId: `seat.${seatId}.arc.sequence.${world.worldSequence}`,
      text: `${seatId}: arcStage=${arc.arcStage}; public=${arc.publicGoalProgress}; private=${arc.privateGoalProgress}; gains=${arc.gainRefs.join(",") || "none"}; losses=${arc.lossRefs.join(",") || "none"}; costs=${arc.costRefs.join(",") || "none"}`,
      ...authorizedAcl([seatId]),
    });
  }
  sortAndAssertUnique(knowledge, (item) => item.knowledgeId, "source.knowledge");
  appendVisibleCausalFacts(facts, causalEdges, objects, knowledge);
  sortAndAssertUnique(facts, (item) => item.factId, "source.facts");
  const next = expectedNext === "FINALE" ? null : expectedNext;
  const claims = standardClaims(facts, objects, knowledge, [{
    kind: "TEMPORAL",
    refId: `chapter.${chapterId}.frozen.${row.bundleHash}`,
    statement: `${chapter.title}已冻结；世界序列为 ${world.worldSequence}。`,
    required: true,
    ...publicAcl(),
  }]);
  const variant: NonFinaleNarrativeVariantV1 = {
    kind: "CHAPTER",
    chapterId,
    committedWorldSequence: world.worldSequence,
    nextChapterId: next,
  };
  return sourceSnapshot(job, facts, objects, knowledge, claims, variant);
}

function sourceSnapshot(
  job: OpenNovelNarrativeProjectionJobV1,
  facts: AuthoritativeNarrativeFactV1[],
  objects: AuthoritativeNarrativeObjectV1[],
  knowledge: AuthoritativeNarrativeKnowledgeV1[],
  claims: AuthoritativeNarrativeClaimV1[],
  variant: NonFinaleNarrativeVariantV1,
): AuthoritativeNarrativeSourceSnapshotV1 {
  sortAndAssertUnique(facts, (item) => item.factId, "source.facts");
  sortAndAssertUnique(objects, (item) => item.objectVersionId, "source.objects");
  sortAndAssertUnique(knowledge, (item) => item.knowledgeId, "source.knowledge");
  sortAndAssertUnique(
    claims,
    (item) => `${item.kind}\u0000${item.refId}`,
    "source.claims",
  );
  return {
    schemaVersion: "authoritative_narrative_source_snapshot_v1",
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    facts,
    objects,
    knowledge,
    claims,
    publicVariant: structuredClone(variant),
    seatVariants: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      variant: structuredClone(variant),
    })),
  };
}

function standardClaims(
  facts: AuthoritativeNarrativeFactV1[],
  objects: AuthoritativeNarrativeObjectV1[],
  knowledge: AuthoritativeNarrativeKnowledgeV1[],
  additional: AuthoritativeNarrativeClaimV1[],
): AuthoritativeNarrativeClaimV1[] {
  return [
    ...facts.map((item) => ({
      kind: "FACT" as const,
      refId: item.factId,
      statement: item.text,
      required: false,
      visibility: item.visibility,
      authorizedSeatIds: [...item.authorizedSeatIds],
    })),
    ...objects.map((item) => ({
      kind: "OBJECT" as const,
      refId: item.objectVersionId,
      statement: item.stateText,
      required: false,
      visibility: item.visibility,
      authorizedSeatIds: [...item.authorizedSeatIds],
    })),
    ...knowledge.map((item) => ({
      kind: "KNOWLEDGE" as const,
      refId: item.knowledgeId,
      statement: item.text,
      required: false,
      visibility: item.visibility,
      authorizedSeatIds: [...item.authorizedSeatIds],
    })),
    ...additional,
  ];
}

function trackFacts(
  world: WorldStateV1,
  loaded: LoadedSangtianPressureChapterPackageV1,
  temporalStatus: AuthoritativeNarrativeFactV1["temporalStatus"],
): AuthoritativeNarrativeFactV1[] {
  return TRACK_IDS_V1.map((trackId) => {
    const presentation = loaded.content.genesis.tracks.find((item) => item.trackId === trackId);
    if (!presentation) presentationMissing(`content.genesis.tracks.${trackId}`);
    return publicFact(
      `track.${trackId}`,
      `${presentation.name} = ${world.tracks.values[trackId]}`,
      temporalStatus,
    );
  });
}

function compileWorldObjects(
  world: WorldStateV1,
  loaded: LoadedSangtianPressureChapterPackageV1,
  index: Map<string, MutableAclV1>,
): AuthoritativeNarrativeObjectV1[] {
  const result: AuthoritativeNarrativeObjectV1[] = [];
  for (const object of world.objects) {
    const presentation = loaded.content.genesis.objects.find(
      (item) => item.objectId === object.objectId,
    );
    if (!presentation) presentationMissing(`content.genesis.objects.${object.objectId}`);
    // KnowledgeState is the audience authority. Custody alone must not widen
    // a seat's knowledge boundary when content intentionally withholds an
    // object reference from its current holder.
    const acl = aclForKnownRef(index, object.objectId);
    if (!acl) continue;
    result.push({
      objectVersionId: `${object.objectId}@v${object.version}`,
      label: presentation.name,
      stateText: `${presentation.name}: state=${object.stateCode}; holder=${object.holderSeatId ?? "none"}; quantity=${object.quantity ?? "none"}; tags=${object.tags.join(",") || "none"}`,
      ...acl,
    });
  }
  sortAndAssertUnique(result, (item) => item.objectVersionId, "source.objects");
  return result;
}

function compileWorldKnowledge(
  world: WorldStateV1,
  loaded: LoadedSangtianPressureChapterPackageV1,
  index: Map<string, MutableAclV1>,
): AuthoritativeNarrativeKnowledgeV1[] {
  const result: AuthoritativeNarrativeKnowledgeV1[] = [];
  for (const [knowledgeId, mutable] of [...index.entries()].sort(byFirst)) {
    const acl = freezeAcl(mutable);
    result.push({
      knowledgeId,
      text: knowledgeText(knowledgeId, world, loaded),
      ...acl,
    });
  }
  return result;
}

function knowledgeText(
  ref: string,
  world: WorldStateV1,
  loaded: LoadedSangtianPressureChapterPackageV1,
): string {
  if (ref in world.factValues) return `${ref} = ${scalarText(world.factValues[ref])}`;
  const object = world.objects.find((item) => item.objectId === ref);
  if (object) {
    const presentation = loaded.content.genesis.objects.find((item) => item.objectId === ref);
    if (!presentation) presentationMissing(`content.genesis.objects.${ref}`);
    return `${presentation.name}: state=${object.stateCode}; version=${object.version}`;
  }
  const evidence = world.evidence.find((item) => item.evidenceId === ref);
  if (evidence) {
    // supportsFactRefs can have a narrower ACL than the evidence reference;
    // never smuggle those linked refs through an otherwise allowed item.
    return `${ref}: status=${evidence.status}`;
  }
  return `知识边界中已确认引用 ${ref}`;
}

function appendVisibleCausalFacts(
  facts: AuthoritativeNarrativeFactV1[],
  edges: CausalEdgeV1[],
  objects: AuthoritativeNarrativeObjectV1[],
  knowledge: AuthoritativeNarrativeKnowledgeV1[],
): void {
  const aclByRef = new Map<string, NarrativeAuthorityAclV1>();
  for (const fact of facts) aclByRef.set(fact.factId, fact);
  for (const object of objects) {
    aclByRef.set(object.objectVersionId, object);
    aclByRef.set(object.objectVersionId.replace(/@v\d+$/u, ""), object);
  }
  for (const item of knowledge) aclByRef.set(item.knowledgeId, item);
  for (const edge of edges) {
    const acl = intersectAcl(aclByRef.get(edge.causeRef), aclByRef.get(edge.effectRef));
    if (!acl) continue;
    const factId = `causal.${sha256Canonical(edge).slice(0, 24)}`;
    facts.push({
      factId,
      text: `${edge.causeRef} ${edge.relation} ${edge.effectRef}`,
      temporalStatus: "FROZEN",
      ...acl,
    });
  }
}

function worldKnowledgeIndex(world: WorldStateV1): Map<string, MutableAclV1> {
  const result = new Map<string, MutableAclV1>();
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    const state = world.knowledgeBySeat[seatId];
    const secret = new Set(state.secretRefs);
    for (const ref of state.knownFactRefs) {
      const current = result.get(ref) ?? { public: false, seats: new Set<SeatIdV1>() };
      current.seats.add(seatId);
      if (secret.has(ref)) current.public = false;
      result.set(ref, current);
    }
  }
  for (const [ref, acl] of result) {
    const secretAnywhere = PRESSURE_CHAPTER_SEAT_IDS_V1.some((seatId) =>
      world.knowledgeBySeat[seatId].secretRefs.includes(ref));
    acl.public = !secretAnywhere && acl.seats.size === PRESSURE_CHAPTER_SEAT_IDS_V1.length;
  }
  return result;
}

function aclForKnownRef(
  index: Map<string, MutableAclV1>,
  ref: string,
): NarrativeAuthorityAclV1 | null {
  const value = index.get(ref);
  return value ? freezeAcl(value) : null;
}

function freezeAcl(value: MutableAclV1): NarrativeAuthorityAclV1 {
  if (value.public) return publicAcl();
  return authorizedAcl([...value.seats]);
}

function intersectAcl(
  left: NarrativeAuthorityAclV1 | undefined,
  right: NarrativeAuthorityAclV1 | undefined,
): NarrativeAuthorityAclV1 | null {
  if (!left || !right) return null;
  if (left.visibility === "PUBLIC") return cloneAcl(right);
  if (right.visibility === "PUBLIC") return cloneAcl(left);
  const rightSeats = new Set(right.authorizedSeatIds);
  const seats = left.authorizedSeatIds.filter((seatId) => rightSeats.has(seatId));
  return seats.length > 0 ? authorizedAcl(seats) : null;
}

function cloneAcl(value: NarrativeAuthorityAclV1): NarrativeAuthorityAclV1 {
  return value.visibility === "PUBLIC"
    ? publicAcl()
    : authorizedAcl(value.authorizedSeatIds);
}

function publicFact(
  factId: string,
  text: string,
  temporalStatus: AuthoritativeNarrativeFactV1["temporalStatus"],
): AuthoritativeNarrativeFactV1 {
  return { factId, text, temporalStatus, ...publicAcl() };
}

function publicAcl(): NarrativeAuthorityAclV1 {
  return { visibility: "PUBLIC", authorizedSeatIds: [] };
}

function authorizedAcl(seats: readonly SeatIdV1[]): NarrativeAuthorityAclV1 {
  const canonical = canonicalSeats(seats);
  if (canonical.length === 0) invalid("source.acl.authorizedSeatIds", "NON_EMPTY");
  return { visibility: "AUTHORIZED", authorizedSeatIds: canonical };
}

function canonicalSeats(seats: readonly SeatIdV1[]): SeatIdV1[] {
  const set = new Set(seats);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => set.has(seatId));
}

function deriveAllowlist(
  source: AuthoritativeNarrativeSourceSnapshotV1,
  audience: NarrativeAudienceV1,
): NarrativeAuthorityAudienceAllowlistV1 {
  return {
    audience: structuredClone(audience),
    allowedFactIds: source.facts.filter((item) => visible(item, audience)).map((item) => item.factId),
    allowedObjectVersionIds: source.objects.filter((item) => visible(item, audience)).map((item) => item.objectVersionId),
    allowedKnowledgeIds: source.knowledge.filter((item) => visible(item, audience)).map((item) => item.knowledgeId),
  };
}

function visible(item: NarrativeAuthorityAclV1, audience: NarrativeAudienceV1): boolean {
  return item.visibility === "PUBLIC" || (
    audience.kind === "SEAT"
    && audience.seatId !== null
    && item.authorizedSeatIds.includes(audience.seatId)
  );
}

function assertJobAllowlists(
  job: OpenNovelNarrativeProjectionJobV1,
  source: AuthoritativeNarrativeSourceSnapshotV1,
): void {
  const expected = deriveAllowlist(source, job.audience);
  for (const field of [
    "allowedFactIds",
    "allowedObjectVersionIds",
    "allowedKnowledgeIds",
  ] as const) {
    if (sha256Canonical(job[field]) !== sha256Canonical(expected[field])) {
      failPressureNarrativeAuthorityV1(
        ERROR.AUDIENCE_ALLOWLIST_MISMATCH,
        `narrativeJob.${field}`,
      );
    }
  }
}

function assertPublishedJobProfile(job: OpenNovelNarrativeProjectionJobV1): void {
  if (
    job.sourceRuntimeProfile !== TARGET.runtimeProfile
    || job.narrativeProfileVersion !== TARGET.narrativeProfileVersion
  ) mismatch("narrativeJob", "PUBLISHED_RUNTIME_OR_NARRATIVE_PROFILE");
}

function assertJobIdentity(
  job: OpenNovelNarrativeProjectionJobV1,
  expected: Pick<
    OpenNovelNarrativeProjectionJobV1,
    "runId" | "projectionKind" | "sourceAuthority" | "sourceId"
      | "sourceCommitHash" | "sourceContentHash"
  >,
): void {
  for (const field of [
    "runId",
    "projectionKind",
    "sourceAuthority",
    "sourceId",
    "sourceCommitHash",
    "sourceContentHash",
  ] as const) {
    if (job[field] !== expected[field]) mismatch(`narrativeJob.${field}`);
  }
}

function assertGenesisWorldMatchesCatalog(
  world: WorldStateV1,
  loaded: LoadedSangtianPressureChapterPackageV1,
): void {
  const expected = compileInitialWorldState(loaded);
  if (
    world.worldSequence !== 0
    || world.stateHash !== expected.stateHash
  ) mismatch("rawGenesisAuthority.initialWorldState", "P0_CATALOG_MISMATCH");
}

function genesisRow(value: unknown): RawGenesisAuthorityV1 {
  const row = record(value, "rawGenesisAuthority");
  exact(row, ["runId", "commitManifestJson", "commitHash"], "rawGenesisAuthority");
  nonEmpty(row.runId, "rawGenesisAuthority.runId");
  hash(row.commitHash, "rawGenesisAuthority.commitHash");
  return row as unknown as RawGenesisAuthorityV1;
}

function chapterRow(value: unknown): RawChapterAuthorityV1 {
  const row = record(value, "rawChapterAuthority");
  exact(row, [
    "runId",
    "bundleHash",
    "frozenWorldStateJson",
    "causalEdgesJson",
    "carryForwardJson",
  ], "rawChapterAuthority");
  nonEmpty(row.runId, "rawChapterAuthority.runId");
  hash(row.bundleHash, "rawChapterAuthority.bundleHash");
  return row as unknown as RawChapterAuthorityV1;
}

function committedBeat(value: unknown): CommittedBeatNarrativeAuthorityV1 {
  const row = record(value, "rawBeatAuthority");
  if (row.schemaVersion !== "pressure_committed_beat_narrative_authority_v1") {
    return failPressureNarrativeAuthorityV1(
      ERROR.BEAT_CONTEXT_MISSING,
      "rawBeatAuthority",
      "REQUIRES_CHAPTER_DECISION_ACTION_AND_CONTENT_BINDINGS",
    );
  }
  exact(row, [
    "schemaVersion",
    "runId",
    "chapterRuntimeId",
    "chapterId",
    "decisionPointId",
    "decisionPointKey",
    "baseWorkingRevision",
    "committedWorkingRevision",
    "inputWorkingStateHash",
    "sealedActionIds",
    "sealedActionsHash",
    "sealedActions",
    "resolverVersion",
    "workingDelta",
    "workingDeltaHash",
    "reservationMutations",
    "reactionContextRef",
    "nextDecisionContextRef",
    "resolutionHash",
    "contentPackageSha256",
  ], "rawBeatAuthority");
  for (const field of [
    "runId", "chapterRuntimeId", "decisionPointId", "decisionPointKey", "resolverVersion",
  ] as const) nonEmpty(row[field], `rawBeatAuthority.${field}`);
  if (!CHAPTER_IDS_V1.includes(row.chapterId as never)) invalid("rawBeatAuthority.chapterId");
  for (const field of [
    "inputWorkingStateHash", "sealedActionsHash", "workingDeltaHash",
    "resolutionHash", "contentPackageSha256",
  ] as const) hash(row[field], `rawBeatAuthority.${field}`);
  if (!Array.isArray(row.sealedActions) || !Array.isArray(row.sealedActionIds)) {
    invalid("rawBeatAuthority.sealedActions", "ARRAY");
  }
  return structuredClone(row) as unknown as CommittedBeatNarrativeAuthorityV1;
}

function committedGenesis(value: unknown): CommittedGenesisV1 {
  try {
    return validateCommittedGenesis(value as CommittedGenesisV1);
  } catch (cause) {
    return invalid("rawGenesisAuthority.commitManifestJson", safeCause(cause));
  }
}

function validateDecisionAction(value: unknown): DecisionActionV1 {
  try {
    return validateDecisionActionV1(value);
  } catch (cause) {
    return invalid("rawBeatAuthority.sealedActions", safeCause(cause));
  }
}

function validateBeat(value: unknown, actions: DecisionActionV1[]) {
  try {
    return validateBeatResolutionV1(value, actions);
  } catch (cause) {
    return invalid("rawBeatAuthority", safeCause(cause));
  }
}

function validateWorld(value: unknown, path: string): WorldStateV1 {
  try {
    return validateWorldStateV1(value, path);
  } catch (cause) {
    return invalid(path, safeCause(cause));
  }
}

function validateCausal(value: unknown): CausalEdgeV1[] {
  try {
    return validateCausalEdgesV1(value, "rawChapterAuthority.causalEdgesJson");
  } catch (cause) {
    return invalid("rawChapterAuthority.causalEdgesJson", safeCause(cause));
  }
}

function validateCarry(value: unknown) {
  try {
    return validateCarryForwardV1(value, "rawChapterAuthority.carryForwardJson");
  } catch (cause) {
    return invalid("rawChapterAuthority.carryForwardJson", safeCause(cause));
  }
}

function sortAndAssertUnique<T>(
  values: T[],
  key: (value: T) => string,
  path: string,
): void {
  values.sort((left, right) => compareText(key(left), key(right)));
  for (let index = 1; index < values.length; index += 1) {
    if (key(values[index - 1]!) === key(values[index]!)) invalid(path, "DUPLICATE_ID");
  }
}

function byFirst(
  left: readonly [string, unknown],
  right: readonly [string, unknown],
): number {
  return compareText(left[0], right[0]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scalarText(value: unknown): string {
  if (value === null) return "null";
  if (["string", "number", "boolean"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  return invalid("source.factValue", "SCALAR");
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "OBJECT");
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) invalid(`${path}.${extra}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(path, "NON_EMPTY_STRING");
}

function hash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) invalid(path, "SHA256_LOWER_HEX");
}

function safeCause(value: unknown): string {
  if (value instanceof PressureNarrativeAuthorityErrorV1) return value.code;
  return value instanceof Error ? `${value.name}:${value.message}` : String(value);
}

function mismatch(path: string, detail?: string): never {
  return failPressureNarrativeAuthorityV1(
    ERROR.SOURCE_BINDING_MISMATCH,
    path,
    detail,
  );
}

function presentationMissing(path: string, detail?: string): never {
  return failPressureNarrativeAuthorityV1(
    ERROR.PRESENTATION_BINDING_MISSING,
    path,
    detail,
  );
}

function invalid(path: string, detail?: string): never {
  return failPressureNarrativeAuthorityV1(ERROR.SOURCE_INVALID, path, detail);
}
