import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  validateSangtianPressureResultEnvelopeV1,
} from "@ai-story/shared";
import { PressureReplayPolicyEvaluatorV1 } from "../replay/replay-policy";
import { PressureResultAudienceProjectorV1 } from "./audience-projector";
import { PressureResultReadError } from "./errors";
import type {
  PressureResultReadModelReaderPort,
  PressureReplayPolicyPort,
  ResultViewerAuthorizerPort,
} from "./ports";
import { PressureResultQueryServiceV1 } from "./result-query.service";
import {
  pressureResultReadModelFixture,
  replayActionsFixture,
  viewerFixture,
} from "./result-test-fixtures";

function harness(sourceValue: unknown = pressureResultReadModelFixture()) {
  const counters = {
    authorizeReads: 0,
    resultReads: 0,
    policyReads: 0,
    authorityWrites: 0,
    settlementCalls: 0,
    finaleCalls: 0,
    providerCalls: 0,
    replayCreates: 0,
  };
  const authorityBoundary = {
    async readFinalized() {
      counters.resultReads += 1;
      return structuredClone(sourceValue);
    },
    async writeAuthority() { counters.authorityWrites += 1; },
    async settle() { counters.settlementCalls += 1; },
    async decideFinale() { counters.finaleCalls += 1; },
    async callProvider() { counters.providerCalls += 1; },
    async createReplay() { counters.replayCreates += 1; },
  } satisfies PressureResultReadModelReaderPort & Record<string, unknown>;
  const authorizer: ResultViewerAuthorizerPort = {
    async readViewerContext(_runId, viewerId) {
      counters.authorizeReads += 1;
      const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1.find(
        (candidate) => viewerId === `viewer-${candidate}`,
      );
      return seatId ? viewerFixture(seatId, viewerId) : null;
    },
  };
  const policy: PressureReplayPolicyPort = {
    async listActions(source) {
      counters.policyReads += 1;
      return replayActionsFixture(source.participantMode);
    },
  };
  const service = new PressureResultQueryServiceV1(
    authorityBoundary,
    authorizer,
    new PressureReplayPolicyEvaluatorV1(policy),
  );
  return { service, counters };
}

test("GET Result is a canonical, finalized, zero-authority-write query", async () => {
  const { service, counters } = harness();
  const result = await service.getResult({
    runId: "run-pressure-1",
    viewerId: "viewer-cabinet_finance",
  });

  assert.deepEqual(validateSangtianPressureResultEnvelopeV1(result), result);
  assert.equal(result.authoritativeResultStatus, "FINALIZED");
  assert.equal(result.runtimeTerminalState, "FINALE_FROZEN");
  assert.equal(result.rendererKey, "sangtian_pressure_endgame_v1");
  assert.equal(result.payload.narrative.status, "PENDING");
  assert.equal(result.payload.presentationHash, null);
  assert.equal("sourceRuleRef" in result.payload.worldOutcome, false);
  assert.deepEqual(counters, {
    authorizeReads: 1,
    resultReads: 1,
    policyReads: 1,
    authorityWrites: 0,
    settlementCalls: 0,
    finaleCalls: 0,
    providerCalls: 0,
    replayCreates: 0,
  });
});

test("six concurrent viewers receive world plus own seat plus explicitly authorized impacts", async () => {
  const { service } = harness();
  const results = await Promise.all(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) =>
      service.getResult({
        runId: "run-pressure-1",
        viewerId: `viewer-${seatId}`,
      }),
    ),
  );

  results.forEach((result, index) => {
    const ownSeat = PRESSURE_CHAPTER_SEAT_IDS_V1[index]!;
    assert.equal(result.payload.viewerSeat.seatId, ownSeat);
    assert.match(result.payload.viewerSeat.gain[0]!, new RegExp(`SEAT_SECRET_FOR_${ownSeat}`));
    assert.deepEqual(
      result.payload.visibleOutcomes.map((outcome) => outcome.outcomeId),
      ["impact-public-record", `impact-private-${ownSeat}`],
    );
    assert.equal(result.payload.reveal?.text, `REVEAL_SECRET_FOR_${ownSeat}`);
    const serialized = JSON.stringify(result);
    for (const otherSeat of PRESSURE_CHAPTER_SEAT_IDS_V1) {
      if (otherSeat === ownSeat) continue;
      assert.doesNotMatch(serialized, new RegExp(`SEAT_SECRET_FOR_${otherSeat}`));
      assert.doesNotMatch(serialized, new RegExp(`IMPACT_SECRET_FOR_${otherSeat}`));
      assert.doesNotMatch(serialized, new RegExp(`REVEAL_SECRET_FOR_${otherSeat}`));
    }
  });

  const firstRefresh = await service.getResult({
    runId: "run-pressure-1",
    viewerId: "viewer-cabinet_finance",
  });
  const secondRefresh = await service.getResult({
    runId: "run-pressure-1",
    viewerId: "viewer-cabinet_finance",
  });
  assert.deepEqual(secondRefresh, firstRefresh);
  assert.equal(secondRefresh.decisionHash, firstRefresh.decisionHash);
  assert.equal(secondRefresh.payload.structuredResultHash, firstRefresh.payload.structuredResultHash);
});

