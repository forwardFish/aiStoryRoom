import { hashNarrativeValue } from "./canonical.js";
import type {
  AudienceSafeNarrativeSourceV1,
  NarrativeContextV1,
} from "./contracts.js";

export class NarrativeContextCompilerV1 {
  compile(
    source: AudienceSafeNarrativeSourceV1,
    contextCompilerVersion: string,
  ): NarrativeContextV1 {
    const content = {
      schemaVersion: "pressure_narrative_context_v1" as const,
      contextCompilerVersion,
      projectionKind: source.projectionKind,
      audience: structuredClone(source.audience),
      sourceId: source.sourceId,
      sourceCommitHash: source.sourceCommitHash,
      sourceContentHash: source.sourceContentHash,
      temporalInstruction: temporalInstruction(source),
      facts: structuredClone(source.facts),
      objects: structuredClone(source.objects),
      knowledge: structuredClone(source.knowledge),
      allowedClaims: structuredClone(source.allowedClaims),
      variant: structuredClone(source.variant),
    };
    return {
      ...content,
      contextHash: hashNarrativeValue(content),
    };
  }
}

function temporalInstruction(source: AudienceSafeNarrativeSourceV1): string {
  switch (source.variant.kind) {
    case "GENESIS":
      return "Describe the frozen P0 opening only. Do not invent player decisions.";
    case "BEAT":
      return "Describe committed chapter-working feedback only. It is not a Frozen chapter result.";
    case "CHAPTER":
      return "Describe the unique frozen ChapterSettlement result and its authorized consequences.";
    case "FINALE":
      return "Describe the committed world outcome and only the viewer-authorized seat verdict.";
  }
}
