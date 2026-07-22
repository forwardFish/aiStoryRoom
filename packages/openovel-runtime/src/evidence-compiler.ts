import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prettyJson, sha256 } from "./canonical";
import { openovelPaths } from "./paths";
import { validateEvidenceAuthoringSchema } from "./evidence-schema-validator";
import type {
  ChapterIndexEntry,
  EvidenceClaim,
  EvidenceManifest,
  EvidencePackage,
  EvidenceScene
} from "./types";

export const EVIDENCE_COMPILER_VERSION = "openovel-evidence-compiler-v1";

export function compileEvidencePackage(repoRoot?: string): EvidencePackage {
  const paths = openovelPaths(repoRoot);
  const authoring: unknown = JSON.parse(readFileSync(paths.authoringPath, "utf8"));
  validateEvidenceAuthoringSchema(authoring, paths.authoringSchemaPath);

  const sourcePath = join(paths.repoRoot, ...authoring.source.path.split("/"));
  const sourceBuffer = readFileSync(sourcePath);
  const sourceSha256 = sha256(sourceBuffer);
  if (sourceSha256 !== authoring.source.sha256) {
    throw new Error(`SOURCE_HASH_MISMATCH: expected ${authoring.source.sha256}, got ${sourceSha256}`);
  }
  const sourceLines = splitSourceLines(sourceBuffer);
  const chapterIndex = buildChapterIndex(sourceLines);
  if (chapterIndex.length !== authoring.source.expectedChapterCount) {
    throw new Error(`CHAPTER_COUNT_MISMATCH: expected ${authoring.source.expectedChapterCount}, got ${chapterIndex.length}`);
  }

  const claims = authoring.claims
    .map<EvidenceClaim>((claim) => ({
      ...withoutLineRange(claim),
      evidence: {
        sourcePath: authoring.source.path,
        sourceSha256,
        chapterId: claim.chapterId,
        lineStart: claim.lineStart,
        lineEnd: claim.lineEnd,
        excerptSha256: hashLineRange(sourceLines, claim.lineStart, claim.lineEnd)
      }
    }))
    .sort((left, right) => left.claimId.localeCompare(right.claimId));

  const scenes = authoring.scenes
    .map<EvidenceScene>((scene) => ({
      ...scene,
      claimIds: claims.filter((claim) => claim.sceneId === scene.sceneId).map((claim) => claim.claimId),
      excerptSha256: hashLineRange(sourceLines, scene.lineStart, scene.lineEnd)
    }))
    .sort((left, right) => left.lineStart - right.lineStart);

  const serialized = {
    "chapter-index.json": prettyJson(chapterIndex),
    "scenes.json": prettyJson({ schemaVersion: "evidence_scenes_v1", scenes }),
    "claims.jsonl": `${claims.map((claim) => JSON.stringify(claim)).join("\n")}\n`,
    "continuity.json": prettyJson({ schemaVersion: "evidence_continuity_v1", chapters: authoring.continuity })
  };

  const manifest: EvidenceManifest = {
    schemaVersion: "source_evidence_manifest_v1",
    packageId: authoring.packageId,
    packageVersion: authoring.packageVersion,
    worldId: authoring.worldId,
    compilerVersion: EVIDENCE_COMPILER_VERSION,
    source: {
      path: authoring.source.path,
      sha256: sourceSha256,
      lineCount: sourceLines.length,
      chapterCount: chapterIndex.length
    },
    coverage: {
      chapterIds: [...new Set(claims.map((claim) => claim.chapterId))],
      sceneCount: scenes.length,
      claimCount: claims.length
    },
    files: Object.fromEntries(Object.entries(serialized).map(([name, content]) => [name, sha256(content)]))
  };

  return { manifest, chapterIndex, scenes, claims, continuity: authoring.continuity };
}

export function writeEvidencePackage(evidencePackage: EvidencePackage, repoRoot?: string): void {
  const paths = openovelPaths(repoRoot);
  mkdirSync(paths.generatedRoot, { recursive: true });
  const files: Record<string, string> = {
    [paths.chapterIndexPath]: prettyJson(evidencePackage.chapterIndex),
    [paths.scenesPath]: prettyJson({ schemaVersion: "evidence_scenes_v1", scenes: evidencePackage.scenes }),
    [paths.claimsPath]: `${evidencePackage.claims.map((claim) => JSON.stringify(claim)).join("\n")}\n`,
    [paths.continuityPath]: prettyJson({ schemaVersion: "evidence_continuity_v1", chapters: evidencePackage.continuity }),
    [paths.manifestPath]: prettyJson(evidencePackage.manifest)
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
}

export function buildChapterIndex(lines: string[]): ChapterIndexEntry[] {
  const markers: Array<{ line: number; title: string }> = [];
  const chapterPattern = /^第[〇零一二三四五六七八九十百两]+章\s*$/;
  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index]!.trim();
    if (chapterPattern.test(title)) markers.push({ line: index + 1, title });
  }
  return markers.map((marker, index) => ({
    chapterId: `DM1566-C${String(index + 1).padStart(2, "0")}`,
    ordinal: index + 1,
    title: marker.title,
    lineStart: marker.line,
    lineEnd: (markers[index + 1]?.line || lines.length + 1) - 1
  }));
}

export function hashLineRange(lines: string[], lineStart: number, lineEnd: number): string {
  if (lineStart < 1 || lineEnd < lineStart || lineEnd > lines.length) {
    throw new Error(`INVALID_LINE_RANGE: ${lineStart}-${lineEnd} for ${lines.length} lines`);
  }
  return sha256(lines.slice(lineStart - 1, lineEnd).join("\n"));
}

export function splitSourceLines(sourceBuffer: Buffer): string[] {
  const lines = sourceBuffer.toString("utf8").split(/\r?\n/);
  // A terminal newline ends the final physical line; split() otherwise creates
  // a synthetic extra line that editors and Get-Content do not address.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function withoutLineRange<T extends { lineStart: number; lineEnd: number }>(value: T): Omit<T, "lineStart" | "lineEnd"> {
  const { lineStart: _lineStart, lineEnd: _lineEnd, ...rest } = value;
  return rest;
}
