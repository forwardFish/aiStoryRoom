import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type RunRouteSnapshotV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  type PressureChapterDefinition,
} from "@ai-story/templates";
import type {
  WorkingLedgerAppendResultV1,
  WorkingLedgerEventV1,
  WorkingLedgerKeyV1,
  WorkingLedgerPort,
} from "../working-ledger/contracts";
import { buildWorkingLedgerEvents, projectWorkingLedger } from "../working-ledger/working-ledger";
import { WorkingLedgerService } from "../working-ledger/working-ledger.service";
import { createSangtianAEmotionContentSourceCompilerV1 } from "../a-emotion-production/content-source";
import {
  PressureSimplePromiseErrorV1,
  PressureSimplePromiseServiceV1,
  PressurePromiseOperationServiceV1,
  compilePressurePromiseOperationMutationV1,
  pressureSimplePromiseIdV1,
  type PressureSimplePromiseAccessV1,
  PressureWorkingLedgerFormalCommitmentServiceV1,
} from ".";

function route(): RunRouteSnapshotV1 {
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1" as const,
    runId: "run-promise-1",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    orchestrationPackageVersion: "sangtian-orchestration-v1",
    orchestrationPackageSha256: sha256Canonical({ orchestration: 1 }),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: sha256Canonical({ runtime: 1 }),
    testMatrixVersion: "pressure-tests-v1",
    testMatrixSha256: sha256Canonical({ tests: 1 }),
    runSeed: "promise-seed",
    narrativeProfileVersion: "openovel-pressure-v1",
    featureSetVersion: "pressure-feature-v1",
    resultContractRegistryVersion: "pressure-result-registry-v1",
    participantMode: "MULTIPLAYER" as const,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: ["zhejiang_administration", "zhejiang_governor"],
    contentPackageVersion: "1.0.0",
    contentPackageSha256: sha256Canonical({ content: 1 }),
    controlTopologyVersion: "six-seat-control-1.0.0",
    initialRoleControlSnapshotHash: sha256Canonical({ control: 1 }),
  });
}

function access(overrides: Partial<PressureSimplePromiseAccessV1> = {}): PressureSimplePromiseAccessV1 {
  return {
    routeSnapshot: route(),
    runId: "run-promise-1",
    chapterRuntimeId: "chapter-runtime-N6",
    chapterId: "N6",
    decisionPointId: "N6.ledger_exchange",
    issuerSeatId: "zhejiang_administration",
    controlEpoch: 3,
    expectedWorkingRevision: 9,
    nextActionOrdinal: 1,
    allowedPromiseCodes: ["DELIVER_ORIGINAL_LEDGER"],
    interactableSeatIds: ["zhejiang_governor"],
    existingIssuerPromiseIds: [],
    ...overrides,
  };
}

const body = {
  targetRoleId: "zhejiang_governor" as const,
  promiseCode: "DELIVER_ORIGINAL_LEDGER" as const,
  visibility: "PRIVATE" as const,
  clientRequestId: "client-promise-1",
};

test("formal preset Promise creates one Working Ledger CREATE mutation without text or Provider input", async () => {
  let submitted: any;
  const service = new PressureSimplePromiseServiceV1(
    { async load() { return access(); } },
    {
      async submit(command) {
        submitted = command;
        const [event] = buildWorkingLedgerEvents({
          key: { runId: command.action.runId, chapterRuntimeId: command.action.chapterRuntimeId },
          chapterId: command.action.chapterId,
          previousEvents: [],
          payloads: [{
            eventType: "FORMAL_COMMITMENT_APPLIED",
            routeHash: command.routeSnapshot.routeHash,
            inputFingerprint: command.inputFingerprint,
            action: command.action,
            mutation: command.mutation,
            audienceSeatIds: command.audienceSeatIds,
          }],
        });
        return { status: "ACCEPTED" as const, event: event! };
      },
    },
  );
  const created = await service.create({ roomId: "room-1", subjectId: "user-issuer", body });
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.sourceRoleId, "zhejiang_administration");
  assert.equal(created.targetRoleId, "zhejiang_governor");
  assert.equal(created.relatedObjectId, "original-grain-ledger");
  assert.equal(created.promiseId, pressureSimplePromiseIdV1({ runId: "run-promise-1", issuerSeatId: "zhejiang_administration" }));
  assert.equal(submitted.action.actionType, "CREATE_SIMPLE_PROMISE_DELIVER_ORIGINAL_LEDGER");
  assert.deepEqual(submitted.mutation, {
    commitmentId: created.promiseId,
    operation: "CREATE",
    seatIds: ["zhejiang_administration", "zhejiang_governor"],
    sourceActionId: created.createdByActionId,
  });
  assert.deepEqual(submitted.action.payload, {
    interactionKind: "FORMAL_PROMISE",
    promiseCode: "DELIVER_ORIGINAL_LEDGER",
    targetRoleId: "zhejiang_governor",
    visibility: "PRIVATE",
    relatedObjectId: "original-grain-ledger",
  });
  assert.equal(submitted.action.requestFingerprint, computeDecisionActionRequestFingerprint(submitted.action));
  assert.doesNotMatch(JSON.stringify(submitted), /provider|prompt|free.?text/iu);
});

