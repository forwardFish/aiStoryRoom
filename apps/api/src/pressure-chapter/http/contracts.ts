import type {
  ChapterIdV1,
  PressureChapterSubmitDecisionCommandV1,
  ReplayCreationReceiptV1,
  SangtianPressureResultEnvelopeV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  PressureChapterGameProjectionV1,
  PressureGameDecisionProjectionV1,
  PressureGameNarrativeUpdateV1,
  ReadPressureChapterGameProjectionFromAuthorityV1,
} from "../game-projection";
import type {
  ChatVisibilityV1,
  PressureChatMessageV1,
  SubmitPressureChatCommandV1,
} from "../interaction/contracts";
import type {
  AuthoredChapterRuntimeV1,
  SubmitOrchestratedActionCommandV1,
} from "../orchestrator/contracts";
import type { DecisionSubmitSnapshotV1 } from "../decision-automation/contracts";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import type { PressurePostCommitTurnReceiptV1 } from "../post-commit-turn-update/contracts";
import type {
  StoredRunRouteDispatchV1,
  StoredRunRouteRecordV1,
} from "../run-router";

export const PRESSURE_CHAPTER_HTTP_TOKENS = Object.freeze({
  ACCESS: Symbol.for("PressureChapterHttp.Access"),
  ROUTES: Symbol.for("PressureChapterHttp.Routes"),
  GAME: Symbol.for("PressureChapterHttp.Game"),
  DECISION_COMPILER: Symbol.for("PressureChapterHttp.DecisionCompiler"),
  ACTIONS: Symbol.for("PressureChapterHttp.Actions"),
  CHAT: Symbol.for("PressureChapterHttp.Chat"),
  RESULT: Symbol.for("PressureChapterHttp.Result"),
  REPLAY: Symbol.for("PressureChapterHttp.Replay"),
  CLOCK: Symbol.for("PressureChapterHttp.Clock"),
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
  /** Frozen route mode returned by the same authorization read. */
  participantMode?: "SOLO" | "MULTIPLAYER";
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
    onTurnPresentationSceneText?: (sceneText: string) => void;
  }): Promise<PressureChapterGameProjectionV1>;
  readFromCommittedAuthority?(
    input: ReadPressureChapterGameProjectionFromAuthorityV1,
  ): Promise<PressureChapterGameProjectionV1>;
  warmTurnPresentationFromCommittedAuthority?(
    input: ReadPressureChapterGameProjectionFromAuthorityV1,
  ): Promise<PressureGameDecisionProjectionV1 | null>;
  readNarrativeUpdate?(input: {
    runId: string;
    subjectId: string;
    chapterRuntimeId: string;
  }): Promise<PressureGameNarrativeUpdateV1>;
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
  compileAuthoritatively?(input: {
    roomId: string;
    subjectId: string;
    viewerId: string;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }): Promise<Readonly<{
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: SubmitOrchestratedActionCommandV1;
    snapshot: DecisionSubmitSnapshotV1;
    preparedWorkingProjection: WorkingLedgerProjectionV1;
    preparedChapterDescriptor: AuthoredChapterRuntimeV1;
  }>>;
  compile(input: {
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }): Promise<SubmitOrchestratedActionCommandV1>;
  compileWithSnapshot?(input: {
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }): Promise<Readonly<{
    command: SubmitOrchestratedActionCommandV1;
    snapshot: DecisionSubmitSnapshotV1 | null;
    preparedWorkingProjection?: WorkingLedgerProjectionV1 | null;
    preparedChapterDescriptor?: AuthoredChapterRuntimeV1 | null;
  }>>;
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

export type PressureChapterSubmitDecisionHttpResponseV1 =
  | Readonly<{
      schemaVersion: "pressure_chapter_submit_decision_http_response_v1";
      idempotencyKey: string;
      projection: PressureChapterGameProjectionV1;
    }>
  | Readonly<{
      schemaVersion: "pressure_chapter_submit_decision_http_response_v1";
      idempotencyKey: string;
      projection: null;
      receipt: PressurePostCommitTurnReceiptV1;
    }>;

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
