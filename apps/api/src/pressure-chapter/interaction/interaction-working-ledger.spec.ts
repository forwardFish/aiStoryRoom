import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type CanonicalJsonObject,
  type DecisionActionV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  type PressureChapterDefinition,
} from "@ai-story/templates";
import { WorkingBeatApplicationService } from "../working-ledger/beat-application.service";
import type {
  WorkingActionIntentV1,
  WorkingLedgerAppendResultV1,
  WorkingLedgerEventV1,
  WorkingLedgerKeyV1,
  WorkingLedgerPort,
} from "../working-ledger/contracts";
import { WorkingLedgerError } from "../working-ledger/errors";
import {
  projectWorkingLedger,
  visibleFormalActionsForSeat,
} from "../working-ledger/working-ledger";
import { WorkingLedgerService } from "../working-ledger/working-ledger.service";
import { PressureChapterChatService, computePressureChatRequestFingerprint } from "./chat.service";
import type {
  PressureChatMessageV1,
  PressureChatPort,
  PressureInteractionAccessPort,
  PressureInteractionAccessV1,
  PressureSystemDefaultAccessContextV1,
  SubmitPressureChatCommandV1,
} from "./contracts";
import {
  FormalPressureInteractionService,
  computeFormalInteractionInputFingerprint,
} from "./formal-interaction.service";
import { PressureInteractionError } from "./errors";

const ACTOR: SeatIdV1 = "cabinet_finance";
const TARGET: SeatIdV1 = "jiangnan_merchant";
const OUTSIDER: SeatIdV1 = "qingliu_law";

class MemoryLedger implements WorkingLedgerPort {
  readonly records = new Map<string, WorkingLedgerEventV1[]>();
  appendCalls = 0;

  async read(key: WorkingLedgerKeyV1): Promise<WorkingLedgerEventV1[]> {
    return structuredClone(this.records.get(keyOf(key)) ?? []);
  }

  async append(input: {
    key: WorkingLedgerKeyV1;
    expectedHeadHash: string | null;
    events: WorkingLedgerEventV1[];
  }): Promise<WorkingLedgerAppendResultV1> {
    this.appendCalls += 1;
    const current = this.records.get(keyOf(input.key)) ?? [];
    const head = current.at(-1)?.eventHash ?? null;
    if (head !== input.expectedHeadHash) {
      return { status: "HEAD_MISMATCH", events: structuredClone(current) };
    }
    const next = [...current, ...structuredClone(input.events)];
    this.records.set(keyOf(input.key), next);
    return { status: "APPENDED", events: structuredClone(input.events) };
  }
}

class StaticAccess implements PressureInteractionAccessPort {
  calls: Array<{
    subjectId: string;
    runId: string;
    chapterRuntimeId: string;
    actionContext?: {
      decisionPointId: string;
      seatId: SeatIdV1;
      controlEpoch: number;
      actionType: string;
      payloadHash: string;
      idempotencyKey: string;
    };
    systemDefault?: PressureSystemDefaultAccessContextV1;
  }> = [];
  constructor(public value: PressureInteractionAccessV1) {}
  async load(input: {
    subjectId: string;
    runId: string;
    chapterRuntimeId: string;
    actionContext?: {
      decisionPointId: string;
      seatId: SeatIdV1;
      controlEpoch: number;
      actionType: string;
      payloadHash: string;
      idempotencyKey: string;
    };
    systemDefault?: PressureSystemDefaultAccessContextV1;
  }): Promise<PressureInteractionAccessV1> {
    this.calls.push(structuredClone(input));
    return structuredClone(this.value);
  }
}

class MemoryChat implements PressureChatPort {
  readonly messages: PressureChatMessageV1[] = [];

  async findByIdempotencyKey(input: {
    runId: string;
    chapterRuntimeId: string;
    idempotencyKey: string;
  }): Promise<PressureChatMessageV1 | null> {
    return structuredClone(this.messages.find((message) => (
      message.runId === input.runId
      && message.chapterRuntimeId === input.chapterRuntimeId
      && message.idempotencyKey === input.idempotencyKey
    )) ?? null);
  }

  async appendIfAbsent(message: PressureChatMessageV1) {
    const prior = await this.findByIdempotencyKey(message);
    if (prior) return { status: "EXISTING" as const, message: prior };
    this.messages.push(structuredClone(message));
    return { status: "APPENDED" as const, message: structuredClone(message) };
  }

