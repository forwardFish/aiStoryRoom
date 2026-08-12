import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  validateOpenNovelNarrativeProjectionJobV1,
  type OpenNovelNarrativeProjectionJobV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  AuthoritativeNarrativeSnapshotCompilerPortV1,
} from "../persistence";
import {
  validateAuthorityFirstTerminalRecordV1,
  type AuthorityFirstTerminalRecordV1,
} from "../terminal-commit";
import {
  PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureNarrativeProduction,
} from "./errors";

type Visibility = "PUBLIC" | "AUTHORIZED";

interface SnapshotAclV1 {
  visibility: Visibility;
  authorizedSeatIds: SeatIdV1[];
}

interface MutableAclV1 {
  public: boolean;
  seats: Set<SeatIdV1>;
}

/**
 * Compiles the immutable finale commit into the full server-side source that
 * the API AudienceProjector will reduce for one viewer. No raw terminal row is
 * ever returned to OpenNovel.
 *
 * The current durable schema contains sufficient binding data only for the
 * Pressure finale. Genesis/beat/chapter jobs fail closed until their producers
 * persist an equally complete committed presentation catalog.
 */
export class FinaleAuthoritativeNarrativeSnapshotCompilerV1
implements AuthoritativeNarrativeSnapshotCompilerPortV1 {
  compile(
    jobValue: Readonly<OpenNovelNarrativeProjectionJobV1>,
    rawAuthority: Readonly<unknown>,
  ): unknown {
    const job = validateOpenNovelNarrativeProjectionJobV1(jobValue);
    if (
      job.sourceAuthority !== "FINALE_FROZEN"
      || job.projectionKind !== "FINALE_NARRATIVE"
    ) {
      return failPressureNarrativeProduction(
        ERROR.AUTHORITY_COMPILATION_UNSUPPORTED,
        "narrativeJob.sourceAuthority",
        `${job.sourceAuthority}:${job.projectionKind}`,
      );
    }

    const row = plainRecord(rawAuthority, "rawFinaleAuthority");
    const record = terminalRecord(row.commitManifestJson);
    assertFinaleRowBinding(row, record, job);
    assertCommittedJob(record, job);

    const factAcls = collectAllowlistAcls(record, "allowedFactIds");
    const objectAcls = collectAllowlistAcls(record, "allowedObjectVersionIds");
    const knowledgeAcls = collectAllowlistAcls(record, "allowedKnowledgeIds");
    assertEveryJobCanBeProjected(record, factAcls, "allowedFactIds");
    assertEveryJobCanBeProjected(record, objectAcls, "allowedObjectVersionIds");
    assertEveryJobCanBeProjected(record, knowledgeAcls, "allowedKnowledgeIds");

    const factualText = finaleReferenceText(record);
    const facts = [...factAcls.entries()]
      .sort(byFirst)
      .map(([factId, mutableAcl]) => ({
        factId,
        text: factualText.get(factId) ?? `已确认事实引用：${factId}`,
        temporalStatus: "FROZEN" as const,
        ...freezeAcl(mutableAcl),
      }));
    const objects = [...objectAcls.entries()]
      .sort(byFirst)
      .map(([objectVersionId, mutableAcl]) => ({
        objectVersionId,
        label: objectVersionId,
        stateText: `已冻结对象版本：${objectVersionId}`,
        ...freezeAcl(mutableAcl),
      }));
    const knowledge = [...knowledgeAcls.entries()]
      .sort(byFirst)
      .map(([knowledgeId, mutableAcl]) => ({
        knowledgeId,
        text: factualText.get(knowledgeId) ?? `已授权知识引用：${knowledgeId}`,
        ...freezeAcl(mutableAcl),
      }));

    const worldOutcomeRef = record.decision.worldOutcome.outcomeId;
    const claims = [
      ...facts.map((fact) => ({
        kind: "FACT" as const,
        refId: fact.factId,
        statement: fact.text,
        required: false,
        visibility: fact.visibility,
        authorizedSeatIds: [...fact.authorizedSeatIds],
      })),
      ...objects.map((object) => ({
        kind: "OBJECT" as const,
        refId: object.objectVersionId,
        statement: object.stateText,
        required: false,
        visibility: object.visibility,
        authorizedSeatIds: [...object.authorizedSeatIds],
      })),
      ...knowledge.map((entry) => ({
        kind: "KNOWLEDGE" as const,
        refId: entry.knowledgeId,
        statement: entry.text,
        required: false,
        visibility: entry.visibility,
        authorizedSeatIds: [...entry.authorizedSeatIds],
      })),
      {
        kind: "OUTCOME" as const,
        refId: worldOutcomeRef,
        statement: finaleOutcomeStatement(record),
        required: true,
        visibility: "PUBLIC" as const,
        authorizedSeatIds: [] as SeatIdV1[],
      },
      ...PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        kind: "VERDICT" as const,
        refId: finaleVerdictRef(record, seatId),
        statement: finaleVerdictStatement(record, seatId),
        required: true,
        visibility: "AUTHORIZED" as const,
        authorizedSeatIds: [seatId],
      })),
    ].sort((left, right) => compareText(
      `${left.kind}\u0000${left.refId}`,
      `${right.kind}\u0000${right.refId}`,
    ));

    const publicVariant = {
      kind: "FINALE" as const,
      terminalKind: "PRESSURE_FINALE" as const,
      worldOutcomeRef,
      viewerVerdictRef: null,
    };
    const seatVariants = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      variant: {
        kind: "FINALE" as const,
        terminalKind: "PRESSURE_FINALE" as const,
        worldOutcomeRef,
        viewerVerdictRef: finaleVerdictRef(record, seatId),
      },
    }));

    return {
      schemaVersion: "authoritative_narrative_source_snapshot_v1" as const,
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
      publicVariant,
      seatVariants,
    };
  }
}

