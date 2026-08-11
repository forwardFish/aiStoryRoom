import type {
  B0ActionContractV1,
  B0OutcomeStatusV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0StateMutationV1,
  B0StructuredResultV1,
} from "@ai-story/shared";

export type B0AudienceResolverMapsV1 = {
  traceObservers?: Readonly<Record<string, readonly string[]>>;
  roleSets?: Readonly<Record<string, readonly string[]>>;
  conditionRecipients?: Readonly<Record<string, readonly string[]>>;
  detectedIntentActors?: Readonly<Record<string, readonly string[]>>;
};

export type B0CausalExplanationReasonV1 = {
  kind: "OWN_PLAN" | "OTHER_PLAN" | "SUPPORT" | "CONFLICT" | "RESOURCE" | "WORLD_CHANGE" | "TRACE" | "KNOWLEDGE";
  summary: string;
};

export type B0CausalExplanationCardV1 = {
  schemaVersion: "b0-causal-explanation-card-v1";
  resultId: string;
  reasons: B0CausalExplanationReasonV1[];
};

export type B0PublicationChangeV1 = {
  kind: B0StateMutationV1["entityType"];
  operation: B0StateMutationV1["operation"];
  numericDelta: number | null;
};

export type B0PublicationDeliveryV1 = {
  schemaVersion: "b0-publication-delivery-v1";
  idempotencyKey: string;
  batchId: string;
  runId: string;
  windowId: string;
  resultId: string;
  resultKind: B0StructuredResultV1["resultKind"];
  recipientActorId: string;
  visibility: "PUBLIC" | "PRIVATE" | "TARGETED" | "TRACE";
  sourceDisclosure: "FULL" | "HIDDEN" | "TRACE_ONLY";
  originActorIds: string[];
  targetActorIds: string[];
  summary: string;
  outcomeStatus: B0OutcomeStatusV1 | null;
  changes: B0PublicationChangeV1[];
  explanation: B0CausalExplanationCardV1;
};

export type B0PublicationPlanV1 = {
  schemaVersion: "b0-publication-plan-v1";
  batchId: string;
  roomId: string;
  runId: string;
  windowId: string;
  baseWorldSequence: number;
  resolutionHash: string;
  deliveries: B0PublicationDeliveryV1[];
  planHash: string;
};

export type BuildB0PublicationPlanInputV1 = {
  snapshot: B0SettlementSnapshotV1;
  resolution: B0SettlementResolutionV1;
  intents: B0ActionContractV1[];
  maps?: B0AudienceResolverMapsV1;
};

export class B0AudienceErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "B0AudienceErrorV1";
  }
}
