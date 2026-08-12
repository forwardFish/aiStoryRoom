import { createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  ensureDir,
  exists,
  readJson,
  readText,
  writeAtomic,
  writeJsonAtomic,
} from "./io.js";
import type { WorkspacePaths } from "./paths.js";
import type {
  AuthoritativeCommitMetadata,
  NarrativeStatus,
  OpenNovelOption,
  TurnResult,
} from "./types.js";
import { actionConflict } from "./runtime-errors.js";

export const ATOMIC_HEAD_SCHEMA = "omw.atomic-head.v1" as const;

export type MaterializedTurnView = {
  relativePath: string;
  format: "text" | "json" | "jsonl";
  value: unknown;
  restoreMode?: "REPLACE" | "APPEND_ONLY";
};

export type AtomicTurnProjection = {
  stateRevision: unknown;
  causalEvents: unknown[];
  delayedEvents: unknown[];
  projectionSummary: unknown;
  materializedViews?: MaterializedTurnView[];
};

export type AtomicNarrativeEvidence = {
  status?: NarrativeStatus;
  originalText: string;
  narrativeOwner?: "COMPOSED" | "NARRATOR" | "FALLBACK" | "PROTECTED_RENDERER";
  renderPlan?: unknown;
  contextText?: string;
  factText?: string;
  shadowClaims?: unknown[];
  disposition: unknown;
  originalReview?: unknown;
  originalComparison?: unknown;
  fallbackReason?: string;
  sceneDraft?: unknown;
  sceneAudit?: unknown;
  assemblyManifest?: unknown;
};

export type AtomicTurnCommitInput = {
  runId: string;
  submissionId: string;
  turnId: string;
  turnNumber: number;
  action: string;
  selectedOption: OpenNovelOption | null;
  result: TurnResult;
  beatManifest: unknown;
  narrative: AtomicNarrativeEvidence;
  projection: AtomicTurnProjection;
  modelLedger: unknown[];
  previousCanon: string;
  previousContextCanon?: string;
  authoritativeCanonText?: string;
};

export type AtomicTurnHead = {
  schema: typeof ATOMIC_HEAD_SCHEMA;
  runId: string;
  turnId: string;
  turnNumber: number;
  submissionId: string;
  committedAt: string;
  artifactDirectory: string;
  artifacts: Record<string, string>;
  previousHeadHash: string | null;
  authoritativeResultStatus?: "FINALIZED";
  narrativeStatus?: NarrativeStatus;
  headHash: string;
};

export type AtomicTurnCommitResult = {
  head: AtomicTurnHead;
  result: TurnResult;
  alreadyCommitted: boolean;
};

export class FileAtomicTurnRepository {
  constructor(private readonly paths: WorkspacePaths) {}

  async loadHead(): Promise<AtomicTurnHead | null> {
    if (!await exists(this.paths.head)) return null;
    const raw = await readText(this.paths.head, "");
    let head: AtomicTurnHead;
    try {
      head = JSON.parse(raw) as AtomicTurnHead;
    } catch {
      throw new Error("ATOMIC_HEAD_CORRUPT");
    }
    await this.verifyHead(head);
    return head;
  }