function terminalRecord(value: unknown): AuthorityFirstTerminalRecordV1 {
  try {
    return validateAuthorityFirstTerminalRecordV1(value);
  } catch (cause) {
    return failPressureNarrativeProduction(
      ERROR.AUTHORITY_COMPILATION_INVALID,
      "rawFinaleAuthority.commitManifestJson",
      safeCause(cause),
    );
  }
}

function assertFinaleRowBinding(
  row: Record<string, unknown>,
  record: AuthorityFirstTerminalRecordV1,
  job: OpenNovelNarrativeProjectionJobV1,
): void {
  const expected: Record<string, string> = {
    runId: record.runId,
    commitHash: record.authorityCommitHash,
    commitManifestHash: record.atomicRecordHash,
    executionFingerprint: record.decision.executionFingerprint,
    semanticOutcomeHash: record.decision.semanticOutcomeHash,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (row[field] !== value) invalid(`rawFinaleAuthority.${field}`, "ROW_BINDING_MISMATCH");
  }
  if (
    job.runId !== record.runId
    || job.sourceId !== record.decision.executionFingerprint
    || job.sourceCommitHash !== record.authorityCommitHash
    || job.sourceContentHash !== record.decision.semanticOutcomeHash
  ) invalid("narrativeJob", "TERMINAL_RECORD_BINDING_MISMATCH");
}

function assertCommittedJob(
  record: AuthorityFirstTerminalRecordV1,
  job: OpenNovelNarrativeProjectionJobV1,
): void {
  const candidate = record.narrativeOutbox.jobs.find((item) => item.jobId === job.jobId);
  if (!candidate || sha256Canonical(candidate) !== sha256Canonical(job)) {
    invalid("narrativeJob", "NOT_IN_COMMITTED_TERMINAL_OUTBOX");
  }
}

function collectAllowlistAcls(
  record: AuthorityFirstTerminalRecordV1,
  field: "allowedFactIds" | "allowedObjectVersionIds" | "allowedKnowledgeIds",
): Map<string, MutableAclV1> {
  const result = new Map<string, MutableAclV1>();
  for (const job of record.narrativeOutbox.jobs) {
    for (const id of job[field]) {
      const current = result.get(id) ?? { public: false, seats: new Set<SeatIdV1>() };
      if (job.audience.kind === "PUBLIC") current.public = true;
      else current.seats.add(job.audience.seatId!);
      result.set(id, current);
    }
  }
  return result;
}

