import { isSha256, sha256Canonical } from "@ai-story/shared";
import type {
  PressureSeatAuthorityMutationResultV1,
  PressureSeatHandoffCommandV1,
  PressureSeatHeartbeatCommandV1,
  PressureSeatHeartbeatResultV1,
  PressureSeatReclaimCommandV1,
  PressureSeatTransportControlPortV1,
  PressureSeatTransportFeedPortV1,
  PressureSeatTransportMembershipPortV1,
  PressureSeatTransportRoutePortV1,
  PressureSeatTransportSnapshotV1,
  PressureSeatTransportViewPortV1,
  ReadPressureSeatTransportQueryV1,
} from "./contracts";
import { PRESSURE_SEAT_TRANSPORT_SNAPSHOT_SCHEMA_V1 } from "./contracts";
import {
  assertPressureSeatTransportCursorScopeV1,
  decodePressureSeatTransportCursorV1,
  encodePressureSeatTransportCursorV1,
} from "./cursor";
import {
  PRESSURE_SEAT_TRANSPORT_ERROR_CODES as ERROR,
  failPressureSeatTransport,
} from "./errors";

const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 50;

export class PressureSeatTransportFacadeV1 {
  constructor(
    private readonly routes: PressureSeatTransportRoutePortV1,
    private readonly memberships: PressureSeatTransportMembershipPortV1,
    private readonly views: PressureSeatTransportViewPortV1,
    private readonly controls: PressureSeatTransportControlPortV1,
    private readonly feed: PressureSeatTransportFeedPortV1,
  ) {}

  async readSnapshot(
    query: ReadPressureSeatTransportQueryV1,
  ): Promise<PressureSeatTransportSnapshotV1> {
    assertScope(query.runId, query.subjectId);
    const route = await this.routes.readStoredRoute(query.runId);
    if (
      route.runId !== query.runId
      || !isSha256(route.snapshot.routeHash)
    ) {
      return failPressureSeatTransport(ERROR.VIEWER_SCOPE_MISMATCH, "ROUTE");
    }
    const membership = await this.requireMembership(query.runId, query.subjectId);
    const requestedCursor = normalizeOptional(query.cursor);
    if (requestedCursor) {
      assertPressureSeatTransportCursorScopeV1({
        cursor: requestedCursor,
        runId: query.runId,
        routeHash: route.snapshot.routeHash,
        viewerSeatId: membership.seatId,
      });
    }
    const seatView = await this.views.project(query.runId, {
      kind: "HUMAN",
      humanControllerId: membership.humanControllerId,
    });
    if (
      seatView.runId !== query.runId
      || seatView.ownSeat.seatId !== membership.seatId
      || !isSha256(seatView.sourceAuthorityHash)
      || !isSha256(seatView.viewHash)
    ) {
      return failPressureSeatTransport(ERROR.VIEWER_SCOPE_MISMATCH);
    }
    const afterSequence = requestedCursor
      ? decodePressureSeatTransportCursorV1(requestedCursor).lastDeliveredSequence
      : 0;
    const deliveryPage = await this.feed.listAfterSequence({
      roomId: membership.roomId,
      runId: query.runId,
      viewerSeatId: membership.seatId,
      afterSequence,
      limit: normalizeFeedLimit(query.feedLimit),
    });
    if (
      deliveryPage.schemaVersion !== "a_emotion_monotonic_delivery_page_v1"
      || deliveryPage.roomId !== membership.roomId
      || deliveryPage.runId !== query.runId
      || deliveryPage.viewerSeatId !== membership.seatId
      || deliveryPage.afterSequence !== afterSequence
      || !Number.isSafeInteger(deliveryPage.nextAfterSequence)
      || deliveryPage.nextAfterSequence < afterSequence
      || !Number.isSafeInteger(deliveryPage.currentServerSequence)
      || deliveryPage.currentServerSequence < deliveryPage.nextAfterSequence
      || (deliveryPage.hasMore && deliveryPage.nextAfterSequence === afterSequence)
    ) {
      return failPressureSeatTransport(ERROR.FEED_SCOPE_MISMATCH);
    }
    const feedPage = {
      schemaVersion: "a_emotion_feed_page_v1" as const,
      roomId: membership.roomId,
      runId: query.runId,
      viewerSeatId: membership.seatId,
      items: deliveryPage.items,
      unreadCount: deliveryPage.unreadCount,
      nextCursor: null,
      serverSequence: deliveryPage.currentServerSequence,
    };
    const cursor = encodePressureSeatTransportCursorV1({
      runId: query.runId,
      routeHash: route.snapshot.routeHash,
      viewerSeatId: membership.seatId,
      authorityHash: seatView.sourceAuthorityHash,
      lastDeliveredSequence: deliveryPage.nextAfterSequence,
    });
    const base = {
      schemaVersion: PRESSURE_SEAT_TRANSPORT_SNAPSHOT_SCHEMA_V1,
      runId: query.runId,
      routeHash: route.snapshot.routeHash,
      viewerSeatId: membership.seatId,
      seatView,
      feedPage,
      delivery: {
        afterSequence,
        nextAfterSequence: deliveryPage.nextAfterSequence,
        hasMore: deliveryPage.hasMore,
        currentServerSequence: deliveryPage.currentServerSequence,
      },
      cursor,
    };
    return { ...base, snapshotHash: sha256Canonical(base) };
  }

