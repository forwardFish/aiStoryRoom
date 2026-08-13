import type {
  ChapterIdV1,
  PressureChapterDeliveryMarkCommandV1,
  PressureChapterSubmitDecisionCommandV1,
  ReplayCreationReceiptV1,
  SangtianPressureResultEnvelopeV1,
  SeatIdV1,
} from "@ai-story/shared";
import type { PressureChapterGameProjectionV1 } from "../game-projection";
import type {
  ChatVisibilityV1,
  PressureChatMessageV1,
  SubmitPressureChatCommandV1,
} from "../interaction/contracts";
import type { SubmitOrchestratedActionCommandV1 } from "../orchestrator/contracts";
import type {
  StoredRunRouteDispatchV1,
  StoredRunRouteRecordV1,
} from "../run-router";

export const PRESSURE_CHAPTER_HTTP_TOKENS = Object.freeze({
  ACCESS: Symbol.for("PressureChapterHttp.Access"),
  ROUTES: Symbol.for("PressureChapterHttp.Routes"),
  GAME: Symbol.for("PressureChapterHttp.Game"),
  RESPONSE_ACKNOWLEDGER: Symbol.for("PressureChapterHttp.ResponseAcknowledger"),
  DECISION_COMPILER: Symbol.for("PressureChapterHttp.DecisionCompiler"),
  ACTIONS: Symbol.for("PressureChapterHttp.Actions"),
  CHAT: Symbol.for("PressureChapterHttp.Chat"),
  RESULT: Symbol.for("PressureChapterHttp.Result"),
  REPLAY: Symbol.for("PressureChapterHttp.Replay"),
  CLOCK: Symbol.for("PressureChapterHttp.Clock"),
  DELIVERY: Symbol.for("PressureChapterHttp.Delivery"),
});

/** Authentication is supplied by the existing AuthGuard, never by request JSON. */
export interface PressureChapterHttpPrincipalV1 {
  subjectId: string;
  viewerId: string;
}

/**
 * Room membership adapter. Implementations must read existing room/run
 * ownership only; authorization must happen before a route or projection read.
 */
export interface PressureChapterHttpAccessV1 {
  schemaVersion: "pressure_chapter_http_access_v1";
  roomId: string;
  runId: string;
  subjectId: string;
  viewerId: string;
}

export interface PressureChapterHttpAccessPort {
  authorize(input: {
    roomId: string;
    subjectId: string;
    viewerId: string;
  }): Promise<PressureChapterHttpAccessV1 | null>;
}

/** The concrete PressureChapterRunRouterService satisfies this port. */
export interface PressureChapterHttpRoutePort {
  readStoredRoute(runId: string): Promise<StoredRunRouteRecordV1>;
  resolveGame(runId: string): Promise<StoredRunRouteDispatchV1>;
  resolveAction(runId: string): Promise<StoredRunRouteDispatchV1>;
  resolveResult(runId: string): Promise<StoredRunRouteDispatchV1>;
  resolveReplay(runId: string): Promise<StoredRunRouteDispatchV1>;
}

/** Read-only surface implemented by PressureChapterGameProjectionService. */
export interface PressureChapterHttpGamePort {
  read(input: {
    runId: string;
    subjectId: string;
    feedCursor?: string | null;
    feedLimit?: number;
  }): Promise<PressureChapterGameProjectionV1>;
}

/** Command surface implemented by PressureChapterRuntimeFacade. */
export interface PressureChapterHttpActionPort {
  submitAction(
    command: SubmitOrchestratedActionCommandV1,
  ): Promise<unknown>;
}

/**
 * Server-side authority bridge for the public decision command.
 *
 * The production adapter must validate the submission fence, current active
 * decision, current seat control and working revision from authoritative read
 * state. It alone derives action identity/ordinal/revision/type/payload,
 * WorkingActionIntent and every canonical fingerprint. The HTTP client is
 * never allowed to self-report those fields.
 */
export interface PressureChapterHttpDecisionCompilerPort {
  compile(input: {
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }): Promise<SubmitOrchestratedActionCommandV1>;
}

/**
 * Read-side delivery acknowledgement used only by response submissions.
 * Implementations may mutate Feed delivery state, but never Working Ledger,
 * trigger, modal, settlement or Provider authority.
 */
export interface PressureChapterHttpResponseAcknowledgerPort {
  acknowledgeCurrent(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    sourceEventId: string;
    responseActionCode: string;
    occurredAt: string;
  }): Promise<boolean>;
}

export interface PressureChapterHttpDeliveryPort {
  mark(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    command: PressureChapterDeliveryMarkCommandV1;
    occurredAt: string;
  }): Promise<void>;
}

/** Command surface implemented by PressureChapterChatService. */
export interface PressureChapterHttpChatPort {
  submit(command: SubmitPressureChatCommandV1): Promise<{
    status: "APPENDED" | "REPLAYED";
    message: PressureChatMessageV1;
  }>;
}

/** Read-only surface implemented by PressureChapterRuntimeFacade. */
export interface PressureChapterHttpResultPort {
  getResult(query: {
    runId: string;
    viewerId: string;
  }): Promise<SangtianPressureResultEnvelopeV1>;
}

/** Command surface implemented by PressureChapterRuntimeFacade. */
export interface PressureChapterHttpReplayPort {
  replay(viewerId: string, command: unknown): Promise<ReplayCreationReceiptV1>;
}

export interface PressureChapterHttpClockPort {
  nowMs(): number;
}

export interface PressureChapterGameHttpQueryV1 {
  feedCursor?: string | null;
  feedLimit?: number;
}

export interface PressureChapterSubmitDecisionHttpResponseV1 {
  schemaVersion: "pressure_chapter_submit_decision_http_response_v1";
  idempotencyKey: string;
  projection: PressureChapterGameProjectionV1;
}

export interface PressureChapterMarkFeedDeliveryHttpResponseV1 {
  schemaVersion: "pressure_chapter_delivery_mark_http_response_v1";
  idempotencyKey: string;
  projection: PressureChapterGameProjectionV1;
}

export interface PressureChapterChatHttpBodyV1 {
  schemaVersion: "pressure_chapter_chat_http_v1";
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  senderSeatId: SeatIdV1;
  visibility: ChatVisibilityV1;
  targetSeatIds: SeatIdV1[];
  text: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface PressureChapterChatHttpResponseV1 {
  schemaVersion: "pressure_chapter_chat_http_response_v1";
  status: "APPENDED" | "REPLAYED";
  message: PressureChatMessageV1;
}

export type LegacyPressureSlotEndpointV1 =
  | "MAIN"
  | "MANEUVER"
  | "REACTION";
