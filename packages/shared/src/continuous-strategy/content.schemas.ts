import type { ActionVisibility, PlayerActionSlot } from "./constants";

export type AssetMutationTemplateV1 = {
  mutationType: string;
  assetKey: string;
  delta: number;
  toRoleKey: string | null;
};

export type ContinuousActionCardV1 = {
  actionKey: string;
  roleKey: string;
  stageKey: string;
  slot: PlayerActionSlot;
  title: string;
  receipt: { receiptKey: string; text: string };
  effect: {
    effectKey: string;
    factKeys: string[];
    influenceEdges: Array<{ affectedRoleKey: string; effectKey: string; visibility: ActionVisibility }>;
    observableTraceKeys: string[];
    interactionRequestKeys: string[];
    nextStateKey: string;
  };
  objective: string;
  visibility: ActionVisibility;
  risk: "LOW" | "NORMAL" | "HIGH";
  fallbackActionKey: string;
  assetMutations: AssetMutationTemplateV1[];
};

export type ContinuousRoleStageContentV1 = {
  stageKey: string;
  roleKey: string;
  privateBrief: string;
  personalPressure: string;
  mainCards: [ContinuousActionCardV1, ContinuousActionCardV1, ContinuousActionCardV1];
};

export type ContinuousStrategyManifestV1 = {
  schemaVersion: "continuous_strategy_manifest_v1";
  contentVersion: string;
  templateKey: string;
  releaseStatus: "development_vertical_slice" | "published";
  stageCoverage: number[];
  files: Array<{ path: string; sha256: string }>;
};

export const continuousStrategyManifestJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "continuous_strategy_manifest_v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "contentVersion",
    "templateKey",
    "releaseStatus",
    "stageCoverage",
    "files"
  ],
  properties: {
    schemaVersion: { const: "continuous_strategy_manifest_v1" },
    contentVersion: { type: "string", minLength: 1 },
    templateKey: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]*$" },
    releaseStatus: { enum: ["development_vertical_slice", "published"] },
    stageCoverage: { type: "array", minItems: 1, maxItems: 7, uniqueItems: true, items: { type: "integer", minimum: 1, maximum: 7 } },
    files: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["path", "sha256"], properties: { path: { type: "string", minLength: 1 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } } } }
  }
} as const;