  async list(input: { runId: string; chapterRuntimeId: string }) {
    return structuredClone(this.messages.filter((message) => (
      message.runId === input.runId && message.chapterRuntimeId === input.chapterRuntimeId
    )));
  }
}

function route(): RunRouteSnapshotV1 {
  const digest = (label: string) => sha256Canonical({ label });
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: "run-pc-w5",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: "sangtian-content-v1",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "sangtian-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-tests-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "seed-pc-w5",
    narrativeProfileVersion: "openovel-pressure-v1",
    featureSetVersion: "pressure-feature-v1",
    resultContractRegistryVersion: "pressure-result-registry-v1",
    participantMode: "MULTIPLAYER",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [ACTOR, TARGET],
    controlTopologyVersion: "pressure-control-v1",
    initialRoleControlSnapshotHash: digest("control"),
  });
}

function chapter(): PressureChapterDefinition {
  return {
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N1",
    sequence: 1,
    requirementDependencies: [],
    decisionPoints: [
      {
        decisionPointId: "dp-investigate",
        kernelId: "kernel-investigate",
        chapterId: "N1",
        sourceOrder: 1,
        prompt: "调查粮仓",
        requirementIds: ["req-clue"],
        priority: { duePressureCount: 1 },
        options: [{
          optionId: "inspect-ledger",
          sourceOrder: 1,
          label: "查账",
          workingDelta: {
            setFacts: { "clue.ledger": true },
            incrementCounters: { investigation: 1 },
            satisfyRequirementIds: ["req-clue"],
            reaction: {
              kind: "CLUE_FOUND",
              summary: "账本出现异常",
              audience: "RELATED",
              causalFactIds: ["clue.ledger"],
            },
          },
        }],
      },
      {
        decisionPointId: "dp-negotiate",
        kernelId: "kernel-negotiate",
        chapterId: "N1",
        sourceOrder: 2,
        prompt: "与商人谈判",
        requirementIds: ["req-negotiate"],
        activation: { allSatisfiedRequirementIds: ["req-clue"] },
        options: [{
          optionId: "offer-protection",
          sourceOrder: 1,
          label: "承诺保护",
          workingDelta: { setFacts: { "deal.offered": true } },
        }],
      },
    ],
  };
}

async function openedFixture() {
  const routeSnapshot = route();
  const definition = chapter();
  const ledger = new MemoryLedger();
  const initialState = createChapterWorkingState({ runId: routeSnapshot.runId, chapterId: "N1" });
  const open = await new WorkingLedgerService(ledger).open({
    routeSnapshot,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: definition,
    initialState,
  });
  const key = { runId: routeSnapshot.runId, chapterRuntimeId: "runtime-n1" };
  const projection = projectWorkingLedger(await ledger.read(key));
  return { routeSnapshot, definition, ledger, key, projection, open };
}

function decisionAction(input: {
  routeSnapshot: RunRouteSnapshotV1;
  actionId?: string;
  idempotencyKey?: string;
  expectedWorkingRevision?: number;
  decisionPointId?: string;
  optionId?: string;
  actionType?: string;
  payload?: CanonicalJsonObject;
}): DecisionActionV1 {
  const payload = input.payload ?? { optionId: input.optionId ?? "inspect-ledger" };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: input.actionId ?? "action-investigate-1",
    runId: input.routeSnapshot.runId,
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1" as const,
    decisionPointId: input.decisionPointId ?? "dp-investigate",
    seatId: ACTOR,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 4,
    expectedWorkingRevision: input.expectedWorkingRevision ?? 0,
    status: "SEALED" as const,
    actionType: input.actionType ?? "DECIDE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: input.idempotencyKey ?? "idem-action-1",
  };
  const withRequest = {
    ...body,
    requestFingerprint: computeDecisionActionRequestFingerprint(body),
  };
  return { ...withRequest, sealedHash: sha256Canonical(withRequest) };
}

