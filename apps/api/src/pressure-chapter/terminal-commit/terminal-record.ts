import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  validateAuthoritativePressureResultSnapshotV1,
  validateOpenNovelNarrativeProjectionJobV1,
  validateSangtianPressureFinaleDecisionV1,
  validateTerminalResultContextV1,
  type FrozenFinalePolicyV1,
  type FrozenResultReferenceV1,
  type OpenNovelNarrativeProjectionJobV1,
  type SangtianFinaleInputV1,
  type SangtianPressureFinaleDecisionV1,
  type SeatIdV1,
  type TerminalResultContextV1,
} from "@ai-story/shared";
import {
  TERMINAL_COMMIT_ERROR_CODES as ERROR,
  failTerminalCommit,
} from "./errors";
import type {
  AuthorityFirstTerminalRecordV1,
  FinaleNarrativeOutboxV1,
  TerminalResultArtifactV1,
} from "./types";

export interface BuildAuthorityFirstTerminalRecordInputV1 {
  idempotencyKey: string;
  requestFingerprint: string;
  input: SangtianFinaleInputV1;
  policy: FrozenFinalePolicyV1;
  decision: SangtianPressureFinaleDecisionV1;
  terminalResultContext: TerminalResultContextV1;
}

export function buildAuthorityFirstTerminalRecordV1(
  input: BuildAuthorityFirstTerminalRecordInputV1,
): AuthorityFirstTerminalRecordV1 {
  nonEmpty(input.idempotencyKey, "terminalRecord.idempotencyKey");
  hash(input.requestFingerprint, "terminalRecord.requestFingerprint");
  const terminalResultContext = validateTerminalResultContextV1(input.terminalResultContext);
  const decision = validateSangtianPressureFinaleDecisionV1(
    input.decision,
    input.input,
    input.policy,
  );
  const authorityCommitHash = computeAuthorityCommitHashV1({
    runId: decision.runId,
    inputHash: input.input.inputHash,
    policyHash: input.policy.policyHash,
    decisionHash: decision.semanticOutcomeHash,
    executionFingerprint: decision.executionFingerprint,
  });
  if (
    terminalResultContext.runId !== decision.runId
    || terminalResultContext.frozenRouteHash !== decision.routeHash
    || terminalResultContext.contentPackageVersion !== input.policy.contentPackageVersion
    || terminalResultContext.contentPackageSha256 !== input.policy.contentPackageSha256
    || terminalResultContext.completedAt !== decision.decidedAt
  ) invalid("terminalRecord.terminalResultContext", "DECISION_CONTEXT_MISMATCH");
  validateTerminalContextSourceBindings(terminalResultContext, input.input);
  const resultArtifact = buildTerminalResultArtifact(
    decision,
    authorityCommitHash,
    terminalResultContext,
  );
  const narrativeOutbox = buildFinaleNarrativeOutbox(
    input.input,
    decision,
    authorityCommitHash,
    terminalResultContext.narrativeProfileVersion,
  );
  const recordWithoutHash = {
    schemaVersion: "authority_first_terminal_record_v1" as const,
    runId: decision.runId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    inputHash: input.input.inputHash,
    policyHash: input.policy.policyHash,
    decision: structuredClone(decision),
    seatOutcomes: structuredClone(decision.seats),
    resultArtifact,
    narrativeOutbox,
    authorityCommitHash,
  };
  return validateAuthorityFirstTerminalRecordV1({
    ...recordWithoutHash,
    atomicRecordHash: sha256Canonical(recordWithoutHash),
  });
}

function validateTerminalContextSourceBindings(
  context: TerminalResultContextV1,
  input: SangtianFinaleInputV1,
): void {
  const bundleByChapter = new Map(
    input.frozenChapterBundles.map((bundle) => [bundle.chapterId, bundle]),
  );
  for (const reference of context.catalog.references) {
    if (reference.sourceKind === "GENESIS") {
      if (reference.frozenSourceHash !== input.genesisHash) {
        invalid(
          "terminalRecord.terminalResultContext.catalog.references",
          `GENESIS_HASH_MISMATCH_${reference.referenceId}`,
        );
      }
      continue;
    }
    const bundle = bundleByChapter.get(reference.sourceStageId as Exclude<
      FrozenResultReferenceV1["sourceStageId"],
      "P0"
    >);
    if (
      !bundle
      || reference.chapterSettlementId !== bundle.bundleHash
      || reference.frozenSourceHash !== bundle.bundleHash
    ) {
      invalid(
        "terminalRecord.terminalResultContext.catalog.references",
        `FROZEN_CHAPTER_BINDING_MISMATCH_${reference.referenceId}`,
      );
    }
  }
}

