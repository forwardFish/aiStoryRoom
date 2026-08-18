import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { sha256Canonical, type SeatIdV1 } from "@ai-story/shared";
import type { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";
import type {
  SeatControlCommandResultV1,
  SeatPrivateViewV1,
} from "../seat-control/types";
import type { PressureSeatViewerMembershipV1 } from "../seat-control-persistence/membership.prisma-adapter";
import {
  assertPressureSeatTransportCursorScopeV1,
  decodePressureSeatTransportCursorV1,
  encodePressureSeatTransportCursorV1,
} from "./cursor";
import { PressureSeatTransportError } from "./errors";
import { PressureSeatTransportFacadeV1 } from "./seat-transport.facade";
import {
  formatPressureSeatTransportSseEventV1,
  streamPressureSeatTransportV1,
} from "./sse.adapter";

const RUN_ID = "run-seat-transport";
const SUBJECT_ID = "user-1";
const SEAT_ID: SeatIdV1 = "zhejiang_governor";
const HUMAN_CONTROLLER_ID = "player-1";
const AUTHORITY_HASH = digest("authority-1");
const ROUTE_HASH = digest("route-1");

test("facade binds all writes to server membership and preserves idempotency/fences", async () => {
  const harness = createHarness();

  const heartbeat = await harness.facade.heartbeat({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    sessionId: "browser-session",
    signalSequence: 7,
    status: "ONLINE",
    idempotencyKey: "presence-7",
  });
  assert.equal(heartbeat.status, "APPLIED");
  assert.deepEqual(harness.presenceCommands, [{
    runId: RUN_ID,
    seatId: SEAT_ID,
    humanControllerId: HUMAN_CONTROLLER_ID,
    sessionId: "browser-session",
    signalSequence: 7,
    status: "ONLINE",
    idempotencyKey: "presence-7",
  }]);

  const handoff = await harness.facade.handoff({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    expectedControlEpoch: 4,
    expectedSubmissionFenceToken: digest("submit-fence"),
    idempotencyKey: "handoff-4",
    cursor: (await harness.facade.readSnapshot({ runId: RUN_ID, subjectId: SUBJECT_ID })).cursor,
  });
  assert.equal(handoff.operation, "HANDOFF");
  assert.deepEqual(harness.handoffCommands[0], {
    runId: RUN_ID,
    seatId: SEAT_ID,
    humanControllerId: HUMAN_CONTROLLER_ID,
    expectedControlEpoch: 4,
    expectedSubmissionFenceToken: digest("submit-fence"),
    idempotencyKey: "handoff-4",
  });

  const reclaim = await harness.facade.reclaim({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    expectedControlEpoch: 5,
    expectedReclaimFenceToken: digest("reclaim-fence"),
    idempotencyKey: "reclaim-5",
  });
  assert.equal(reclaim.operation, "RECLAIM");
  assert.equal(harness.reclaimCommands[0]?.seatId, SEAT_ID);
  assert.equal(harness.reclaimCommands[0]?.humanControllerId, HUMAN_CONTROLLER_ID);
});

test("snapshot is viewer-safe and advances only by monotonic eventSequence", async () => {
  const harness = createHarness();
  const first = await harness.facade.readSnapshot({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
  });
  const snapshot = await harness.facade.readSnapshot({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    cursor: first.cursor,
    feedLimit: 12,
  });

  assert.equal(snapshot.viewerSeatId, SEAT_ID);
  assert.equal(snapshot.seatView.ownSeat.privatePayload.secret, "viewer-only");
  assert.deepEqual(harness.feedQueries.at(-1), {
    roomId: RUN_ID,
    runId: RUN_ID,
    viewerSeatId: SEAT_ID,
    afterSequence: 11,
    limit: 12,
  });
  const cursor = decodePressureSeatTransportCursorV1(snapshot.cursor);
  assert.equal(cursor.runId, RUN_ID);
  assert.equal(cursor.routeHash, ROUTE_HASH);
  assert.equal(cursor.viewerSeatId, SEAT_ID);
  assert.equal(cursor.authorityHash, AUTHORITY_HASH);
  assert.equal(cursor.lastDeliveredSequence, 11);
  assert.equal(snapshot.delivery.nextAfterSequence, 11);
  const { snapshotHash, ...base } = snapshot;
  assert.equal(snapshotHash, sha256Canonical(base));
});

test("facade fails closed on membership, view, and feed scope mismatch", async () => {
  const missing = createHarness({ membership: null });
  await assert.rejects(
    missing.facade.readSnapshot({ runId: RUN_ID, subjectId: SUBJECT_ID }),
    hasCode("PRESSURE_SEAT_TRANSPORT_SUBJECT_FORBIDDEN"),
  );

  const wrongView = createHarness({
    view: makeView({ ownSeatId: "cabinet_finance" }),
  });
  await assert.rejects(
    wrongView.facade.readSnapshot({ runId: RUN_ID, subjectId: SUBJECT_ID }),
    hasCode("PRESSURE_SEAT_TRANSPORT_VIEWER_SCOPE_MISMATCH"),
  );

  const wrongFeed = createHarness({
    feed: makeFeed({ viewerSeatId: "cabinet_finance" }),
  });
  await assert.rejects(
    wrongFeed.facade.readSnapshot({ runId: RUN_ID, subjectId: SUBJECT_ID }),
    hasCode("PRESSURE_SEAT_TRANSPORT_FEED_SCOPE_MISMATCH"),
  );
});

test("transport cursor rejects tampering and cross-seat replay", async () => {
  const snapshot = await createHarness().facade.readSnapshot({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
  });
  assert.throws(
    () => decodePressureSeatTransportCursorV1(`${snapshot.cursor}x`),
    hasCode("PRESSURE_SEAT_TRANSPORT_CURSOR_INVALID"),
  );
  assert.throws(
    () => assertPressureSeatTransportCursorScopeV1({
      cursor: snapshot.cursor,
      runId: RUN_ID,
      viewerSeatId: "cabinet_finance",
    }),
    hasCode("PRESSURE_SEAT_TRANSPORT_CURSOR_INVALID"),
  );
});

test("invalid authority-mutation cursor fails before any control write", async () => {
  const harness = createHarness();
  const snapshot = await harness.facade.readSnapshot({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
  });
  const tampered = `${snapshot.cursor.slice(0, -1)}${snapshot.cursor.endsWith("a") ? "b" : "a"}`;
  await assert.rejects(
    harness.facade.handoff({
      runId: RUN_ID,
      subjectId: SUBJECT_ID,
      expectedControlEpoch: 4,
      expectedSubmissionFenceToken: digest("submit-fence"),
      idempotencyKey: "handoff-invalid-cursor",
      cursor: tampered,
    }),
    PressureSeatTransportError,
  );
  assert.equal(harness.handoffCommands.length, 0);
  assert.equal(harness.reclaimCommands.length, 0);
});

test("SSE source performs read-only deduplicated snapshots plus advisory keepalive", async () => {
  const snapshots = [
    await createHarness().facade.readSnapshot({ runId: RUN_ID, subjectId: SUBJECT_ID }),
    await createHarness().facade.readSnapshot({ runId: RUN_ID, subjectId: SUBJECT_ID }),
  ];
  let reads = 0;
  let now = 0;
  const stream = streamPressureSeatTransportV1(
    {
      async readSnapshot() {
        reads += 1;
        return structuredClone(snapshots[Math.min(reads - 1, snapshots.length - 1)]!);
      },
    },
    { runId: RUN_ID, subjectId: SUBJECT_ID },
    {
      pollIntervalMs: 1,
      heartbeatIntervalMs: 10,
      now: () => now,
      wait: async () => { now += 10; },
    },
  );

  const first = await stream.next();
  assert.equal(first.value?.event, "snapshot");
  const second = await stream.next();
  assert.equal(second.value?.event, "heartbeat");
  assert.match(formatPressureSeatTransportSseEventV1(first.value!), /^id: .+\nevent: snapshot\ndata: /);
  await stream.return(undefined);
  assert.equal(reads, 2);
});

test("SSE resumes from its transport cursor and drains every monotonic page before waiting", async () => {
  const base = await createHarness().facade.readSnapshot({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
  });
  const cursors = [2, 4].map((lastDeliveredSequence) =>
    encodePressureSeatTransportCursorV1({
      runId: RUN_ID,
      routeHash: ROUTE_HASH,
      viewerSeatId: SEAT_ID,
      authorityHash: AUTHORITY_HASH,
      lastDeliveredSequence,
    }));
  const snapshots = cursors.map((cursor, index) => ({
    ...structuredClone(base),
    cursor,
    delivery: {
      afterSequence: index === 0 ? 0 : 2,
      nextAfterSequence: index === 0 ? 2 : 4,
      hasMore: index === 0,
      currentServerSequence: 4,
      narrativeAfterSequence: 0,
      narrativeNextAfterSequence: 0,
      narrativeCurrentServerSequence: 0,
      narrativeHasMore: false,
    },
  }));
  const queries: Array<{ cursor?: string | null }> = [];
  let waits = 0;
  const stream = streamPressureSeatTransportV1(
    {
      async readSnapshot(query) {
        queries.push(query);
        return structuredClone(snapshots[Math.min(queries.length - 1, snapshots.length - 1)]!);
      },
    },
    { runId: RUN_ID, subjectId: SUBJECT_ID },
    { wait: async () => { waits += 1; } },
  );

  const first = await stream.next();
  const second = await stream.next();
  assert.equal(first.value?.event, "snapshot");
  assert.equal(second.value?.event, "snapshot");
  assert.equal(queries[0]?.cursor, null);
  assert.equal(queries[1]?.cursor, cursors[0]);
  assert.equal(waits, 0);
  await stream.return(undefined);
});

test("seat transport has no Provider or model invocation dependency", async () => {
  const sources = await Promise.all([
    "contracts.ts",
    "cursor.ts",
    "seat-transport.facade.ts",
    "sse.adapter.ts",
  ].map((file) => readFile(resolve(__dirname, file), "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /OpenAI|DeepSeek|OpenNovel|NarrativeProvider|ProviderPort/);
  }
});

function createHarness(input: {
  membership?: PressureSeatViewerMembershipV1 | null;
  view?: SeatPrivateViewV1;
  feed?: Awaited<ReturnType<AEmotionFeedServiceV1["listAfterSequence"]>>;
} = {}) {
  const membership = input.membership === undefined ? makeMembership() : input.membership;
  const view = input.view ?? makeView();
  const feed = input.feed ?? makeFeed();
  const presenceCommands: any[] = [];
  const handoffCommands: any[] = [];
  const reclaimCommands: any[] = [];
  const feedQueries: any[] = [];
  const committed = makeCommittedResult();
  const facade = new PressureSeatTransportFacadeV1(
    {
      async readStoredRoute() {
        return {
          runId: RUN_ID,
          snapshot: { routeHash: ROUTE_HASH },
        } as Awaited<ReturnType<import("../run-router").StoredRunRouteReaderPort["readStoredRoute"]>>;
      },
    },
    { async readSubjectMembership() { return membership; } },
    { async project() { return structuredClone(view); } },
    {
      async recordPresence(command) {
        presenceCommands.push(command);
        return { status: "APPLIED" as const, record: { recordHash: digest("presence") } };
      },
      async explicitHandoffToAi(command) {
        handoffCommands.push(command);
        return committed;
      },
      async reclaimByHuman(command) {
        reclaimCommands.push(command);
        return committed;
      },
    },
    {
      async listAfterSequence(query) {
        feedQueries.push(query);
        return {
          ...structuredClone(feed),
          afterSequence: query.afterSequence,
          nextAfterSequence: Math.max(query.afterSequence, feed.nextAfterSequence),
        };
      },
    },
  );
  return {
    facade,
    presenceCommands,
    handoffCommands,
    reclaimCommands,
    feedQueries,
  };
}

function makeMembership(): PressureSeatViewerMembershipV1 {
  return {
    roomId: RUN_ID,
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    seatId: SEAT_ID,
    humanControllerId: HUMAN_CONTROLLER_ID,
  };
}

function makeView(input: { ownSeatId?: SeatIdV1 } = {}): SeatPrivateViewV1 {
  return {
    schemaVersion: "pressure_seat_private_view_v1",
    runId: RUN_ID,
    participantMode: "SOLO",
    publicSeats: [{ seatId: SEAT_ID, controllerKind: "HUMAN", controlEpoch: 4 }],
    ownSeat: {
      seatId: input.ownSeatId ?? SEAT_ID,
      controllerKind: "HUMAN",
      controlEpoch: 4,
      canSubmit: true,
      canReclaim: false,
      submissionFenceToken: digest("submit-fence"),
      reclaimFenceToken: null,
      presence: "ONLINE",
      privateProjectionVersion: "v1",
      privatePayload: { secret: "viewer-only" },
      privatePayloadHash: digest("private"),
    },
    sourceAuthorityHash: AUTHORITY_HASH,
    viewHash: digest("view"),
  };
}

function makeFeed(input: { viewerSeatId?: SeatIdV1 } = {}): Awaited<
  ReturnType<AEmotionFeedServiceV1["listAfterSequence"]>
> {
  return {
    schemaVersion: "a_emotion_monotonic_delivery_page_v1",
    roomId: RUN_ID,
    runId: RUN_ID,
    viewerSeatId: input.viewerSeatId ?? SEAT_ID,
    items: [],
    unreadCount: 0,
    afterSequence: 0,
    nextAfterSequence: 11,
    hasMore: false,
    currentServerSequence: 11,
  };
}

function makeCommittedResult(): SeatControlCommandResultV1 {
  return {
    status: "COMMITTED",
    committed: {} as SeatControlCommandResultV1["committed"],
  };
}

function digest(value: string): string {
  return sha256Canonical({ value });
}

function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof PressureSeatTransportError && error.code === code;
}
