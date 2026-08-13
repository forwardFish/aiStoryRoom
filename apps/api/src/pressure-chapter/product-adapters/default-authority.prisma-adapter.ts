import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  hashWithoutField,
  type SeatIdV1,
} from "@ai-story/shared";
import type { PrismaService } from "../../prisma.service";
import type { DeterministicDefaultAuthorityPortV1 } from "../integration";
import type { SeatDefaultDirectiveV1 } from "../seat-control";
import {
  decodeSeatEnvelope,
  type PressureSeatSnapshotDelegateV1,
} from "../seat-control-persistence/envelope";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";
import { decodePressureMvpDecisionStateV1 } from "../persistence/mvp-decision-state";
import { readPinnedPressureRouteV1 } from "./route-authority";

/** Authorizes only the AI controller and default embedded in current authority. */
export class PrismaDeterministicDefaultAuthorityAdapterV1
implements DeterministicDefaultAuthorityPortV1 {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(input: Readonly<{
    runId: string;
    routeHash: string;
    chapterRuntimeId: string;
    decisionPointId: string;
    seatId: SeatIdV1;
    reason: "DEADLINE" | "AI_FAILURE";
    idempotencyKey: string;
    canonicalActionPayloadHash: string;
  }>): Promise<Readonly<{
    subjectId: string;
    controlEpoch: number;
    defaultPolicyRef: string;
    defaultPolicyHash: string;
    canonicalActionPayloadHash: string;
  }> | null> {
    if (
      !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(input.seatId)
      || !input.idempotencyKey.trim()
      || !/^[a-f0-9]{64}$/.test(input.canonicalActionPayloadHash)
    ) {
      return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "defaultAuthorizationInput");
    }
    const trigger = input.reason === "DEADLINE" ? "HUMAN_DEADLINE" : "AI_FAILURE";
    return this.prisma.$transaction(async (tx) => {
      await readPinnedPressureRouteV1(tx, input.runId, input.routeHash);
      const [runtime, row] = await Promise.all([
        tx.pressureChapterRuntime.findUnique({
          where: { id: input.chapterRuntimeId },
          select: { id: true, runId: true, routeHash: true, decisionStateJson: true },
        }),
        (tx.pressureSeatControlSnapshot as unknown as PressureSeatSnapshotDelegateV1)
          .findUnique({ where: { runId: input.runId } }),
      ]);
      if (!runtime || !row) return null;

      const point = decodePressureMvpDecisionStateV1(runtime.decisionStateJson);
      const envelope = decodeSeatEnvelope(row);
      const snapshot = envelope.snapshot;
      const seat = snapshot.seatControls.find((entry) => entry.seatId === input.seatId);
      const directive = Object.values(envelope.directives).find((entry) =>
        entry.runId === input.runId
        && entry.seatId === input.seatId
        && entry.decisionPointId === input.decisionPointId
        && entry.trigger === trigger
        && entry.authorityStateHash === snapshot.stateHash
        && entry.controlEpoch === seat?.controlEpoch
        && entry.idempotencyKey === input.idempotencyKey
        && entry.canonicalActionPayloadHash === input.canonicalActionPayloadHash,
      );
      if (!seat || !directive) return null;
      decodeDirective(directive);

      if (
        runtime.id !== input.chapterRuntimeId
        || runtime.runId !== input.runId
        || runtime.routeHash !== input.routeHash
        || point.state !== "OPEN"
        || point.activeDecisionPointId !== input.decisionPointId
        || !point.requiredSeatIds.includes(input.seatId)
        || snapshot.runId !== input.runId
        || snapshot.routeHash !== input.routeHash
        || seat.mode !== "AI_ACTIVE"
        || seat.activeControllerId !== seat.designatedAiControllerId
        || directive.runId !== input.runId
        || directive.decisionPointId !== input.decisionPointId
        || directive.seatId !== input.seatId
        || directive.trigger !== trigger
        || directive.defaultPolicyRef !== snapshot.frozenPolicy.deterministicDefaultPolicyRef
        || directive.defaultPolicyHash !== snapshot.frozenPolicy.deterministicDefaultPolicyHash
        || directive.canonicalActionPayloadHash !== input.canonicalActionPayloadHash
        || directive.idempotencyKey !== input.idempotencyKey
        || directive.authorityStateHash !== snapshot.stateHash
        || directive.controlEpoch !== seat.controlEpoch
      ) {
        return failPressureProductAdapterV1(
          ERROR.AUTHORITY_MISMATCH,
          "PressureSeatDefaultDirective",
          "CURRENT_AI_AUTHORITY",
        );
      }
      return {
        subjectId: seat.designatedAiControllerId,
        controlEpoch: seat.controlEpoch,
        defaultPolicyRef: directive.defaultPolicyRef,
        defaultPolicyHash: directive.defaultPolicyHash,
        canonicalActionPayloadHash: directive.canonicalActionPayloadHash,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function decodeDirective(value: unknown): SeatDefaultDirectiveV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "PressureSeatDefaultDirective.directiveJson");
  }
  const directive = structuredClone(value) as SeatDefaultDirectiveV1;
  if (
    directive.schemaVersion !== "pressure_seat_default_directive_v1"
    || !/^[a-f0-9]{64}$/.test(directive.directiveHash)
    || directive.directiveHash !== hashWithoutField(
      directive as unknown as Record<string, unknown>,
      "directiveHash",
    )
    || !/^[a-f0-9]{64}$/.test(directive.requestFingerprint)
  ) {
    return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "PressureSeatDefaultDirective.directiveJson", "HASH");
  }
  return directive;
}