test("Promise creation reuses the exact committed action seal on Product-style replay", async () => {
  let snapshot = access();
  let committed: Extract<WorkingLedgerEventV1["payload"], { eventType: "FORMAL_COMMITMENT_APPLIED" }> | null = null;
  const service = new PressureSimplePromiseServiceV1(
    { async load() { return snapshot; } },
    { async submit(command) {
      if (committed === null) {
        committed = {
          eventType: "FORMAL_COMMITMENT_APPLIED",
          routeHash: command.routeSnapshot.routeHash,
          inputFingerprint: command.inputFingerprint,
          action: command.action,
          mutation: command.mutation,
          audienceSeatIds: command.audienceSeatIds,
        };
        snapshot = access({
          nextActionOrdinal: command.action.actionOrdinal + 1,
          existingIssuerPromiseIds: [command.mutation.commitmentId],
          currentPromiseOperation: "CREATE",
          priorCommitmentActionsByIdempotencyKey: new Map([[
            command.action.idempotencyKey,
            command.action,
          ]]),
        });
        return { status: "ACCEPTED", event: { payload: committed } as WorkingLedgerEventV1 };
      }
      assert.equal(command.action.sealedHash, committed.action.sealedHash);
      assert.equal(command.action.actionOrdinal, committed.action.actionOrdinal);
      return { status: "REPLAYED", event: { payload: committed } as WorkingLedgerEventV1 };
    } },
  );
  const command = {
    roomId: "room-1",
    subjectId: "issuer",
    body: {
      targetRoleId: "zhejiang_governor" as const,
      promiseCode: "DELIVER_ORIGINAL_LEDGER" as const,
      visibility: "PRIVATE" as const,
      clientRequestId: "product-replay-1",
    },
  };
  assert.equal((await service.create(command)).submitStatus, "ACCEPTED");
  assert.equal((await service.create(command)).submitStatus, "REPLAYED");
});

test("Promise creation is server-role bound and one-slot fail closed", async () => {
  for (const bad of [
    access({ issuerSeatId: "cabinet_finance" }),
    access({ existingIssuerPromiseIds: ["already-created"] }),
    access({ interactableSeatIds: [] }),
  ]) {
    const service = new PressureSimplePromiseServiceV1(
      { async load() { return bad; } },
      { async submit() { throw new Error("must not write"); } },
    );
    await assert.rejects(
      () => service.create({ roomId: "room-1", subjectId: "user-issuer", body }),
      PressureSimplePromiseErrorV1,
    );
  }
});

test("generic DELIVER_LEDGER is never interpreted as original; only explicit operation codes mutate lifecycle", () => {
  assert.deepEqual(compilePressurePromiseOperationMutationV1({
    promiseId: "promise-1",
    operationCode: "PROMISE_DELIVER_ORIGINAL_FULFILL",
    sourceActionId: "action-explicit-original",
  }), {
    commitmentId: "promise-1",
    operation: "FULFILL",
    seatIds: ["zhejiang_administration", "zhejiang_governor"],
    sourceActionId: "action-explicit-original",
  });
  assert.deepEqual(compilePressurePromiseOperationMutationV1({
    promiseId: "promise-1",
    operationCode: "PROMISE_DELIVER_COPY_BREAK",
    sourceActionId: "action-explicit-copy",
  }).operation, "BREAK");
  assert.throws(
    () => compilePressurePromiseOperationMutationV1({
      promiseId: "promise-1",
      operationCode: "DELIVER_LEDGER" as never,
      sourceActionId: "action-generic",
    }),
    PressureSimplePromiseErrorV1,
  );
});