export function computeAuthorityCommitHashV1(value: {
  runId: string;
  inputHash: string;
  policyHash: string;
  decisionHash: string;
  executionFingerprint: string;
}): string {
  return sha256Canonical({
    operation: "AUTHORITY_FIRST_TERMINAL_COMMIT_V1",
    ...value,
  });
}

export function validateAuthorityFirstTerminalRecordV1(
  value: unknown,
): AuthorityFirstTerminalRecordV1 {
  const record = plainRecord(value, "terminalRecord");
  exactKeys(record, [
    "schemaVersion",
    "runId",
    "idempotencyKey",
    "requestFingerprint",
    "inputHash",
    "policyHash",
    "decision",
    "seatOutcomes",
    "resultArtifact",
    "narrativeOutbox",
    "authorityCommitHash",
    "atomicRecordHash",
  ], "terminalRecord");
  literal(record.schemaVersion, "authority_first_terminal_record_v1", "terminalRecord.schemaVersion");
  for (const field of ["runId", "idempotencyKey"] as const) {
    nonEmpty(record[field], `terminalRecord.${field}`);
  }
  for (const field of [
    "requestFingerprint",
    "inputHash",
    "policyHash",
    "authorityCommitHash",
    "atomicRecordHash",
  ] as const) {
    hash(record[field], `terminalRecord.${field}`);
  }
  const decision = validateSangtianPressureFinaleDecisionV1(record.decision);
  if (decision.runId !== record.runId) invalid("terminalRecord.decision.runId", "RUN_MISMATCH");
  const expectedAuthorityHash = computeAuthorityCommitHashV1({
    runId: decision.runId,
    inputHash: String(record.inputHash),
    policyHash: String(record.policyHash),
    decisionHash: decision.semanticOutcomeHash,
    executionFingerprint: decision.executionFingerprint,
  });
  if (record.authorityCommitHash !== expectedAuthorityHash) {
    invalid("terminalRecord.authorityCommitHash", `EXPECTED_${expectedAuthorityHash}`);
  }
  if (sha256Canonical(record.seatOutcomes) !== sha256Canonical(decision.seats)) {
    invalid("terminalRecord.seatOutcomes", "DECISION_SEATS_MISMATCH");
  }
  validateTerminalResultArtifact(
    record.resultArtifact,
    decision,
    String(record.authorityCommitHash),
  );
  validateFinaleNarrativeOutbox(
    record.narrativeOutbox,
    decision,
    String(record.authorityCommitHash),
  );
  const expectedAtomicHash = hashWithoutField(record, "atomicRecordHash");
  if (record.atomicRecordHash !== expectedAtomicHash) {
    invalid("terminalRecord.atomicRecordHash", `EXPECTED_${expectedAtomicHash}`);
  }
  return structuredClone(record) as unknown as AuthorityFirstTerminalRecordV1;
}