function intent(overrides: Partial<WorkingActionIntentV1> = {}): WorkingActionIntentV1 {
  return {
    visibility: "PARTICIPANTS",
    targetSeatIds: [TARGET],
    evidenceRefs: ["evidence-ledger"],
    resourceReservations: [{ reservationKey: "reserve-grain-1", resourceId: "grain", amount: 4 }],
    commitmentMutations: [{ commitmentId: "promise-protect", operation: "CREATE", seatIds: [ACTOR, TARGET] }],
    knowledgeGrants: [{ seatId: TARGET, factRefs: ["clue.ledger"] }],
    seatArcProgress: [{ seatId: ACTOR, progressDelta: 1 }],
    ...overrides,
  };
}

function accessFor(
  routeSnapshot: RunRouteSnapshotV1,
  projection: ReturnType<typeof projectWorkingLedger>,
): PressureInteractionAccessV1 {
  return {
    routeHash: routeSnapshot.routeHash,
    runId: routeSnapshot.runId,
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1",
    workingRevision: projection.state.revision,
    workingStateHash: projection.stateHash,
    activeDecisionPointId: projection.nextDecisionPin?.decisionPointId ?? null,
    controlledSeatIds: [ACTOR],
    controlEpochBySeat: { [ACTOR]: 4 },
    allowedActionTypes: ["DECIDE"],
    interactableSeatIds: [TARGET],
    visibleEvidenceRefs: ["evidence-ledger"],
    resourceAvailability: [{ resourceId: "grain", availableAmount: 5 }],
  };
}

test("ordinary chat remains outside the formal append-only ledger and is audience-filtered", async () => {
  const fixture = await openedFixture();
  const chatPort = new MemoryChat();
  const access = new StaticAccess(accessFor(fixture.routeSnapshot, fixture.projection));
  const service = new PressureChapterChatService(access, chatPort);
  const base = {
    routeSnapshot: fixture.routeSnapshot,
    senderSeatId: ACTOR,
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1" as const,
    visibility: "PARTICIPANTS" as const,
    targetSeatIds: [TARGET],
    text: "我们先核对账本。",
    idempotencyKey: "chat-idem-1",
  };
  const command: SubmitPressureChatCommandV1 = {
    ...base,
    subjectId: "user-a",
    requestFingerprint: computePressureChatRequestFingerprint(base),
  };
  const before = await fixture.ledger.read(fixture.key);
  assert.equal((await service.submit(command)).status, "APPENDED");
  assert.equal((await service.submit(command)).status, "REPLAYED");
  assert.equal(access.calls[0]?.systemDefault, undefined);
  assert.equal(access.calls[0]?.actionContext, undefined);
  assert.deepEqual(await fixture.ledger.read(fixture.key), before);
  access.value.controlledSeatIds = [TARGET];
  assert.equal((await service.listVisible({ ...fixture.key, subjectId: "user-b", viewerSeatId: TARGET })).length, 1);
  access.value.controlledSeatIds = [OUTSIDER];
  assert.equal((await service.listVisible({ ...fixture.key, subjectId: "user-c", viewerSeatId: OUTSIDER })).length, 0);
  await assert.rejects(
    () => service.listVisible({ ...fixture.key, subjectId: "user-c", viewerSeatId: TARGET }),
    (error: unknown) => error instanceof PressureInteractionError
      && error.code === "PRESSURE_INTERACTION_SEAT_NOT_CONTROLLED",
  );

  access.value.controlledSeatIds = [ACTOR];
  await assert.rejects(
    () => {
      const changed = { ...base, text: "篡改" };
      return service.submit({
        ...changed,
        subjectId: "user-a",
        requestFingerprint: computePressureChatRequestFingerprint(changed),
      });
    },
    (error: unknown) => error instanceof PressureInteractionError
      && error.code === "PRESSURE_INTERACTION_IDEMPOTENCY_MISMATCH",
  );
});