test("FORMAL_COMMITMENT_APPLIED immediately survives projection, replays once, and never advances the Decision Beat", async () => {
  const ledger = new MemoryLedger();
  const routeSnapshot = route();
  const definition: PressureChapterDefinition = {
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N6",
    sequence: 6,
    requirementDependencies: [],
    decisionPoints: [{
      decisionPointId: "N6.ledger_exchange",
      kernelId: "kernel-promise",
      chapterId: "N6",
      sourceOrder: 1,
      prompt: "ledger exchange",
      requirementIds: ["req-ledger"],
      options: [{
        optionId: "DELIVER_LEDGER",
        sourceOrder: 1,
        label: "deliver ledger",
        workingDelta: {},
      }],
    }],
  };
  await new WorkingLedgerService(ledger).open({
    routeSnapshot,
    chapterRuntimeId: "chapter-runtime-N6",
    chapterDefinition: definition,
    initialState: createChapterWorkingState({ runId: routeSnapshot.runId, chapterId: "N6" }),
  });
  const commit = new PressureWorkingLedgerFormalCommitmentServiceV1(ledger);
  const service = new PressureSimplePromiseServiceV1(
    { async load() { return access({ expectedWorkingRevision: 0 }); } },
    commit,
  );

  const first = await service.create({ roomId: "room-1", subjectId: "user-issuer", body });
  const afterFirst = projectWorkingLedger(await ledger.read({
    runId: routeSnapshot.runId,
    chapterRuntimeId: "chapter-runtime-N6",
  }));
  assert.equal(first.submitStatus, "ACCEPTED");
  assert.equal(afterFirst.commitments.get(first.promiseId)?.operation, "CREATE");
  assert.equal(afterFirst.state.revision, 0);
  assert.equal(afterFirst.nextDecisionPin?.decisionPointId, "N6.ledger_exchange");
  assert.equal(afterFirst.acceptedActions.size, 0);
  const createEmissions = createSangtianAEmotionContentSourceCompilerV1()
    .compileFormalCommitment({
      sourceKind: "FORMAL_COMMITMENT_COMMITTED",
      roomId: routeSnapshot.runId,
      committedAt: "2026-08-12T08:00:00.000Z",
      commitmentEventHash: (await ledger.read({
        runId: routeSnapshot.runId,
        chapterRuntimeId: "chapter-runtime-N6",
      })).at(-1)!.eventHash,
      ledgerEvents: await ledger.read({
        runId: routeSnapshot.runId,
        chapterRuntimeId: "chapter-runtime-N6",
      }),
    });
  assert.equal(createEmissions.length, 1);
  assert.equal(createEmissions[0]?.job.sourceKind, "FORMAL_COMMITMENT_COMMITTED");
  assert.equal(createEmissions[0]?.source.signal.promiseId, first.promiseId);
  assert.equal(createEmissions[0]?.source.signal.disclosure, "CONFIRMED");
  assert.equal(createEmissions[0]?.source.signal.presentation.modalTrigger, null);

  const replay = await service.create({ roomId: "room-1", subjectId: "user-issuer", body });
  assert.equal(replay.submitStatus, "REPLAYED");
  assert.equal(ledger.appendCalls, 2); // open + exactly one commitment event

  const conflicting = new PressureSimplePromiseServiceV1(
    { async load() { return access({ expectedWorkingRevision: 0, existingIssuerPromiseIds: [first.promiseId] }); } },
    commit,
  );
  await assert.rejects(
    () => conflicting.create({
      roomId: "room-1",
      subjectId: "user-issuer",
      body: { ...body, clientRequestId: "different-request" },
    }),
    (error: unknown) => error instanceof PressureSimplePromiseErrorV1
      && error.code === "PRESSURE_SIMPLE_PROMISE_SLOT_EXHAUSTED",
  );
});