function buildTerminalResultArtifact(
  decision: SangtianPressureFinaleDecisionV1,
  authorityCommitHash: string,
  context: TerminalResultContextV1,
): TerminalResultArtifactV1 {
  const world = context.catalog.worldOutcomes.find(
    (item) => item.outcomeId === decision.worldOutcome.outcomeId,
  );
  if (!world) invalid("terminalRecord.resultArtifact.worldOutcome", "UNMAPPED_OUTCOME");
  const referenceById = new Map(
    context.catalog.references.map((item) => [item.referenceId, item]),
  );
  const requireReference = (referenceId: string): FrozenResultReferenceV1 => {
    const reference = referenceById.get(referenceId);
    if (!reference) invalid("terminalRecord.resultArtifact.reference", `UNMAPPED_${referenceId}`);
    return reference;
  };
  const tracks = decision.tracks.map((track) => {
    const presentation = context.catalog.tracks.find((item) => item.trackId === track.trackId);
    if (!presentation) invalid("terminalRecord.resultArtifact.tracks", `UNMAPPED_${track.trackId}`);
    track.evidenceRefs.forEach(requireReference);
    return {
      trackId: track.trackId,
      label: presentation.label,
      level: track.level,
      summary: presentation.summaries[track.level],
      evidenceRefs: [...track.evidenceRefs],
    };
  });
  const seatOutcomes = decision.seats.map((seat) => {
    const presentation = context.catalog.seats.find((item) => item.seatId === seat.seatId);
    if (!presentation) invalid("terminalRecord.resultArtifact.seatOutcomes", `UNMAPPED_${seat.seatId}`);
    const gains = seat.gainRefs.map((referenceId) => requireReference(referenceId).summary);
    const losses = seat.lossRefs.map((referenceId) => requireReference(referenceId).summary);
    const causes = seat.causeRefs.slice(0, 3).map((referenceId) => {
      const reference = requireReference(referenceId);
      return {
        sourceStageId: reference.sourceStageId,
        sourceKind: reference.sourceKind,
        chapterSettlementId: reference.chapterSettlementId,
        frozenSourceHash: reference.frozenSourceHash,
        sourceDecisionActionIds: [...reference.sourceDecisionActionIds],
        frozenFactRef: reference.referenceId,
        title: reference.title,
        factText: reference.summary,
        direction: seat.gainRefs.includes(referenceId)
          ? "HELPED" as const
          : seat.lossRefs.includes(referenceId)
            ? "HURT" as const
            : "DECISIVE" as const,
      };
    });
    return {
      seatId: seat.seatId,
      roleKey: presentation.roleKey,
      roleName: presentation.roleName,
      verdict: seat.verdict,
      verdictLabel: presentation.verdictLabels[seat.verdict],
      gain: gains,
      loss: losses,
      causes,
    };
  });
  const usedReferenceIds = sortedUnique([
    ...decision.tracks.flatMap((track) => track.evidenceRefs),
    ...decision.seats.flatMap((seat) => [...seat.gainRefs, ...seat.lossRefs, ...seat.causeRefs]),
    ...decision.objectOutcomeRefs,
    ...decision.evidenceAndResponsibilityRefs,
  ]);
  const usedReferences = usedReferenceIds.map(requireReference);
  const impacts = usedReferences
    .filter((reference): reference is FrozenResultReferenceV1 & {
      kind: "OBJECT" | "EVIDENCE" | "RESPONSIBILITY";
    } => ["OBJECT", "EVIDENCE", "RESPONSIBILITY"].includes(reference.kind))
    .map((reference) => ({
      kind: reference.kind,
      outcomeId: reference.referenceId,
      title: reference.title,
      summary: reference.summary,
      sourceRefs: [...reference.sourceRefs],
      visibility: reference.visibility,
      authorizedSeatIds: [...reference.authorizedSeatIds],
      privateOriginSeatId: reference.privateOriginSeatId,
    }))
    .sort((left, right) => compareCanonicalText(
      `${left.kind}\u0000${left.outcomeId}`,
      `${right.kind}\u0000${right.outcomeId}`,
    ));
  const reveals = usedReferences
    .filter((reference) => reference.revealEligible)
    .map((reference) => ({
      revealId: reference.referenceId,
      authorizedSeatIds: [...reference.authorizedSeatIds],
      title: reference.title,
      text: reference.revealText!,
      sourceRefs: [...reference.sourceRefs],
    }))
    .sort((left, right) => compareCanonicalText(left.revealId, right.revealId));
  const withoutHash = {
    schemaVersion: "authoritative_pressure_result_snapshot_v1" as const,
    roomId: context.roomId,
    runId: decision.runId,
    worldId: "sangtian" as const,
    participantMode: context.participantMode,
    completedAt: context.completedAt,
    frozenRoute: structuredClone(context.frozenRoute),
    frozenRouteHash: context.frozenRouteHash,
    resultContractRegistryVersion: context.resultContractRegistryVersion,
    payloadSchemaVersion: context.payloadSchemaVersion,
    presentationSchemaVersion: context.presentationSchemaVersion,
    rendererKey: context.rendererKey,
    authoritativeResultStatus: "FINALIZED" as const,
    runtimeTerminalState: "FINALE_FROZEN" as const,
    sourceCommitHash: authorityCommitHash,
    decisionHash: decision.semanticOutcomeHash,
    terminalContextHash: context.contextHash,
    contentPackageVersion: context.contentPackageVersion,
    contentPackageSha256: context.contentPackageSha256,
    worldOutcome: structuredClone(world),
    tracks,
    seatOutcomes,
    impacts,
    reveals,
    replayHint: context.catalog.replayHint,
  };
  return validateAuthoritativePressureResultSnapshotV1({
    ...withoutHash,
    snapshotHash: sha256Canonical(withoutHash),
  }, decision.runId);
}