  async commit(input: AtomicTurnCommitInput): Promise<AtomicTurnCommitResult> {
    const current = await this.loadHead();
    if (current?.submissionId === input.submissionId) {
      const envelope = await this.readArtifactJson<{
        turnId: string;
        turnNumber: number;
        action: string;
      }>(current, "envelope.json");
      if (
        envelope.turnId !== input.turnId
        || envelope.turnNumber !== input.turnNumber
        || envelope.action !== input.action
      ) {
        throw actionConflict("IDEMPOTENCY_KEY_REUSED");
      }
      return {
        head: current,
        result: withAuthoritativeCommit(
          await this.readArtifactJson<TurnResult>(current, "result.json"),
          current,
        ),
        alreadyCommitted: true,
      };
    }
    if (current && input.turnNumber !== current.turnNumber + 1) {
      throw new Error("ATOMIC_TURN_REVISION_CONFLICT");
    }
    if (!current && input.turnNumber !== 1) {
      throw new Error("ATOMIC_TURN_REVISION_CONFLICT");
    }

    const authoritativeCanonText = String(
      input.authoritativeCanonText ?? input.result.narration,
    ).trim();
    const chapter = [
      `**读者选择**：${input.action}`,
      "",
      authoritativeCanonText,
    ].join("\n");
    const fullCanon = `${input.previousCanon.trimEnd()}\n\n${chapter}\n`.trimStart();
    const contextNarration = String(
      input.narrative.contextText || input.result.narration,
    ).trim();
    const factNarration = String(
      input.narrative.factText || contextNarration,
    ).trim();
    const contextChapter = [
      `**读者选择**：${input.action}`,
      "",
      contextNarration,
    ].join("\n");
    const previousContextCanon = String(
      input.previousContextCanon ?? input.previousCanon,
    );
    const fullContextCanon = `${previousContextCanon.trimEnd()}\n\n${contextChapter}\n`.trimStart();
    const views = input.projection.materializedViews || [];
    const envelope = {
      runId: input.runId,
      submissionId: input.submissionId,
      turnId: input.turnId,
      turnNumber: input.turnNumber,
      action: input.action,
      selectedOption: input.selectedOption,
      causalDelta: input.result.causalDelta,
    };
    const authorityArtifacts = new Map<string, string>([
      ["envelope.json", jsonText(envelope)],
      ["proposed-state.json", jsonText(input.projection.stateRevision)],
      ["causal-events.json", jsonText(input.projection.causalEvents)],
      ["delayed-events.json", jsonText(input.projection.delayedEvents)],
      ["beat-manifest.json", jsonText(input.beatManifest)],
      ["authoritative-canon.json", jsonText({
        source: "SETTLEMENT",
        stateRevision: input.projection.stateRevision,
        causalEvents: input.projection.causalEvents,
        delayedEvents: input.projection.delayedEvents,
        beatManifest: input.beatManifest,
      })],
      ["projection-summary.json", jsonText(input.projection.projectionSummary)],
      ["materialized-views.json", jsonText(views)],
      ["canon.md", `${fullCanon.trimEnd()}\n`],
      ["context-canon.md", `${fullContextCanon.trimEnd()}\n`],
      ["options.json", jsonText(input.result.options)],
      ["result.json", jsonText(input.result)],
    ]);
    const artifacts = input.narrative.status === "PENDING"
      ? authorityArtifacts
      : new Map<string, string>([
          ...authorityArtifacts,
          ["scene-draft.json", jsonText(input.narrative.sceneDraft || null)],
          ["scene-render-plan.json", jsonText(input.narrative.renderPlan || null)],
          ["scene-audit.json", jsonText(input.narrative.sceneAudit || null)],
          ["assembly-manifest.json", jsonText(input.narrative.assemblyManifest || null)],
          ["narrative.original.md", `${input.narrative.originalText.trim()}\n`],
          ["truth-review.original.json", jsonText(input.narrative.originalReview || null)],
          ["narrative.final.md", `${input.result.narration.trim()}\n`],
          ["published-prose.md", `${input.result.narration.trim()}\n`],
          ["context-prose.md", `${contextNarration}\n`],
          ["fact-projection.md", `${factNarration}\n`],
          ["shadow-claims.json", jsonText(input.narrative.shadowClaims || [])],
          ["disposition.json", jsonText({
            narrativeOwner: input.narrative.narrativeOwner || null,
            disposition: input.narrative.disposition,
            originalComparison: input.narrative.originalComparison || null,
            fallbackReason: input.narrative.fallbackReason || null,
          })],
          ["model-calls.json", jsonText(input.modelLedger)],
        ]);
    const contentHash = sha256([...artifacts.entries()]
      .map(([name, content]) => `${name}\0${sha256(content)}`)
      .join("\n"));
    const commitId = `${safeSegment(input.submissionId)}-${contentHash.slice(0, 16)}`;
    const artifactDirectory = path.posix.join("turns", input.turnId, commitId);
    const absoluteDirectory = resolveInsideRun(this.paths, artifactDirectory);
    await ensureDir(absoluteDirectory);

    const hashes: Record<string, string> = {};
    for (const [name, content] of artifacts) {
      const file = path.join(absoluteDirectory, name);
      await writeAtomic(file, content);
      hashes[name] = sha256(content);
    }
    const headWithoutHash = {
      schema: ATOMIC_HEAD_SCHEMA,
      runId: input.runId,
      turnId: input.turnId,
      turnNumber: input.turnNumber,
      submissionId: input.submissionId,
      committedAt: input.result.committedAt,
      artifactDirectory,
      artifacts: hashes,
      previousHeadHash: current?.headHash || null,
      authoritativeResultStatus: "FINALIZED" as const,
      narrativeStatus: input.result.narrativeStatus || input.narrative.status || "PUBLISHED",
    };
    const head: AtomicTurnHead = {
      ...headWithoutHash,
      headHash: sha256(stableStringify(headWithoutHash)),
    };

    // Preserve every signed Head before advancing the mutable pointer. The
    // previousHeadHash chain is therefore independently replayable instead of
    // referring to a document that was overwritten by the next turn.
    await ensureDir(this.paths.headsDir);
    await writeJsonAtomic(path.join(this.paths.headsDir, `${head.headHash}.json`), head);
    // This replacement is the only commit point. Everything above may leave
    // unreferenced artifacts, but none of them are Canon until Head advances.
    await writeJsonAtomic(this.paths.head, head);
    return {
      head,
      result: withAuthoritativeCommit(input.result, head),
      alreadyCommitted: false,
    };
  }

