import { PressureKernelError } from "./errors";
import type {
  PressureActionIntentCommandV1,
  PressureActionType,
  PressureContentInputFallback,
  PressureRuntimeContent,
  PressureRuntimeState,
} from "./types";

export const PRESSURE_PREPARE_INTENT_CLASSES = [
  "REST",
  "DELAY",
  "NEGOTIATE",
  "INVESTIGATE",
  "PLAN",
  "FAILED_OUTCOME_CLAIM",
  "FAILED_AUTHORITY_CLAIM",
  "REJECT_PROMPT_INJECTION",
  "REJECT_MULTIPLE_INTENTS",
] as const;
export type PressurePrepareIntentClass = (typeof PRESSURE_PREPARE_INTENT_CLASSES)[number];

export type ClassifiedPressurePrepareInput = {
  runId: string;
  seatId: string;
  currentActorId: string;
  intentText: string;
  intentClass: PressurePrepareIntentClass;
  idempotencyKey: string;
  submittedAtEpochMs: number;
  expectedRunVersion: number;
};

function fallbackFor(content: PressureRuntimeContent, nodeId: string, classes: string[]): PressureContentInputFallback | null {
  const node = content.nodes[nodeId];
  if (!node) return null;
  for (const entry of node.inputFallbacks) {
    const normalized = entry.inputClass.toUpperCase();
    if (classes.some((candidate) => normalized.includes(candidate))) return entry;
  }
  return null;
}

function typeFor(intentClass: PressurePrepareIntentClass): PressureActionType {
  switch (intentClass) {
    case "REST": return "REST";
    case "DELAY": return "DELAY";
    case "NEGOTIATE": return "NEGOTIATE";
    case "INVESTIGATE": return "INVESTIGATE";
    case "PLAN":
    case "FAILED_OUTCOME_CLAIM":
    case "FAILED_AUTHORITY_CLAIM": return "PLAN";
    case "REJECT_PROMPT_INJECTION": throw new PressureKernelError("FREE_TEXT_PROMPT_INJECTION", "Prompt injection is not a world action");
    case "REJECT_MULTIPLE_INTENTS": throw new PressureKernelError("FREE_TEXT_MULTIPLE_INTENTS", "Only one prepare intent may be sealed");
    default: {
      const neverClass: never = intentClass;
      throw new PressureKernelError("FREE_TEXT_UNPARSEABLE", `Unknown prepare intent class ${String(neverClass)}`);
    }
  }
}

/**
 * D2 consumes an upstream structural classification. It does not classify
 * language or contain story-specific words; LLM/rule-based text parsing belongs
 * to D3 or a test adapter.
 */
export function compileClassifiedPressurePrepare(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  input: ClassifiedPressurePrepareInput,
): { intent: PressureActionIntentCommandV1; compileOptions: { intentClass: "FAILED_OUTCOME_CLAIM" | "FAILED_AUTHORITY_CLAIM" | null } } {
  const type = typeFor(input.intentClass);
  const fallback = input.intentClass === "REST"
    ? fallbackFor(content, state.nodeId, ["REST", "SLEEP"])
    : input.intentClass === "DELAY"
      ? fallbackFor(content, state.nodeId, ["SILENCE", "IDLE", "CHAT", "DELAY"])
      : input.intentClass.startsWith("FAILED_")
        ? fallbackFor(content, state.nodeId, ["FABRICATED", "OVERREACH", "FAILED"])
        : null;
  const intent: PressureActionIntentCommandV1 = {
    schemaVersion: "pressure_action_intent_v1",
    runId: input.runId,
    nodeId: state.nodeId,
    slot: "PREPARE",
    seatId: input.seatId,
    currentActorId: input.currentActorId,
    controlEpoch: state.seats[input.seatId]?.controlEpoch || 0,
    type,
    intentText: String(input.intentText || "").trim() || input.intentClass,
    targetObjectId: null,
    expectedObjectVersionId: null,
    resourceCommitments: [],
    parameters: undefined,
    visibility: "PRIVATE",
    submittedAtEpochMs: input.submittedAtEpochMs,
    expectedRunVersion: input.expectedRunVersion,
    expectedSnapshotHash: state.inputSnapshotHash,
    idempotencyKey: input.idempotencyKey,
    // Authored timing/pressure values are consumed by the server compiler via
    // the content fallback class. They are never accepted as a client patch.
    ...(fallback ? {} : {}),
  };
  return {
    intent,
    compileOptions: {
      intentClass: input.intentClass === "FAILED_OUTCOME_CLAIM" || input.intentClass === "FAILED_AUTHORITY_CLAIM"
        ? input.intentClass
        : null,
    },
  };
}