function buildFinaleNarrativeOutbox(
  input: SangtianFinaleInputV1,
  decision: SangtianPressureFinaleDecisionV1,
  authorityCommitHash: string,
  narrativeProfileVersion: string,
): FinaleNarrativeOutboxV1 {
  const world = input.finalWorldState;
  const publicFactIds = sortedUnique([
    ...decision.tracks.flatMap((track) => track.evidenceRefs),
    ...decision.evidenceAndResponsibilityRefs,
  ]);
  const objectVersionIds = sortedUnique(world.objects.map(
    (item) => `object.${item.objectId}.v${item.version}`,
  ));
  const publicJob = narrativeJob({
    runId: decision.runId,
    audience: { kind: "PUBLIC", seatId: null },
    authorityCommitHash,
    decision,
    allowedFactIds: publicFactIds,
    allowedObjectVersionIds: objectVersionIds,
    allowedKnowledgeIds: [],
    narrativeProfileVersion,
  });
  const seatJobs = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const seat = decision.seats.find((item) => item.seatId === seatId)!;
    const knowledge = world.knowledgeBySeat[seatId];
    return narrativeJob({
      runId: decision.runId,
      audience: { kind: "SEAT", seatId },
      authorityCommitHash,
      decision,
      allowedFactIds: sortedUnique([
        ...publicFactIds,
        ...seat.gainRefs,
        ...seat.lossRefs,
        ...seat.causeRefs,
      ]),
      allowedObjectVersionIds: objectVersionIds,
      allowedKnowledgeIds: sortedUnique([
        ...knowledge.knownFactRefs,
        ...knowledge.secretRefs,
      ]),
      narrativeProfileVersion,
    });
  });
  const dedupeKey = `finale_narrative:${decision.runId}:${authorityCommitHash}`;
  const withoutHash = {
    schemaVersion: "sangtian_finale_narrative_outbox_v1" as const,
    runId: decision.runId,
    dedupeKey,
    sourceCommitHash: authorityCommitHash,
    sourceDecisionHash: decision.semanticOutcomeHash,
    status: "PENDING" as const,
    jobs: [publicJob, ...seatJobs],
  };
  return { ...withoutHash, outboxHash: sha256Canonical(withoutHash) };
}

function narrativeJob(input: {
  runId: string;
  audience: { kind: "PUBLIC"; seatId: null } | { kind: "SEAT"; seatId: SeatIdV1 };
  authorityCommitHash: string;
  decision: SangtianPressureFinaleDecisionV1;
  allowedFactIds: string[];
  allowedObjectVersionIds: string[];
  allowedKnowledgeIds: string[];
  narrativeProfileVersion: string;
}): OpenNovelNarrativeProjectionJobV1 {
  const audienceKey = input.audience.kind === "PUBLIC"
    ? "public"
    : input.audience.seatId;
  return validateOpenNovelNarrativeProjectionJobV1({
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: `finale_narrative_${input.runId}_${audienceKey}`,
    runId: input.runId,
    audience: input.audience,
    sourceRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    projectionKind: "FINALE_NARRATIVE",
    sourceAuthority: "FINALE_FROZEN",
    sourceId: input.decision.executionFingerprint,
    sourceCommitHash: input.authorityCommitHash,
    sourceContentHash: input.decision.semanticOutcomeHash,
    allowedFactIds: input.allowedFactIds,
    allowedObjectVersionIds: input.allowedObjectVersionIds,
    allowedKnowledgeIds: input.allowedKnowledgeIds,
    narrativeProfileVersion: input.narrativeProfileVersion,
    idempotencyKey: `finale_narrative:${input.runId}:${audienceKey}:${input.authorityCommitHash}`,
  });
}

function validateTerminalResultArtifact(
  value: unknown,
  decision: SangtianPressureFinaleDecisionV1,
  authorityCommitHash: string,
): TerminalResultArtifactV1 {
  const artifact = validateAuthoritativePressureResultSnapshotV1(value, decision.runId);
  if (
    artifact.sourceCommitHash !== authorityCommitHash
    || artifact.decisionHash !== decision.semanticOutcomeHash
    || artifact.frozenRouteHash !== decision.routeHash
    || artifact.contentPackageSha256 !== decision.packageSha256
    || artifact.worldOutcome.outcomeId !== decision.worldOutcome.outcomeId
  ) invalid("terminalRecord.resultArtifact", "DECISION_BINDING_MISMATCH");
  for (const track of decision.tracks) {
    const stored = artifact.tracks.find((item) => item.trackId === track.trackId);
    if (!stored || stored.level !== track.level || sha256Canonical(stored.evidenceRefs) !== sha256Canonical(track.evidenceRefs)) {
      invalid("terminalRecord.resultArtifact.tracks", `DECISION_MISMATCH_${track.trackId}`);
    }
  }
  for (const seat of decision.seats) {
    const stored = artifact.seatOutcomes.find((item) => item.seatId === seat.seatId);
    if (!stored || stored.verdict !== seat.verdict) {
      invalid("terminalRecord.resultArtifact.seatOutcomes", `DECISION_MISMATCH_${seat.seatId}`);
    }
  }
  return artifact;
}