  async resultBySubmission(submissionId: string, expectedAction?: string) {
    let head = await this.loadHead();
    while (head) {
      if (head.submissionId === submissionId) {
        const envelope = await this.readArtifactJson<{
          submissionId: string;
          action: string;
        }>(head, "envelope.json");
        if (
          envelope.submissionId !== submissionId
          || (expectedAction !== undefined && envelope.action !== expectedAction)
        ) {
          throw actionConflict("IDEMPOTENCY_KEY_REUSED");
        }
        return withAuthoritativeCommit(
          await this.readArtifactJson<TurnResult>(head, "result.json"),
          head,
        );
      }
      head = await this.previousHead(head);
    }
    return null;
  }

  async latestResult() {
    const head = await this.loadHead();
    return head
      ? withAuthoritativeCommit(
          await this.readArtifactJson<TurnResult>(head, "result.json"),
          head,
        )
      : null;
  }

  async canonicalText() {
    const head = await this.loadHead();
    return head ? this.readArtifactText(head, "canon.md") : null;
  }

  async restoreMaterializedViews() {
    const head = await this.loadHead();
    if (!head) return { restored: 0, head: null };
    const views = await this.readArtifactJson<MaterializedTurnView[]>(
      head,
      "materialized-views.json",
    );
    let restored = 0;
    for (const view of views) {
      const target = resolveInsideRun(this.paths, normalizeRelativePath(view.relativePath));
      if (view.format === "text") {
        await writeAtomic(target, String(view.value ?? ""));
      } else if (view.format === "json") {
        await writeJsonAtomic(target, view.value);
      } else if (view.format === "jsonl") {
        const values = Array.isArray(view.value) ? view.value : [];
        const materialized = view.restoreMode === "APPEND_ONLY"
          ? mergeAppendOnlyRecords(
              values,
              parseJsonLines(await readText(target, "")),
            )
          : values;
        const content = materialized.length
          ? `${materialized.map((item) => JSON.stringify(item)).join("\n")}\n`
          : "";
        await writeAtomic(target, content);
      } else {
        throw new Error("ATOMIC_MATERIALIZED_VIEW_INVALID");
      }
      restored += 1;
    }
    return { restored, head };
  }

  async readArtifactText(head: AtomicTurnHead, name: string) {
    if (!head.artifacts[name]) throw new Error("ATOMIC_HEAD_CORRUPT");
    return readFile(path.join(resolveInsideRun(this.paths, head.artifactDirectory), name), "utf8");
  }