test("publishing narrative changes presentation hash but not structured authority projection", async () => {
  const pending = await harness(
    pressureResultReadModelFixture("MULTIPLAYER", "PENDING"),
  ).service.getResult({
    runId: "run-pressure-1",
    viewerId: "viewer-cabinet_finance",
  });
  const published = await harness(
    pressureResultReadModelFixture("MULTIPLAYER", "PUBLISHED"),
  ).service.getResult({
    runId: "run-pressure-1",
    viewerId: "viewer-cabinet_finance",
  });

  assert.equal(pending.payload.structuredResultHash, published.payload.structuredResultHash);
  assert.equal(pending.presentationHash, null);
  assert.equal(published.narrativeStatus, "PUBLISHED");
  assert.ok(published.presentationHash);
  assert.equal(published.payload.narrative.text, "NARRATIVE_FOR_cabinet_finance");
});

test("published narrative projection exposes only the current seat artifact", async () => {
  const { service } = harness(
    pressureResultReadModelFixture("MULTIPLAYER", "PUBLISHED"),
  );
  const results = await Promise.all(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) =>
      service.getResult({
        runId: "run-pressure-1",
        viewerId: `viewer-${seatId}`,
      }),
    ),
  );

  results.forEach((result, index) => {
    const ownSeat = PRESSURE_CHAPTER_SEAT_IDS_V1[index]!;
    assert.equal(result.payload.narrative.text, `NARRATIVE_FOR_${ownSeat}`);
    const serialized = JSON.stringify(result);
    for (const otherSeat of PRESSURE_CHAPTER_SEAT_IDS_V1) {
      if (otherSeat !== ownSeat) {
        assert.doesNotMatch(serialized, new RegExp(`NARRATIVE_FOR_${otherSeat}`));
      }
    }
  });
});

test("an impact grant cannot override the committed seat ACL", () => {
  const source = pressureResultReadModelFixture();
  const viewer = viewerFixture("cabinet_finance");
  const forgedGrant = {
    ...viewer,
    authorizedImpactIds: ["impact-private-jiangnan_merchant"],
  };
  const projected = new PressureResultAudienceProjectorV1().project(
    source,
    forgedGrant,
  );
  assert.deepEqual(
    projected.visibleOutcomes.map((outcome) => outcome.outcomeId),
    ["impact-public-record"],
  );
  assert.doesNotMatch(JSON.stringify(projected), /IMPACT_SECRET_FOR_jiangnan_merchant/);
});

test("unknown renderer, registry version and illegal stored route fail closed", async () => {
  const unknownRenderer = pressureResultReadModelFixture() as any;
  unknownRenderer.authority.rendererKey = "guess-from-payload";
  await assert.rejects(
    harness(unknownRenderer).service.getResult({
      runId: "run-pressure-1",
      viewerId: "viewer-cabinet_finance",
    }),
    (error: unknown) =>
      error instanceof PressureResultReadError &&
      error.code === "RESULT_RENDERER_UNAVAILABLE",
  );

  const unknownRegistry = pressureResultReadModelFixture() as any;
  unknownRegistry.authority.resultContractRegistryVersion = "result-contract-registry-99.0.0";
  const { snapshotHash: _unknownRegistryHash, ...unknownRegistryBody } = unknownRegistry.authority;
  unknownRegistry.authority.snapshotHash = sha256Canonical(unknownRegistryBody);
  await assert.rejects(
    harness(unknownRegistry).service.getResult({
      runId: "run-pressure-1",
      viewerId: "viewer-cabinet_finance",
    }),
    (error: unknown) =>
      error instanceof PressureResultReadError &&
      error.code === "RESULT_REGISTRY_UNAVAILABLE",
  );

  const illegalRoute = pressureResultReadModelFixture() as any;
  illegalRoute.authority.frozenRoute.runtimeProfile = "OPENNOVEL_T20_V1";
  await assert.rejects(
    harness(illegalRoute).service.getResult({
      runId: "run-pressure-1",
      viewerId: "viewer-cabinet_finance",
    }),
    (error: unknown) =>
      error instanceof PressureResultReadError &&
      error.code === "RESULT_ROUTE_CONTRACT_MISMATCH",
  );
});

test("unauthorized and not-finalized reads stop before projection or replay policy", async () => {
  const denied = harness();
  await assert.rejects(
    denied.service.getResult({ runId: "run-pressure-1", viewerId: "stranger" }),
    (error: unknown) =>
      error instanceof PressureResultReadError && error.code === "RESULT_ACCESS_DENIED",
  );
  assert.equal(denied.counters.resultReads, 0);
  assert.equal(denied.counters.policyReads, 0);

  const notReady = harness(null);
  await assert.rejects(
    notReady.service.getResult({
      runId: "run-pressure-1",
      viewerId: "viewer-cabinet_finance",
    }),
    (error: unknown) =>
      error instanceof PressureResultReadError && error.code === "RESULT_NOT_READY",
  );
  assert.equal(notReady.counters.policyReads, 0);
});
