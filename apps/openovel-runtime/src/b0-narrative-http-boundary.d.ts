import type { B0NarrativeInputV1 } from "./b0-narrative-runtime.js";
import "./b0-narrative-runtime.js";

/**
 * HTTP JSON enters the runtime as unknown-valued records. The implementation
 * of buildB0NarrativeInputV1 performs the authoritative manifest, publication,
 * guidance, sequence and audience validation before a job can be created.
 *
 * This overload is intentionally scoped to the transport boundary; it does not
 * change the runtime object's output contract or bypass any validator.
 */
declare module "./b0-narrative-runtime.js" {
  export function buildB0NarrativeInputV1(input: {
    manifest: any;
    publicationPlan: any;
    recipientActorId: string;
    appliedWorldSequence: number;
    guidance: any;
    actorLabels?: any;
  }): B0NarrativeInputV1;
}

export {};