test("formal interaction forwards deterministic-default authorization and replay stays fail-closed", async () => {
  const fixture = await openedFixture();
  const action = decisionAction({
    routeSnapshot: fixture.routeSnapshot,
    actionId: "default-action-1",
    idempotencyKey: "default-idem-1",
    actionType: "DEFAULT_PASS",
    payload: { reason: "ABSENT" },
  });
  const workingIntent = intent({
    visibility: "PRIVATE",
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  });
  const authorizationContext: PressureSystemDefaultAccessContextV1 = {
    reason: "DEADLINE",
    defaultPolicyRef: "default-policy",
    defaultPolicyHash: sha256Canonical("default-policy"),
    canonicalActionPayloadHash: action.payloadHash,
  };
  const base = {
    routeSnapshot: fixture.routeSnapshot,
    action,
    intent: workingIntent,
    authorizationContext,
  };
  const service = new FormalPressureInteractionService(
    new class implements PressureInteractionAccessPort {
      async load(input: {
        subjectId: string;
        runId: string;
        chapterRuntimeId: string;
        actionContext?: {
          decisionPointId: string;
          seatId: SeatIdV1;
          controlEpoch: number;
          actionType: string;
          payloadHash: string;
          idempotencyKey: string;
        };
        systemDefault?: PressureSystemDefaultAccessContextV1;
      }): Promise<PressureInteractionAccessV1> {
        assert.equal(input.actionContext?.idempotencyKey, "default-idem-1");
        assert.equal(input.actionContext?.payloadHash, action.payloadHash);
        if (
          input.subjectId !== "pressure-ai-seat"
          || input.systemDefault?.canonicalActionPayloadHash !== action.payloadHash
          || input.systemDefault.defaultPolicyRef !== "default-policy"
        ) {
          return {
            ...accessFor(fixture.routeSnapshot, fixture.projection),
            controlledSeatIds: [],
            controlEpochBySeat: {},
            allowedActionTypes: [],
          };
        }
        return {
          ...accessFor(fixture.routeSnapshot, fixture.projection),
          controlledSeatIds: [ACTOR],
          controlEpochBySeat: { [ACTOR]: 4 },
          allowedActionTypes: ["DEFAULT_PASS"],
          interactableSeatIds: [],
          visibleEvidenceRefs: [],
          resourceAvailability: [],
        };
      }
    }(),
    fixture.ledger,
  );
  const accepted = await service.submit({
    ...base,
    subjectId: "pressure-ai-seat",
    inputFingerprint: computeFormalInteractionInputFingerprint(base),
  });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(
    (
      await service.submit({
        ...base,
        subjectId: "pressure-ai-seat",
        inputFingerprint: computeFormalInteractionInputFingerprint(base),
      })
    ).status,
    "REPLAYED",
  );
  await assert.rejects(
    () => service.submit({
      routeSnapshot: fixture.routeSnapshot,
      subjectId: "user-a",
      action,
      intent: workingIntent,
      inputFingerprint: computeFormalInteractionInputFingerprint(base),
    }),
    (error: unknown) => error instanceof PressureInteractionError
      && error.code === "PRESSURE_INTERACTION_SEAT_NOT_CONTROLLED",
  );
});

test("formal interaction seals route/action/intent, replays exactly, and protects private projections", async () => {
  const fixture = await openedFixture();
  const action = decisionAction({ routeSnapshot: fixture.routeSnapshot });
  const workingIntent = intent();
  const base = { routeSnapshot: fixture.routeSnapshot, action, intent: workingIntent };
  const command = {
    ...base,
    subjectId: "user-a",
    inputFingerprint: computeFormalInteractionInputFingerprint(base),
  };
  const access = new StaticAccess(accessFor(fixture.routeSnapshot, fixture.projection));
  const service = new FormalPressureInteractionService(access, fixture.ledger);
  const accepted = await service.submit(command);
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal((await service.submit(command)).status, "REPLAYED");
  const projection = projectWorkingLedger(await fixture.ledger.read(fixture.key));
  assert.equal(projection.acceptedActions.size, 1);
  assert.equal(projection.pendingReservations.get("reserve-grain-1")?.amount, 4);
  assert.equal(visibleFormalActionsForSeat(projection, TARGET).length, 1);
  assert.equal(visibleFormalActionsForSeat(projection, OUTSIDER).length, 0);

  const corrupted = await fixture.ledger.read(fixture.key);
  const acceptedEvent = corrupted[1]!;
  assert.equal(acceptedEvent.payload.eventType, "FORMAL_ACTION_ACCEPTED");
  if (acceptedEvent.payload.eventType === "FORMAL_ACTION_ACCEPTED") {
    acceptedEvent.payload.intent.evidenceRefs = [];
  }
  const { eventHash: _hash, ...corruptedBody } = acceptedEvent;
  acceptedEvent.eventHash = sha256Canonical(corruptedBody);
  assert.throws(
    () => projectWorkingLedger(corrupted),
    (error: unknown) => error instanceof WorkingLedgerError && error.code === "WORKING_LEDGER_CORRUPT",
  );

  access.value.controlledSeatIds = [OUTSIDER];
  await assert.rejects(
    () => service.submit(command),
    (error: unknown) => error instanceof PressureInteractionError
      && error.code === "PRESSURE_INTERACTION_SEAT_NOT_CONTROLLED",
  );
  access.value.controlledSeatIds = [ACTOR];

  await assert.rejects(
    () => {
      const changed = { ...base, intent: intent({ evidenceRefs: [] }) };
      return service.submit({
        ...changed,
        subjectId: "user-a",
        inputFingerprint: computeFormalInteractionInputFingerprint(changed),
      });
    },
    (error: unknown) => error instanceof PressureInteractionError
      && error.code === "PRESSURE_INTERACTION_IDEMPOTENCY_MISMATCH",
  );
});