  async readArtifactJson<T>(head: AtomicTurnHead, name: string) {
    const text = await this.readArtifactText(head, name);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("ATOMIC_HEAD_CORRUPT");
    }
  }

  private async verifyHead(head: AtomicTurnHead, seen = new Set<string>()) {
    if (
      head?.schema !== ATOMIC_HEAD_SCHEMA
      || head.runId !== this.paths.runId
      || !/^T\d{2,}$/u.test(String(head.turnId || ""))
      || !Number.isInteger(head.turnNumber)
      || head.turnNumber < 1
      || !head.submissionId
      || !head.artifactDirectory
      || !head.artifacts
    ) {
      throw new Error("ATOMIC_HEAD_CORRUPT");
    }
    const { headHash, ...withoutHash } = head;
    if (headHash !== sha256(stableStringify(withoutHash))) {
      throw new Error("ATOMIC_HEAD_CORRUPT");
    }
    if (seen.has(headHash)) throw new Error("ATOMIC_HEAD_CORRUPT");
    seen.add(headHash);
    const directory = resolveInsideRun(this.paths, head.artifactDirectory);
    for (const [name, expectedHash] of Object.entries(head.artifacts)) {
      if (!/^[A-Za-z0-9._-]+$/u.test(name)) throw new Error("ATOMIC_HEAD_CORRUPT");
      let content: string;
      try {
        content = await readFile(path.join(directory, name), "utf8");
      } catch {
        throw new Error("ATOMIC_HEAD_CORRUPT");
      }
      if (sha256(content) !== expectedHash) throw new Error("ATOMIC_HEAD_CORRUPT");
    }
    if (head.previousHeadHash) {
      const previousPath = path.join(this.paths.headsDir, `${head.previousHeadHash}.json`);
      let previous: AtomicTurnHead;
      try {
        previous = JSON.parse(await readFile(previousPath, "utf8")) as AtomicTurnHead;
      } catch {
        throw new Error("ATOMIC_HEAD_CORRUPT");
      }
      if (previous.headHash !== head.previousHeadHash) {
        throw new Error("ATOMIC_HEAD_CORRUPT");
      }
      await this.verifyHead(previous, seen);
    }
  }

  private async previousHead(head: AtomicTurnHead): Promise<AtomicTurnHead | null> {
    if (!head.previousHeadHash) return null;
    const previousPath = path.join(this.paths.headsDir, `${head.previousHeadHash}.json`);
    let previous: AtomicTurnHead;
    try {
      previous = JSON.parse(await readFile(previousPath, "utf8")) as AtomicTurnHead;
    } catch {
      throw new Error("ATOMIC_HEAD_CORRUPT");
    }
    if (previous.headHash !== head.previousHeadHash) {
      throw new Error("ATOMIC_HEAD_CORRUPT");
    }
    return previous;
  }
}

function parseJsonLines(value: string): unknown[] {
  return value.split(/\r?\n/u).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

function withAuthoritativeCommit(
  result: TurnResult,
  head: AtomicTurnHead,
): TurnResult {
  const authoritativeCommit: AuthoritativeCommitMetadata = {
    schema: head.schema,
    sourceCommitHash: head.headHash,
    artifactDirectory: head.artifactDirectory,
    previousSourceCommitHash: head.previousHeadHash,
    committedAt: head.committedAt,
    turnId: head.turnId,
    turnNumber: head.turnNumber,
  };
  return {
    ...result,
    authoritativeResultStatus: "FINALIZED",
    narrativeStatus: head.narrativeStatus || result.narrativeStatus || "PUBLISHED",
    sourceCommitHash: head.headHash,
    artifactDirectory: head.artifactDirectory,
    authoritativeCommit,
  };
}

function mergeAppendOnlyRecords(committed: unknown[], live: unknown[]) {
  const merged: unknown[] = [];
  const seen = new Set<string>();
  for (const item of [...committed, ...live]) {
    const key = appendOnlyRecordKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function appendOnlyRecordKey(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = String((value as Record<string, unknown>).id || "").trim();
    if (id) return `id:${id}`;
  }
  return `value:${stableStringify(value)}`;
}

function jsonText(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeSegment(value: string) {
  const segment = String(value || "").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 64);
  if (!segment) throw new Error("ATOMIC_SUBMISSION_ID_INVALID");
  return segment;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  )).join(",")}}`;
}

function relativeInsideRun(paths: WorkspacePaths, target: string) {
  const relative = path.relative(paths.root, target);
  return normalizeRelativePath(relative.split(path.sep).join("/"));
}

function normalizeRelativePath(value: string) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized)) {
    throw new Error("ATOMIC_ARTIFACT_PATH_INVALID");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("ATOMIC_ARTIFACT_PATH_INVALID");
  }
  return parts.join("/");
}

function resolveInsideRun(paths: WorkspacePaths, relative: string) {
  const normalized = normalizeRelativePath(relative);
  const target = path.resolve(paths.root, ...normalized.split("/"));
  const prefix = `${path.resolve(paths.root)}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error("ATOMIC_ARTIFACT_PATH_INVALID");
  return target;
}
