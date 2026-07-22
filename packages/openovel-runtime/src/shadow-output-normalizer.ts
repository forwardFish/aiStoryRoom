import { parseAndValidateShadowOutput } from "./shadow-output-validator";
import type { CompiledShadowContext, ShadowRuntimeFixture } from "./types";

/**
 * Writer v4 preserves every provider-authored story and decision character.
 * The server only binds stable IDs, action classes, target references, fixed
 * scene references, and evidence grounding. A failed hard contract is rejected;
 * server code never inserts or rewrites player-facing prose.
 */
export function normalizeAndValidateShadowOutput(
  rawText: string,
  context: CompiledShadowContext,
  fixture: ShadowRuntimeFixture
) {
  const validation = parseAndValidateShadowOutput(rawText, context, fixture);
  const serverMetadataBound = /openovel-shadow-writer-v[456]/u.test(rawText);
  return {
    validation,
    normalizedText: rawText,
    normalization: serverMetadataBound
      ? { kind: "SERVER_METADATA_BINDING", playerFacingTextModified: false }
      : null
  };
}
