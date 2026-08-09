import {
  BadRequestException,
  ConflictException,
  HttpException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { OpenNovelPublicRun } from "./openovel-runtime.client";
import type { BoundOption, SubmitActionInput } from "./openovel-stage-b-types";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

export function openNovelActionIdempotencyKey(
  runId: string,
  userId: string,
  idempotencyKey: string,
) {
  return `openovel-action:${runId}:${userId}:${idempotencyKey}`;
}

export function openNovelRevisionNodeId(runId: string, turnNumber: number) {
  return `ovln_${shortHash(`${runId}\0${turnNumber}`)}`;
}

export function openNovelRevisionNodeIndex(turnNumber: number) {
  return 1_000_000 + turnNumber;
}

export function openNovelPlayerActionId(actionIdempotencyKey: string) {
  return `ovla_${shortHash(actionIdempotencyKey)}`;
}

export function openNovelChargeIdempotencyKey(actionId: string, attempt: number) {
  return `openovel-charge:${actionId}:${attempt}`;
}

export function openNovelCommitEventId(actionId: string) {
  return `ovle_${shortHash(actionId)}`;
}

export function canonicalHash(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function actionMetadata(action: any) {
  const immediate = asRecord(action?.immediateJson);
  const resolved = asRecord(action?.resolvedJson);
  const expectedStateRevision = Number.isInteger(Number(immediate.expectedStateRevision))
    ? Number(immediate.expectedStateRevision)
    : Math.max(0, Number(resolved.turnNumber || 1) - 1);
  return {
    boundOption: normalizeStoredBoundOption(immediate.boundOption),
    expectedStateRevision,
    requestedTurnId: String(
      immediate.requestedTurnId
      || resolved.turnId
      || turnIdForRevision(expectedStateRevision + 1),
    ),
    chargeAttempt: Math.max(1, Number(immediate.chargeAttempt || 1)),
  };
}

export function normalizeStoredBoundOption(value: unknown): BoundOption | null {
  const record = asRecord(value);
  const id = String(record.id || "").trim();
  const label = String(record.label || "").trim();
  return id && label ? { id, label } : null;
}

export function normalizeBoundOption(value: SubmitActionInput["boundOption"]): BoundOption | null {
  if (!value) return null;
  const id = String(value.id || "").trim();
  const label = String(value.label || "").trim();
  if (!id || !label) {
    throw new BadRequestException({
      code: "OPENOVEL_OPTION_INVALID",
      message: "The selected action is incomplete.",
    });
  }
  return { id, label };
}

export function requiredIdempotency(value: unknown) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new BadRequestException({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "A stable idempotencyKey of 8–160 characters is required.",
    });
  }
  return key;
}

export function idempotencyConflict() {
  return new ConflictException({
    code: "IDEMPOTENCY_KEY_REUSED",
    message: "That action key belongs to a different request.",
  });
}

export function revisionConflict(expected: number, actual: number) {
  return new ConflictException({
    code: "OPENOVEL_REVISION_CONFLICT",
    message: "The story revision was already claimed or committed.",
    expectedStateRevision: expected,
    currentStateRevision: actual,
    retryable: true,
  });
}

export function definitivePrecommitFailure(
  error: unknown,
  runtimeState: OpenNovelPublicRun | null,
  expectedRevision: number,
) {
  if (!runtimeState || isRuntimeBusy(error) || isIndeterminateTransport(error)) return false;
  if (runtimeState.turnNumber !== expectedRevision) return false;
  if (runtimeState.status === "FAILED") return true;
  if (runtimeState.status !== "READY") return false;
  return error instanceof HttpException && error.getStatus() < 500;
}

export function isIndeterminateTransport(error: unknown) {
  const code = errorCode(error);
  return code === "OPENOVEL_RUNTIME_UNAVAILABLE"
    || code === "OPENOVEL_STREAM_UNAVAILABLE"
    || code === "OPENOVEL_TURN_NOT_COMMITTED";
}

export function isRuntimeBusy(error: unknown) {
  const code = errorCode(error);
  return code === "RUN_FOREGROUND_BUSY"
    || code === "OPENOVEL_ACTION_IN_PROGRESS";
}

export function errorCode(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === "object" && "code" in response) {
      return String((response as any).code);
    }
  }
  return String((error as any)?.code || (error as Error)?.message || "OPENOVEL_ACTION_FAILED").slice(0, 160);
}

export function creditsRequired(result: any) {
  return new HttpException({
    code: "WORLD_CREDITS_REQUIRED",
    message: "More World Credits are required for this action.",
    required: result.required,
    available: result.available,
    runAllowanceAvailable: result.runAllowanceAvailable,
    personalAvailable: result.personalAvailable,
  }, 402);
}

export function decisionResponse(result: any, fallbackTurnId: string, fallbackTurnNumber: number, gameProjection: any) {
  return {
    accepted: true as const,
    resolution: {
      id: String(result.turnId || fallbackTurnId),
      appliedWorldSequence: Number(result.turnNumber || fallbackTurnNumber),
      resultNarrative: String(result.narration || ""),
      nextHook: "",
    },
    gameProjection,
  };
}

export function productRunStatus(runtimeStatus: string) {
  if (runtimeStatus === "COMPLETED") return "chapter_generated";
  if (runtimeStatus === "FAILED") return "resolving";
  return "playing";
}

export function openNovelState(previous: unknown, runtimeRun: OpenNovelPublicRun) {
  const root = asRecord(previous);
  return {
    ...root,
    openovel: {
      runtimeMode: runtimeRun.runtimeMode,
      turnNumber: runtimeRun.turnNumber,
      status: runtimeRun.status,
      canon: runtimeRun.canon,
      recentCanon: runtimeRun.recentCanon,
      prologueNarrative: runtimeRun.prologueNarrative || "",
      ending: runtimeRun.ending || null,
      options: runtimeRun.options,
      updatedAt: runtimeRun.updatedAt,
    },
  };
}

export function publicModelUsage(value: any) {
  if (!value) return null;
  return {
    model: value.model,
    requestId: value.requestId,
    usage: value.usage,
    latencyMs: value.latencyMs,
  };
}

export function publicTurnResult(value: Record<string, any>): Record<string, any> {
  return {
    ...value,
    options: Array.isArray(value.options)
      ? value.options.map((option: unknown) => {
          const record = asRecord(option);
          return {
            id: String(record.id || ""),
            label: String(record.label || ""),
            ...(record.key === true ? { key: true } : {}),
          };
        })
      : [],
  };
}

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function turnIdForRevision(turnNumber: number) {
  return `T${String(turnNumber).padStart(2, "0")}`;
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  )).join(",")}}`;
}

export function isUniqueConstraint(error: unknown) {
  return String((error as any)?.code || "") === "P2002"
    || /unique constraint/i.test(String((error as Error)?.message || error));
}

export function reconcileDelayMs() {
  const value = Number(process.env.OPENOVEL_RECONCILE_DELAY_MS || 50);
  return Number.isFinite(value) && value >= 1 ? Math.min(value, 1_000) : 50;
}

export function reconcileAttempts() {
  const value = Number(process.env.OPENOVEL_RECONCILE_ATTEMPTS || 600);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, 1_200) : 600;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
