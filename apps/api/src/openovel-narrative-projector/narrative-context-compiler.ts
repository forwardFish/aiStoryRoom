import { Injectable } from "@nestjs/common";
import type { OpenNovelNarrativeSourceV1 } from "./openovel-narrative-projector.contract";

export type CompiledNarrativeContextV1 = Readonly<{
  sourceCommitHash: string;
  providerInput: unknown;
  forbiddenPhrases: readonly string[];
  forbiddenClaims: readonly string[];
  fallbackLines: readonly string[];
}>;

@Injectable()
export class NarrativeContextCompiler {
  compile(source: OpenNovelNarrativeSourceV1): CompiledNarrativeContextV1 {
    return Object.freeze({
      sourceCommitHash: source.sourceCommitHash,
      providerInput: structuredClone(source.providerInput),
      forbiddenPhrases: Object.freeze([...source.forbiddenPhrases]),
      forbiddenClaims: Object.freeze([...source.forbiddenClaims]),
      fallbackLines: Object.freeze([...source.fallbackLines]),
    });
  }
}
