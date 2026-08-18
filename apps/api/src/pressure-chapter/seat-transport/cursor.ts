import { isSha256, sha256Canonical, type SeatIdV1 } from "@ai-story/shared";
import {
  PRESSURE_SEAT_TRANSPORT_ERROR_CODES as ERROR,
  failPressureSeatTransport,
} from "./errors";

export interface PressureSeatTransportCursorPayloadV1 {
  v: 1 | 2;
  runId: string;
  routeHash: string;
  viewerSeatId: SeatIdV1;
  authorityHash: string;
  lastDeliveredSequence: number;
  narrativeDeliverySequence: number;
  bindingHash: string;
}

export function encodePressureSeatTransportCursorV1(input: {
  runId: string;
  routeHash: string;
  viewerSeatId: SeatIdV1;
  authorityHash: string;
  lastDeliveredSequence: number;
  narrativeDeliverySequence?: number;
}): string {
  const base = {
    v: 2 as const,
    runId: input.runId,
    routeHash: input.routeHash,
    viewerSeatId: input.viewerSeatId,
    authorityHash: input.authorityHash,
    lastDeliveredSequence: input.lastDeliveredSequence,
    narrativeDeliverySequence: input.narrativeDeliverySequence ?? 0,
  };
  return Buffer.from(JSON.stringify({
    ...base,
    bindingHash: sha256Canonical(base),
  }), "utf8").toString("base64url");
}

export function decodePressureSeatTransportCursorV1(
  cursor: string,
): PressureSeatTransportCursorPayloadV1 {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<PressureSeatTransportCursorPayloadV1>;
    const base = {
      v: parsed.v,
      runId: parsed.runId,
      routeHash: parsed.routeHash,
      viewerSeatId: parsed.viewerSeatId,
      authorityHash: parsed.authorityHash,
      lastDeliveredSequence: parsed.lastDeliveredSequence,
      ...(parsed.v === 2
        ? { narrativeDeliverySequence: parsed.narrativeDeliverySequence }
        : {}),
    };
    if (
      parsed.v !== 1 && parsed.v !== 2
      || typeof parsed.runId !== "string"
      || !parsed.runId.trim()
      || !isSha256(parsed.routeHash)
      || typeof parsed.viewerSeatId !== "string"
      || !isSha256(parsed.authorityHash)
      || !Number.isSafeInteger(parsed.lastDeliveredSequence)
      || (parsed.lastDeliveredSequence ?? -1) < 0
      || (parsed.v === 2 && (
        !Number.isSafeInteger(parsed.narrativeDeliverySequence)
        || (parsed.narrativeDeliverySequence ?? -1) < 0
      ))
      || !isSha256(parsed.bindingHash)
      || sha256Canonical(base) !== parsed.bindingHash
    ) {
      return failPressureSeatTransport(ERROR.CURSOR_INVALID);
    }
    return {
      ...(parsed as PressureSeatTransportCursorPayloadV1),
      narrativeDeliverySequence: parsed.v === 2
        ? parsed.narrativeDeliverySequence!
        : 0,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "PressureSeatTransportError") {
      throw error;
    }
    return failPressureSeatTransport(ERROR.CURSOR_INVALID);
  }
}

export function assertPressureSeatTransportCursorScopeV1(input: {
  cursor: string;
  runId: string;
  routeHash?: string;
  viewerSeatId: SeatIdV1;
}): void {
  const decoded = decodePressureSeatTransportCursorV1(input.cursor);
  if (
    decoded.runId !== input.runId
    || (input.routeHash !== undefined && decoded.routeHash !== input.routeHash)
    || decoded.viewerSeatId !== input.viewerSeatId
  ) {
    failPressureSeatTransport(ERROR.CURSOR_INVALID, "SCOPE_MISMATCH");
  }
}
