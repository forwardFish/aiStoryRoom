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
import type { OpenNovelOption, TurnResult } from "./types.js";

export const ATOMIC_HEAD_SCHEMA = "omw.atomic-head.v1" as const;

export type MaterializedTurnView = {
  relativePath: string;
  format: "text" | "json" | "jsonl";
  value: unknown;
};

export type AtomicTurnProjection = {
  stateRevision: unknown;
  causalEvents: unknown[];
  delayedEvents: unknown[];
  projectionSummary: unknown;
  materializedViews?: MaterializedTurnView[];
};

export type AtomicNarrativeEvidence = {
  originalText: string;
  repairedText?: string;
  disposition: unknown;
  originalReview?: unknown;
  finalReview?: unknown;
  originalComparison?: unknown;
  finalComparison?: unknown;
  fallbackReason?: string;
};

export type AtomicTurnCommitInput = {
  runId: string;
  submissionId: string;
  turnId: string;
  turnNumber: number;
  action: string;
  selectedOption: OpenNovelOption | null;
  result: TurnResult;
  protectedBlocks: unknown[];
  narrative: AtomicNarrativeEvidence;
  projection: AtomicTurnProjection;
  modelLedger: unknown[];
  previousCanon: string;
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
  headHash: string;
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

  async commit(input: AtomicTurnCommitInput) {
    const current = await this.loadHead();
    if (current?.submissionId === input.submissionId) {
      return {
        head: current,
        result: await this.readArtifactJson<TurnResult>(current, "result.json"),
        alreadyCommitted: true,
      };
    }
    if (current && input.turnNumber !== current.turnNumber + 1) {
      throw new Error("ATOMIC_TURN_REVISION_CONFLICT");
    }
    if (!current && input.turnNumber !== 1) {
      throw new Error("ATOMIC_TURN_REVISION_CONFLICT");
    }

    const chapter = [
      `**读者选择**：${input.action}`,
      "",
      input.result.narration.trim(),
    ].join("\n");
    const fullCanon = `${input.previousCanon.trimEnd()}\n\n${chapter}\n`.trimStart();
    const views = [
      {
        relativePath: relativeInsideRun(this.paths, this.paths.chapters),
        format: "text" as const,
        value: fullCanon,
      },
      {
        relativePath: relativeInsideRun(this.paths, this.paths.chaptersRecent),
        format: "text" as const,
        value: `${input.result.narration.trim()}\n`,
      },
      {
        relativePath: relativeInsideRun(this.paths, this.paths.currentOptions),
        format: "json" as const,
        value: [],
      },
      ...(input.projection.materializedViews || []),
    ];
    const envelope = {
      runId: input.runId,
      submissionId: input.submissionId,
      turnId: input.turnId,
      turnNumber: input.turnNumber,
      action: input.action,
      selectedOption: input.selectedOption,
      causalDelta: input.result.causalDelta,
    };
    const artifacts = new Map<string, string>([
      ["envelope.json", jsonText(envelope)],
      ["proposed-state.json", jsonText(input.projection.stateRevision)],
      ["causal-events.json", jsonText(input.projection.causalEvents)],
      ["delayed-events.json", jsonText(input.projection.delayedEvents)],
      ["protected-blocks.json", jsonText(input.protectedBlocks)],
      ["narrative.original.md", `${input.narrative.originalText.trim()}\n`],
      ["truth-review.original.json", jsonText(input.narrative.originalReview || null)],
      ["narrative.repaired.md", input.narrative.repairedText
        ? `${input.narrative.repairedText.trim()}\n`
        : ""],
      ["truth-review.final.json", jsonText(input.narrative.finalReview || null)],
      ["narrative.final.md", `${input.result.narration.trim()}\n`],
      ["disposition.json", jsonText({
        disposition: input.narrative.disposition,
        originalComparison: input.narrative.originalComparison || null,
        finalComparison: input.narrative.finalComparison || null,
        fallbackReason: input.narrative.fallbackReason || null,
      })],
      ["model-calls.json", jsonText(input.modelLedger)],
      ["projection-summary.json", jsonText(input.projection.projectionSummary)],
      ["materialized-views.json", jsonText(views)],
      ["canon.md", `${fullCanon.trimEnd()}\n`],
      ["options.json", jsonText([])],
      ["result.json", jsonText(input.result)],
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
    };
    const head: AtomicTurnHead = {
      ...headWithoutHash,
      headHash: sha256(stableStringify(headWithoutHash)),
    };

    // This replacement is the only commit point. Everything above may leave
    // unreferenced artifacts, but none of them are Canon until Head advances.
    await writeJsonAtomic(this.paths.head, head);
    return { head, result: input.result, alreadyCommitted: false };
  }

  async resultBySubmission(submissionId: string) {
    const head = await this.loadHead();
    if (!head || head.submissionId !== submissionId) return null;
    return this.readArtifactJson<TurnResult>(head, "result.json");
  }

  async latestResult() {
    const head = await this.loadHead();
    return head ? this.readArtifactJson<TurnResult>(head, "result.json") : null;
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
        const content = values.length
          ? `${values.map((item) => JSON.stringify(item)).join("\n")}\n`
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

  private async verifyHead(head: AtomicTurnHead) {
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
  }
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