test("formal interaction fails closed for cross-seat, evidence, and aggregate resource violations", async () => {
  for (const [label, badIntent, expectedCode] of [
    ["seat", intent({ targetSeatIds: [OUTSIDER] }), "PRESSURE_INTERACTION_TARGET_FORBIDDEN"],
    ["private-cross-seat", intent({ visibility: "PRIVATE" }), "PRESSURE_INTERACTION_TARGET_FORBIDDEN"],
    ["evidence", intent({ evidenceRefs: ["secret-evidence"] }), "PRESSURE_INTERACTION_EVIDENCE_FORBIDDEN"],
    ["resource", intent({ resourceReservations: [{ reservationKey: "r-too-much", resourceId: "grain", amount: 6 }] }), "PRESSURE_INTERACTION_RESOURCE_UNAVAILABLE"],
  ] as const) {
    const fixture = await openedFixture();
    const action = decisionAction({ routeSnapshot: fixture.routeSnapshot, actionId: `action-${label}`, idempotencyKey: `idem-${label}` });
    const base = { routeSnapshot: fixture.routeSnapshot, action, intent: badIntent };
    const service = new FormalPressureInteractionService(
      new StaticAccess(accessFor(fixture.routeSnapshot, fixture.projection)),
      fixture.ledger,
    );
    await assert.rejects(
      () => service.submit({ ...base, subjectId: "user-a", inputFingerprint: computeFormalInteractionInputFingerprint(base) }),
      (error: unknown) => error instanceof PressureInteractionError && error.code === expectedCode,
    );
    assert.equal((await fixture.ledger.read(fixture.key)).length, 1);
  }

  const fixture = await openedFixture();
  const service = new FormalPressureInteractionService(
    new StaticAccess(accessFor(fixture.routeSnapshot, fixture.projection)),
    fixture.ledger,
  );
  const firstAction = decisionAction({ routeSnapshot: fixture.routeSnapshot });
  const first = { routeSnapshot: fixture.routeSnapshot, action: firstAction, intent: intent() };
  await service.submit({ ...first, subjectId: "user-a", inputFingerprint: computeFormalInteractionInputFingerprint(first) });
  const secondAction = decisionAction({
    routeSnapshot: fixture.routeSnapshot,
    actionId: "action-resource-2",
    idempotencyKey: "idem-resource-2",
  });
  const secondIntent = intent({
    resourceReservations: [{ reservationKey: "reserve-grain-2", resourceId: "grain", amount: 2 }],
    commitmentMutations: [],
  });
  const second = { routeSnapshot: fixture.routeSnapshot, action: secondAction, intent: secondIntent };
  await assert.rejects(
    () => service.submit({ ...second, subjectId: "user-a", inputFingerprint: computeFormalInteractionInputFingerprint(second) }),
    (error: unknown) => error instanceof PressureInteractionError
      && error.code === "PRESSURE_INTERACTION_RESOURCE_UNAVAILABLE",
  );
});