  async heartbeat(
    command: PressureSeatHeartbeatCommandV1,
  ): Promise<PressureSeatHeartbeatResultV1> {
    assertScope(command.runId, command.subjectId);
    const membership = await this.requireMembership(command.runId, command.subjectId);
    const result = await this.controls.recordPresence({
      runId: command.runId,
      seatId: membership.seatId,
      humanControllerId: membership.humanControllerId,
      sessionId: command.sessionId,
      signalSequence: command.signalSequence,
      status: command.status,
      idempotencyKey: command.idempotencyKey,
    });
    return {
      schemaVersion: "pressure_seat_transport_heartbeat_result_v1",
      runId: command.runId,
      viewerSeatId: membership.seatId,
      status: result.status,
      recordHash: result.record.recordHash,
    };
  }

  async handoff(
    command: PressureSeatHandoffCommandV1,
  ): Promise<PressureSeatAuthorityMutationResultV1> {
    assertScope(command.runId, command.subjectId);
    const membership = await this.requireMembership(command.runId, command.subjectId);
    await this.assertCommandCursor(command.runId, membership.seatId, command.cursor);
    const result = await this.controls.explicitHandoffToAi({
      runId: command.runId,
      seatId: membership.seatId,
      humanControllerId: membership.humanControllerId,
      expectedControlEpoch: command.expectedControlEpoch,
      expectedSubmissionFenceToken: command.expectedSubmissionFenceToken,
      idempotencyKey: command.idempotencyKey,
    });
    return {
      schemaVersion: "pressure_seat_transport_authority_result_v1",
      operation: "HANDOFF",
      status: result.status,
      snapshot: await this.readSnapshot({
        runId: command.runId,
        subjectId: command.subjectId,
        cursor: command.cursor,
      }),
    };
  }

  async reclaim(
    command: PressureSeatReclaimCommandV1,
  ): Promise<PressureSeatAuthorityMutationResultV1> {
    assertScope(command.runId, command.subjectId);
    const membership = await this.requireMembership(command.runId, command.subjectId);
    await this.assertCommandCursor(command.runId, membership.seatId, command.cursor);
    const result = await this.controls.reclaimByHuman({
      runId: command.runId,
      seatId: membership.seatId,
      humanControllerId: membership.humanControllerId,
      expectedControlEpoch: command.expectedControlEpoch,
      expectedReclaimFenceToken: command.expectedReclaimFenceToken,
      idempotencyKey: command.idempotencyKey,
    });
    return {
      schemaVersion: "pressure_seat_transport_authority_result_v1",
      operation: "RECLAIM",
      status: result.status,
      snapshot: await this.readSnapshot({
        runId: command.runId,
        subjectId: command.subjectId,
        cursor: command.cursor,
      }),
    };
  }

  private async requireMembership(runId: string, subjectId: string) {
    const membership = await this.memberships.readSubjectMembership({ runId, subjectId });
    if (
      !membership
      || membership.runId !== runId
      || membership.subjectId !== subjectId
      || !membership.roomId.trim()
      || !membership.humanControllerId.trim()
    ) {
      return failPressureSeatTransport(ERROR.SUBJECT_FORBIDDEN);
    }
    return membership;
  }

  private async assertCommandCursor(
    runId: string,
    viewerSeatId: Parameters<typeof assertPressureSeatTransportCursorScopeV1>[0]["viewerSeatId"],
    cursor: string | null | undefined,
  ): Promise<void> {
    if (!cursor) return;
    const route = await this.routes.readStoredRoute(runId);
    if (route.runId !== runId || !isSha256(route.snapshot.routeHash)) {
      failPressureSeatTransport(ERROR.VIEWER_SCOPE_MISMATCH, "ROUTE");
    }
    assertPressureSeatTransportCursorScopeV1({
      cursor,
      runId,
      routeHash: route.snapshot.routeHash,
      viewerSeatId,
    });
  }
}

function assertScope(runId: string, subjectId: string): void {
  if (!runId?.trim() || !subjectId?.trim()) {
    failPressureSeatTransport(ERROR.INVALID_REQUEST, "EMPTY_SCOPE");
  }
}

function normalizeFeedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_FEED_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_FEED_LIMIT) {
    return failPressureSeatTransport(ERROR.INVALID_REQUEST, "feedLimit");
  }
  return value;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!value.trim()) return failPressureSeatTransport(ERROR.INVALID_REQUEST, "cursor");
  return value;
}
