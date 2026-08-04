import {
  normalizeNarrativeSurface,
  validateForegroundSurface,
  type SurfaceIntegrityResult,
} from "./surface-integrity.js";

export type SurfaceGuardInput = {
  text: string;
  previousOpening?: string;
};

export type SurfaceGuardOutput = {
  text: string;
  integrity: SurfaceIntegrityResult;
};

/**
 * Technical surface checks only: empty/truncated/provider payload/internal
 * protocol leakage. Story semantics belong to TruthObserver/ReviewPolicy.
 */
export interface SurfaceGuardModule {
  readonly moduleId: string;
  normalize(text: string): string;
  inspect(input: SurfaceGuardInput): SurfaceGuardOutput;
}

export class DefaultSurfaceGuard implements SurfaceGuardModule {
  readonly moduleId = "openovel.surface-guard.v1";

  normalize(text: string) {
    return normalizeNarrativeSurface(text);
  }

  inspect(input: SurfaceGuardInput): SurfaceGuardOutput {
    const text = this.normalize(input.text);
    return {
      text,
      integrity: validateForegroundSurface(text, input.previousOpening || ""),
    };
  }
}