test("explicit copy delivery commits BROKEN, emits HIDDEN, and never emits PromiseBroken modal", async () => {
  const ledger = new MemoryLedger();
  const routeSnapshot = route();
  const definition: PressureChapterDefinition = {
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N6",
    sequence: 6,
    requirementDependencies: [],
    decisionPoints: [{
      decisionPointId: "N6.ledger_exchange",
      kernelId: "kernel-promise",
      chapterId: "N6",
      sourceOrder: 1,
      prompt: "ledger exchange",
      requirementIds: ["req-ledger"],
      options: [{ optionId: "DELIVER_LEDGER", sourceOrder: 1, label: "deliver", workingDelta: {} }],
    }],
  };
  await new WorkingLedgerService(ledger).open({
    routeSnapshot,
    chapterRuntimeId: "chapter-runtime-N6",
    chapterDefinition: definition,
    initialState: createChapterWorkingState({ runId: routeSnapshot.runId, chapterId: "N6" }),
  });
  const commit = new PressureWorkingLedgerFormalCommitmentServiceV1(ledger);
  const create = new PressureSimplePromiseServiceV1(
    { async load() { return access({ expectedWorkingRevision: 0 }); } },
    commit,
  );
  const created = await create.create({ roomId: "room-1", subjectId: "issuer", body });
  const operation = new PressurePromiseOperationServiceV1(
    { async load() {
      return access({
        expectedWorkingRevision: 0,
        nextActionOrdinal: 2,
        existingIssuerPromiseIds: [created.promiseId],
        currentPromiseOperation: "CREATE",
        allowedPromiseOperationCodes: ["PROMISE_DELIVER_COPY_BREAK"],
      });
    } },
    commit,
  );
  const applied = await operation.apply({
    roomId: "room-1",
    subjectId: "issuer",
    promiseId: created.promiseId,
    operationCode: "PROMISE_DELIVER_COPY_BREAK",
    clientRequestId: "copy-break-1",
  });
  assert.equal(applied.status, "BROKEN");
  const events = await ledger.read({ runId: routeSnapshot.runId, chapterRuntimeId: "chapter-runtime-N6" });
  const projection = projectWorkingLedger(events);
  assert.equal(projection.commitments.get(created.promiseId)?.operation, "BREAK");
  assert.equal(projection.state.revision, 0);
  const emissions = createSangtianAEmotionContentSourceCompilerV1().compileFormalCommitment({
    sourceKind: "FORMAL_COMMITMENT_COMMITTED",
    roomId: routeSnapshot.runId,
    committedAt: "2026-08-12T08:01:00.000Z",
    commitmentEventHash: events.at(-1)!.eventHash,
    ledgerEvents: events,
  });
  assert.equal(emissions.length, 1);
  assert.equal(emissions[0]?.source.signal.eventCode, "LEDGER_DELIVERY_ANOMALY");
  assert.equal(emissions[0]?.source.signal.disclosure, "HIDDEN");
  assert.equal(emissions[0]?.source.signal.presentation.modalTrigger, null);
  assert.deepEqual(emissions[0]?.source.signal.evidenceRefs, []);
  assert.deepEqual(emissions[0]?.source.signal.audienceSpec, {
    type: "EXPLICIT",
    seatIds: ["qingliu_law", "zhejiang_administration", "zhejiang_governor"],
  });

  const replayOperation = new PressurePromiseOperationServiceV1(
    { async load() {
      return access({
        expectedWorkingRevision: 0,
        nextActionOrdinal: 2,
        existingIssuerPromiseIds: [created.promiseId],
        currentPromiseOperation: "BREAK",
        allowedPromiseOperationCodes: ["PROMISE_DELIVER_COPY_BREAK"],
      });
    } },
    commit,
  );
  const replay = await replayOperation.apply({
    roomId: "room-1",
    subjectId: "issuer",
    promiseId: created.promiseId,
    operationCode: "PROMISE_DELIVER_COPY_BREAK",
    clientRequestId: "copy-break-1",
  });
  assert.equal(replay.submitStatus, "REPLAYED");
  await assert.rejects(
    () => replayOperation.apply({
      roomId: "room-1",
      subjectId: "issuer",
      promiseId: created.promiseId,
      operationCode: "PROMISE_DELIVER_COPY_BREAK",
      clientRequestId: "different-break-request",
    }),
    PressureSimplePromiseErrorV1,
  );
});

class MemoryLedger implements WorkingLedgerPort {
  readonly records = new Map<string, WorkingLedgerEventV1[]>();
  appendCalls = 0;

  async read(key: WorkingLedgerKeyV1): Promise<WorkingLedgerEventV1[]> {
    return structuredClone(this.records.get(JSON.stringify(key)) ?? []);
  }

  async append(input: {
    key: WorkingLedgerKeyV1;
    expectedHeadHash: string | null;
    events: WorkingLedgerEventV1[];
  }): Promise<WorkingLedgerAppendResultV1> {
    this.appendCalls += 1;
    const key = JSON.stringify(input.key);
    const current = this.records.get(key) ?? [];
    if ((current.at(-1)?.eventHash ?? null) !== input.expectedHeadHash) {
      return { status: "HEAD_MISMATCH", events: structuredClone(current) };
    }
    this.records.set(key, [...current, ...structuredClone(input.events)]);
    return { status: "APPENDED", events: structuredClone(input.events) };
  }
}