function validateFinaleNarrativeOutbox(
  value: unknown,
  decision: SangtianPressureFinaleDecisionV1,
  authorityCommitHash: string,
): FinaleNarrativeOutboxV1 {
  const outbox = plainRecord(value, "terminalRecord.narrativeOutbox");
  exactKeys(outbox, [
    "schemaVersion",
    "runId",
    "dedupeKey",
    "sourceCommitHash",
    "sourceDecisionHash",
    "status",
    "jobs",
    "outboxHash",
  ], "terminalRecord.narrativeOutbox");
  literal(outbox.schemaVersion, "sangtian_finale_narrative_outbox_v1", "terminalRecord.narrativeOutbox.schemaVersion");
  literal(outbox.status, "PENDING", "terminalRecord.narrativeOutbox.status");
  if (
    outbox.runId !== decision.runId
    || outbox.sourceCommitHash !== authorityCommitHash
    || outbox.sourceDecisionHash !== decision.semanticOutcomeHash
  ) invalid("terminalRecord.narrativeOutbox", "SOURCE_MISMATCH");
  const expectedOutboxDedupeKey = `finale_narrative:${decision.runId}:${authorityCommitHash}`;
  if (outbox.dedupeKey !== expectedOutboxDedupeKey) {
    invalid("terminalRecord.narrativeOutbox.dedupeKey", `EXPECTED_${expectedOutboxDedupeKey}`);
  }
  if (!Array.isArray(outbox.jobs) || outbox.jobs.length !== 7) {
    invalid("terminalRecord.narrativeOutbox.jobs", "EXPECTED_PUBLIC_PLUS_SIX_SEATS");
  }
  const jobs = outbox.jobs.map(validateOpenNovelNarrativeProjectionJobV1);
  if (jobs[0]?.audience.kind !== "PUBLIC" || jobs[0].audience.seatId !== null) {
    invalid("terminalRecord.narrativeOutbox.jobs[0].audience");
  }
  validateFinaleNarrativeJobSource(jobs[0]!, "public", decision, authorityCommitHash, 0);
  PRESSURE_CHAPTER_SEAT_IDS_V1.forEach((seatId, index) => {
    const job = jobs[index + 1];
    if (job?.audience.kind !== "SEAT" || job.audience.seatId !== seatId) {
      invalid(`terminalRecord.narrativeOutbox.jobs[${index + 1}].audience`);
    }
    validateFinaleNarrativeJobSource(
      job,
      seatId,
      decision,
      authorityCommitHash,
      index + 1,
    );
  });
  const expectedHash = hashWithoutField(outbox, "outboxHash");
  if (outbox.outboxHash !== expectedHash) invalid("terminalRecord.narrativeOutbox.outboxHash");
  return outbox as unknown as FinaleNarrativeOutboxV1;
}

function validateFinaleNarrativeJobSource(
  job: OpenNovelNarrativeProjectionJobV1,
  audienceKey: "public" | SeatIdV1,
  decision: SangtianPressureFinaleDecisionV1,
  authorityCommitHash: string,
  index: number,
): void {
  const expected = {
    jobId: `finale_narrative_${decision.runId}_${audienceKey}`,
    runId: decision.runId,
    sourceRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    projectionKind: "FINALE_NARRATIVE",
    sourceAuthority: "FINALE_FROZEN",
    sourceId: decision.executionFingerprint,
    sourceCommitHash: authorityCommitHash,
    sourceContentHash: decision.semanticOutcomeHash,
    idempotencyKey: `finale_narrative:${decision.runId}:${audienceKey}:${authorityCommitHash}`,
  } as const;
  for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
    if (job[field] !== expected[field]) {
      invalid(`terminalRecord.narrativeOutbox.jobs[${index}].${field}`, `EXPECTED_${expected[field]}`);
    }
  }
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "OBJECT");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function literal(value: unknown, expected: string, path: string): void {
  if (value !== expected) invalid(path, `EXPECTED_${expected}`);
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
}

function hash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) invalid(path, "SHA256");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function invalid(path: string, detail?: string): never {
  failTerminalCommit(ERROR.ATOMIC_RECORD_INVALID, path, detail);
}