function assertEveryJobCanBeProjected(
  record: AuthorityFirstTerminalRecordV1,
  acls: Map<string, MutableAclV1>,
  field: "allowedFactIds" | "allowedObjectVersionIds" | "allowedKnowledgeIds",
): void {
  for (const job of record.narrativeOutbox.jobs) {
    const actual = [...acls.entries()]
      .filter(([, acl]) => acl.public || (
        job.audience.kind === "SEAT" && acl.seats.has(job.audience.seatId!)
      ))
      .map(([id]) => id)
      .sort(compareText);
    if (sha256Canonical(actual) !== sha256Canonical(job[field])) {
      invalid(`terminalRecord.narrativeOutbox.${field}`, "AUDIENCE_ACL_INCONSISTENT");
    }
  }
}

function freezeAcl(value: MutableAclV1): SnapshotAclV1 {
  if (value.public) {
    if (value.seats.size !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
      invalid("terminalRecord.narrativeOutbox", "PUBLIC_ITEM_NOT_ALLOWED_TO_EVERY_SEAT");
    }
    return { visibility: "PUBLIC", authorizedSeatIds: [] };
  }
  const authorizedSeatIds = PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => (
    value.seats.has(seatId)
  ));
  if (authorizedSeatIds.length === 0) invalid("terminalRecord.narrativeOutbox", "UNREACHABLE_ITEM");
  return { visibility: "AUTHORIZED", authorizedSeatIds };
}

function finaleReferenceText(record: AuthorityFirstTerminalRecordV1): Map<string, string> {
  const result = new Map<string, string>();
  for (const impact of record.resultArtifact.impacts) {
    result.set(impact.outcomeId, `${impact.title}：${impact.summary}`);
  }
  for (const reveal of record.resultArtifact.reveals) {
    result.set(reveal.revealId, `${reveal.title}：${reveal.text}`);
  }
  for (const seat of record.resultArtifact.seatOutcomes) {
    for (const cause of seat.causes) {
      const next = `${cause.title}：${cause.factText}`;
      const current = result.get(cause.frozenFactRef);
      if (current === undefined || current === next) result.set(cause.frozenFactRef, next);
    }
  }
  return result;
}

function finaleOutcomeStatement(record: AuthorityFirstTerminalRecordV1): string {
  const outcome = record.resultArtifact.worldOutcome;
  return `${outcome.title}。${outcome.verdictLine} ${outcome.summary}`;
}

function finaleVerdictRef(
  record: AuthorityFirstTerminalRecordV1,
  seatId: SeatIdV1,
): string {
  return `seat.${seatId}.verdict.${record.decision.semanticOutcomeHash.slice(0, 16)}`;
}

function finaleVerdictStatement(
  record: AuthorityFirstTerminalRecordV1,
  seatId: SeatIdV1,
): string {
  const seat = record.resultArtifact.seatOutcomes.find((item) => item.seatId === seatId);
  if (!seat) return invalid(`terminalRecord.resultArtifact.seatOutcomes.${seatId}`, "MISSING");
  const gains = seat.gain.length > 0 ? seat.gain.join("；") : "无额外所得";
  const losses = seat.loss.length > 0 ? seat.loss.join("；") : "无额外损失";
  return `${seat.roleName}：${seat.verdictLabel}。所得：${gains}。所失：${losses}。`;
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(path, "OBJECT");
  }
  return value as Record<string, unknown>;
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

function safeCause(value: unknown): string {
  return value instanceof Error ? `${value.name}:${value.message}` : String(value);
}

function invalid(path: string, detail?: string): never {
  return failPressureNarrativeProduction(
    ERROR.AUTHORITY_COMPILATION_INVALID,
    path,
    detail,
  );
}