test("BeatResolution updates only recoverable working state and exposes the next decision point", async () => {
  const fixture = await openedFixture();
  const action = decisionAction({ routeSnapshot: fixture.routeSnapshot });
  const workingIntent = intent();
  const formalBase = { routeSnapshot: fixture.routeSnapshot, action, intent: workingIntent };
  const inputFingerprint = computeFormalInteractionInputFingerprint(formalBase);
  await new FormalPressureInteractionService(
    new StaticAccess(accessFor(fixture.routeSnapshot, fixture.projection)),
    fixture.ledger,
  ).submit({ ...formalBase, subjectId: "user-a", inputFingerprint });

  const beatService = new WorkingBeatApplicationService(fixture.ledger);
  const beatCommand = {
    routeSnapshot: fixture.routeSnapshot,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: fixture.definition,
    actionId: action.actionId,
    actionInputFingerprint: inputFingerprint,
    resolverVersion: "working-beat-v1",
  };
  const applied = await beatService.apply(beatCommand);
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.resolution.baseWorkingRevision, 0);
  assert.equal(applied.resolution.committedWorkingRevision, 1);
  assert.equal(applied.resolution.reservationMutations[0]?.operation, "RESERVE");
  assert.equal(applied.resolution.workingDelta.commitmentMutations[0]?.commitmentId, "promise-protect");
  assert.equal((await beatService.apply(beatCommand)).status, "REPLAYED");

  const events = await fixture.ledger.read(fixture.key);
  const recovered = projectWorkingLedger(events);
  assert.equal(recovered.state.revision, 1);
  assert.equal(recovered.state.facts["clue.ledger"], true);
  assert.equal(recovered.nextDecisionPin?.decisionPointId, "dp-negotiate");
  assert.equal(recovered.appliedBeats.get(action.actionId)?.resolution.resolutionHash, applied.resolution.resolutionHash);
  assert.equal(recovered.pendingReservations.get("reserve-grain-1")?.status, "RESERVED");
  assert.equal(recovered.commitments.get("promise-protect")?.operation, "CREATE");
  assert.deepEqual(recovered.evidenceRefsByAction.get(action.actionId), ["evidence-ledger"]);
  assert.deepEqual(recovered.knowledgeBySeat.get(TARGET), ["clue.ledger"]);
  assert.equal(recovered.seatArcProgressBySeat.get(ACTOR), 1);
  assertNoAuthorityFields(events);

  const reopened = await new WorkingLedgerService(fixture.ledger).open({
    routeSnapshot: fixture.routeSnapshot,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: fixture.definition,
    initialState: createChapterWorkingState({ runId: fixture.routeSnapshot.runId, chapterId: "N1" }),
  });
  assert.equal(reopened.status, "REPLAYED");

  await assert.rejects(
    () => beatService.apply({ ...beatCommand, resolverVersion: "working-beat-v2" }),
    (error: unknown) => error instanceof WorkingLedgerError
      && error.code === "WORKING_LEDGER_IDEMPOTENCY_MISMATCH",
  );
});

test("ledger recovery detects mutation, chain reorder, and forbidden authoritative fields", async () => {
  const fixture = await openedFixture();
  const events = await fixture.ledger.read(fixture.key);
  const tampered = structuredClone(events);
  tampered[0]!.eventHash = sha256Canonical({ forged: true });
  assert.throws(
    () => projectWorkingLedger(tampered),
    (error: unknown) => error instanceof WorkingLedgerError && error.code === "WORKING_LEDGER_CORRUPT",
  );

  const authoritative = structuredClone(events);
  (authoritative[0]!.payload as unknown as Record<string, unknown>).worldSequence = 1;
  const { eventHash: _oldHash, ...authoritativeBody } = authoritative[0]!;
  authoritative[0]!.eventHash = sha256Canonical(authoritativeBody);
  assert.throws(
    () => projectWorkingLedger(authoritative),
    (error: unknown) => error instanceof WorkingLedgerError,
  );
});

function keyOf(key: WorkingLedgerKeyV1): string {
  return `${key.runId}:${key.chapterRuntimeId}`;
}

function assertNoAuthorityFields(value: unknown, path = "root"): void {
  const forbidden = new Set([
    "worldsequence",
    "worldstate",
    "frozenchapterbundle",
    "chaptersettlement",
    "finaledecision",
    "seatverdicts",
  ]);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoAuthorityFields(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assert.equal(forbidden.has(key.toLowerCase()), false, `${path}.${key}`);
    assertNoAuthorityFields(entry, `${path}.${key}`);
  }
}
