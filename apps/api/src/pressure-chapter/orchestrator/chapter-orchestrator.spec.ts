import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeSealedActionsHash,
  computeDecisionActionRequestFingerprint,
  nextChapterId,
  sha256Canonical,
  withRunRouteHash,
  type ChapterIdV1,
  type DecisionActionV1,
  type FrozenChapterBundleV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
  type TrackIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  type PressureChapterDefinition,
} from "@ai-story/templates";
import {
  FormalPressureInteractionService,
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import type {
  PressureInteractionAccessPort,
  PressureInteractionAccessV1,
  SubmitFormalInteractionCommandV1,
} from "../interaction/contracts";
import { WorkingBeatApplicationService } from "../working-ledger/beat-application.service";
import type {
  WorkingActionIntentV1,
  WorkingLedgerAppendResultV1,
  WorkingLedgerEventV1,
  WorkingLedgerKeyV1,
  WorkingLedgerPort,
} from "../working-ledger/contracts";
import { projectWorkingLedger } from "../working-ledger/working-ledger";
import { WorkingLedgerService } from "../working-ledger/working-ledger.service";
import {
  PressureChapterOrchestratorService,
  planBeatProgressionV1,
  planRecordedActionsV1,
} from "./chapter-orchestrator.service";
import type {
  AuthoredChapterContentPort,
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStatePort,
  ChapterOrchestratorStateV1,
  ChapterSettlementPort,
  ChapterWorkingSeedPort,
  DecisionBeatResolutionPort,
  DecisionCloseEvaluatorPort,
  DeterministicDefaultActionPort,
  FinaleRequestPort,
  FormalActionSubmissionPort,
  WorkingLedgerOpeningPort,
  WorkingProjectionReaderPort,
} from "./contracts";
import { ChapterOrchestratorError } from "./errors";

const ACTOR: SeatIdV1 = "cabinet_finance";
const POINT_COUNTS: Record<ChapterIdV1, number> = {
  N1: 1,
  N2: 4,
  N3: 7,
  N4: 2,
  N5: 5,
  N6: 3,
  N7: 6,
};

class MemoryOrchestratorStates implements ChapterOrchestratorStatePort {
  private readonly records = new Map<string, ChapterOrchestratorStateV1>();
  compareAndSwapCalls = 0;

  async read(runId: string) {
    return structuredClone(this.records.get(runId) ?? null);
  }

  async compareAndSwap(input: {
    runId: string;
    expectedRevision: number | null;
    next: ChapterOrchestratorStateV1;
  }) {
    this.compareAndSwapCalls += 1;
    const current = this.records.get(input.runId) ?? null;
    if ((current?.revision ?? null) !== input.expectedRevision) {
      return { status: "CONFLICT" as const, current: structuredClone(current) };
    }
    this.records.set(input.runId, structuredClone(input.next));
    return { status: "COMMITTED" as const, current: structuredClone(input.next) };
  }
}

class MemoryWorkingLedger implements WorkingLedgerPort {
  private readonly events = new Map<string, WorkingLedgerEventV1[]>();

  async read(key: WorkingLedgerKeyV1) {
    return structuredClone(this.events.get(keyOf(key)) ?? []);
  }

  async append(input: {
    key: WorkingLedgerKeyV1;
    expectedHeadHash: string | null;
    events: WorkingLedgerEventV1[];
  }): Promise<WorkingLedgerAppendResultV1> {
    const current = this.events.get(keyOf(input.key)) ?? [];
    if ((current.at(-1)?.eventHash ?? null) !== input.expectedHeadHash) {
      return { status: "HEAD_MISMATCH", events: structuredClone(current) };
    }
    this.events.set(keyOf(input.key), [...current, ...structuredClone(input.events)]);
    return { status: "APPENDED", events: structuredClone(input.events) };
  }
}

class AuthoredContent implements AuthoredChapterContentPort {
  readonly loads: ChapterIdV1[] = [];
  readonly descriptors = new Map<ChapterIdV1, AuthoredChapterRuntimeV1>();

  constructor(counts: Record<ChapterIdV1, number> = POINT_COUNTS) {
    for (const chapterId of CHAPTER_IDS_V1) {
      this.descriptors.set(chapterId, authoredChapter(chapterId, counts[chapterId]));
    }
  }

  async load(input: { chapterId: ChapterIdV1 }) {
    this.loads.push(input.chapterId);
    const descriptor = this.descriptors.get(input.chapterId);
    assert.ok(descriptor, `No descriptor for ${input.chapterId}`);
    return structuredClone(descriptor);
  }
}

class WorkingSeed implements ChapterWorkingSeedPort {
  loadCalls = 0;
  authorityCalls = 0;

  async load(input: Parameters<ChapterWorkingSeedPort["load"]>[0]) {
    this.loadCalls += 1;
    return this.seed(input);
  }

  async loadFromAuthority(
    input: Parameters<NonNullable<ChapterWorkingSeedPort["loadFromAuthority"]>>[0],
  ) {
    this.authorityCalls += 1;
    return this.seed(input);
  }

  private seed(input: Parameters<ChapterWorkingSeedPort["load"]>[0]) {
    return createChapterWorkingState({
      runId: input.routeSnapshot.runId,
      chapterId: input.chapter.chapterId,
    });
  }
}

class DynamicAccess implements PressureInteractionAccessPort {
  constructor(
    private readonly ledger: MemoryWorkingLedger,
    private readonly runtimes: Map<string, AuthoredChapterRuntimeV1>,
  ) {}

  async load(input: { runId: string; chapterRuntimeId: string }): Promise<PressureInteractionAccessV1> {
    const projection = projectWorkingLedger(await this.ledger.read(input));
    const descriptor = this.runtimes.get(input.chapterRuntimeId)!;
    const pointId = projection.nextDecisionPin?.decisionPointId ?? null;
    const decision = descriptor.decisions.find((candidate) => candidate.decisionPointId === pointId);
    return {
      routeHash: projection.routeHash,
      runId: projection.key.runId,
      chapterRuntimeId: projection.key.chapterRuntimeId,
      chapterId: projection.chapterId,
      workingRevision: projection.state.revision,
      workingStateHash: projection.stateHash,
      activeDecisionPointId: pointId,
      controlledSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
      controlEpochBySeat: Object.fromEntries(
        PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [seatId, 1]),
      ),
      allowedActionTypes: [...(decision?.execution.allowedActionTypes ?? [])],
      interactableSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
      visibleEvidenceRefs: ["evidence.public"],
      resourceAvailability: [],
    };
  }
}

class W5Harness {
  readonly ledger = new MemoryWorkingLedger();
  readonly runtimes = new Map<string, AuthoredChapterRuntimeV1>();
  private readonly opening = new WorkingLedgerService(this.ledger);
  private readonly formalService: FormalPressureInteractionService;
  private readonly beatService = new WorkingBeatApplicationService(this.ledger);
  projectionLoads = 0;

  constructor(private readonly content: AuthoredContent) {
    this.formalService = new FormalPressureInteractionService(
      new DynamicAccess(this.ledger, this.runtimes),
      this.ledger,
    );
  }

  readonly openingPort: WorkingLedgerOpeningPort = {
    open: async (command) => {
      const descriptor = this.content.descriptors.get(command.chapterDefinition.chapterId)!;
      this.runtimes.set(command.chapterRuntimeId, descriptor);
      return this.opening.open(command);
    },
  };

  readonly projectionPort: WorkingProjectionReaderPort = {
    load: async (input) => {
      this.projectionLoads += 1;
      return projectWorkingLedger(await this.ledger.read(input));
    },
  };

  readonly formalPort: FormalActionSubmissionPort = {
    submit: (command) => this.formalService.submit(command),
  };

  readonly beatPort: DecisionBeatResolutionPort = {
    resolve: async (input) => {
      assert.equal(input.actionIds.length, 1, "test W5 adapter is the single-seat implementation");
      const before = await this.projectionPort.load({
        runId: input.routeSnapshot.runId,
        chapterRuntimeId: input.chapterRuntimeId,
      });
      const accepted = before.acceptedActions.get(input.actionIds[0]!)!;
      const result = await this.beatService.apply({
        routeSnapshot: input.routeSnapshot,
        chapterRuntimeId: input.chapterRuntimeId,
        chapterDefinition: input.chapterDefinition,
        actionId: input.actionIds[0]!,
        actionInputFingerprint: accepted.inputFingerprint,
        resolverVersion: input.resolverVersion,
      });
      return {
        status: result.status,
        resolution: result.resolution,
        projection: await this.projectionPort.load({
          runId: input.routeSnapshot.runId,
          chapterRuntimeId: input.chapterRuntimeId,
        }),
      };
    },
  };

  readonly defaultPort: DeterministicDefaultActionPort = {
    submit: async (input) => {
      const projection = await this.projectionPort.load({
        runId: input.routeSnapshot.runId,
        chapterRuntimeId: input.chapterRuntimeId,
      });
      const payload = { ...input.policy.payload };
      const body = {
        schemaVersion: "sangtian_decision_action_v1" as const,
        actionId: `default_${sha256Canonical({ key: input.idempotencyKey }).slice(0, 24)}`,
        runId: input.routeSnapshot.runId,
        chapterRuntimeId: input.chapterRuntimeId,
        chapterId: input.chapterId,
        decisionPointId: input.decisionPointId,
        seatId: input.seatId,
        actionOrdinal: 1,
        actionRevision: 1,
        controlEpoch: 1,
        expectedWorkingRevision: input.expectedWorkingRevision,
        status: "SEALED" as const,
        actionType: input.policy.actionType,
        payload,
        payloadHash: sha256Canonical(payload),
        idempotencyKey: input.idempotencyKey,
      };
      const withRequest = {
        ...body,
        requestFingerprint: computeDecisionActionRequestFingerprint(body),
      };
      const action: DecisionActionV1 = {
        ...withRequest,
        sealedHash: sha256Canonical(withRequest),
      };
      const intent = emptyIntent();
      const formalBase = { routeSnapshot: input.routeSnapshot, action, intent };
      const accepted = await this.formalService.submit({
        ...formalBase,
        subjectId: "deterministic-default",
        inputFingerprint: computeFormalInteractionInputFingerprint(formalBase),
      });
      assert.equal(projection.state.revision, input.expectedWorkingRevision);
      return {
        status: accepted.status === "ACCEPTED" ? "ACCEPTED" as const : "REPLAYED" as const,
        actionId: action.actionId,
      };
    },
  };
}

class AllRequiredClosed implements DecisionCloseEvaluatorPort {
  calls = 0;
  async isClosed(input: Parameters<DecisionCloseEvaluatorPort["isClosed"]>[0]) {
    this.calls += 1;
    return input.active.seats
      .filter((seat) => seat.requirement === "REQUIRED")
      .every((seat) => seat.completion !== "PENDING");
  }
}

class IdempotentSettlement implements ChapterSettlementPort {
  calls = 0;
  commitCount = 0;
  readonly inputs: Parameters<ChapterSettlementPort["settle"]>[0][] = [];
  private readonly settled = new Map<string, Promise<FrozenChapterBundleV1>>();

  async settle(input: Parameters<ChapterSettlementPort["settle"]>[0]) {
    this.calls += 1;
    this.inputs.push(structuredClone(input));
    let result = this.settled.get(input.settlementInput.inputHash);
    if (!result) {
      this.commitCount += 1;
      result = Promise.resolve().then(() => frozenBundle(input));
      this.settled.set(input.settlementInput.inputHash, result);
    }
    return {
      status: this.calls === this.commitCount ? "SETTLED" as const : "REPLAYED" as const,
      frozenBundle: structuredClone(await result),
    };
  }
}

class IdempotentFinale implements FinaleRequestPort {
  calls = 0;
  requests = new Set<string>();
  async request(input: Parameters<FinaleRequestPort["request"]>[0]) {
    this.calls += 1;
    const prior = this.requests.has(input.idempotencyKey);
    this.requests.add(input.idempotencyKey);
    return { status: prior ? "REPLAYED" as const : "REQUESTED" as const };
  }
}

function environment(counts: Record<ChapterIdV1, number> = POINT_COUNTS) {
  const content = new AuthoredContent(counts);
  const w5 = new W5Harness(content);
  const states = new MemoryOrchestratorStates();
  const close = new AllRequiredClosed();
  const settlement = new IdempotentSettlement();
  const finale = new IdempotentFinale();
  const seed = new WorkingSeed();
  const create = (
    beat: DecisionBeatResolutionPort = w5.beatPort,
    formal: FormalActionSubmissionPort = w5.formalPort,
  ) => new PressureChapterOrchestratorService(
    states,
    content,
    seed,
    w5.openingPort,
    w5.projectionPort,
    formal,
    beat,
    close,
    w5.defaultPort,
    settlement,
    finale,
  );
  return { content, w5, states, close, settlement, finale, seed, create };
}

test("orchestrator runs N1-N7 with content-authored 1/4/7/dynamic point counts and no N8", async () => {
  const env = environment();
  const service = env.create();
  const routeSnapshot = route();
  let nowMs = 1_000;
  let state = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs,
  });
  const processed: Record<ChapterIdV1, number> = Object.fromEntries(
    CHAPTER_IDS_V1.map((chapterId) => [chapterId, 0]),
  ) as Record<ChapterIdV1, number>;

  while (state.phase !== "FINALE_REQUESTED") {
    assert.equal(state.phase, "ACTIVE");
    const chapterId = state.currentChapterId;
    const active = state.activeDecision!;
    if (chapterId === "N2" && processed[chapterId] === 0) {
      assert.ok(active.deadlineAtMs !== null);
      state = await service.advanceDeadline(routeSnapshot, active.deadlineAtMs!);
    } else if (chapterId === "N3" && processed[chapterId] === 0) {
      state = await service.applyAiFailure(routeSnapshot, ACTOR, nowMs += 1);
    } else {
      const command = await humanAction(env, routeSnapshot, state, processed[chapterId]);
      state = await service.submitAction({ ...command, nowMs: nowMs += 1 });
    }
    processed[chapterId] += 1;
  }

  assert.deepEqual(processed, POINT_COUNTS);
  assert.equal(state.currentChapterId, "N7");
  assert.equal(state.authorityBase.baseWorldSequence, 7);
  assert.equal(env.settlement.commitCount, 7);
  assert.equal(env.settlement.inputs.length, 7);
  assert.equal(env.seed.loadCalls, 1, "only N1 start reads frozen authority from persistence");
  assert.equal(env.seed.authorityCalls, 6, "N2-N7 reuse each just-committed frozen bundle");
  assert.equal(env.finale.requests.size, 1);
  assert.equal(env.content.loads.includes("N7"), true);
  assert.equal((env.content.loads as string[]).includes("N8"), false);
  for (const [index, settlement] of env.settlement.inputs.entries()) {
    assert.equal(settlement.settlementInput.baseWorldSequence, index);
    assert.equal(settlement.settlementInput.chapterId, CHAPTER_IDS_V1[index]);
  }
  assert.ok(env.settlement.inputs[1]!.settlementInput.sealedDecisionActionIds.some((id) => id.startsWith("default_")));
  assert.ok(env.settlement.inputs[2]!.settlementInput.sealedDecisionActionIds.some((id) => id.startsWith("default_")));
});

test("chapter participation is MIXED_ACTIONS when one seat acts and later defaults", async () => {
  const env = environment({ ...POINT_COUNTS, N1: 2 });
  const routeSnapshot = route();
  const service = env.create();
  let state = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 1,
  });
  const n1RuntimeId = state.chapterRuntimeId;

  const command = await humanAction(env, routeSnapshot, state, 0);
  state = await service.submitAction({ ...command, nowMs: 2 });
  assert.equal(state.currentChapterId, "N1");
  assert.equal(state.activeDecision?.decisionPointId, "n1-point-2");

  state = await service.applyAiFailure(routeSnapshot, ACTOR, 3);
  assert.equal(state.currentChapterId, "N2");
  const participation = env.settlement.inputs[0]!.seatParticipation
    .find((seat) => seat.seatId === ACTOR);
  assert.deepEqual(participation, {
    seatId: ACTOR,
    requirement: "REQUIRED",
    completion: "MIXED_ACTIONS",
    defaultCodes: ["n1-point-2-ai-failure"],
  });
  const projection = await env.w5.projectionPort.load({
    runId: routeSnapshot.runId,
    chapterRuntimeId: n1RuntimeId,
  });
  assert.equal(projection.acceptedActions.size, 2);
  assert.equal([...projection.acceptedActions.keys()].filter((id) => id.startsWith("default_")).length, 1);
  assert.equal([...projection.acceptedActions.keys()].filter((id) => id.startsWith("action_")).length, 1);
});

test("chapter participation is DEFAULTED for multiple decision-point defaults", async () => {
  const env = environment({ ...POINT_COUNTS, N1: 2 });
  const routeSnapshot = route();
  const service = env.create();
  let state = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 10,
  });

  state = await service.applyAiFailure(routeSnapshot, ACTOR, 11);
  assert.equal(state.currentChapterId, "N1");
  assert.equal(state.activeDecision?.decisionPointId, "n1-point-2");
  state = await service.applyAiFailure(routeSnapshot, ACTOR, 12);
  assert.equal(state.currentChapterId, "N2");

  const participation = env.settlement.inputs[0]!.seatParticipation
    .find((seat) => seat.seatId === ACTOR);
  assert.deepEqual(participation, {
    seatId: ACTOR,
    requirement: "REQUIRED",
    completion: "DEFAULTED",
    defaultCodes: [
      "n1-point-1-ai-failure",
      "n1-point-2-ai-failure",
    ],
  });
  assert.equal(
    env.settlement.inputs[0]!.settlementInput.sealedDecisionActionIds
      .filter((id) => id.startsWith("default_")).length,
    2,
  );
});

test("chapter participation is SEALED_ACTIONS when no decision point defaulted", async () => {
  const env = environment({ ...POINT_COUNTS, N1: 2 });
  const routeSnapshot = route();
  const service = env.create();
  let state = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 20,
  });

  let command = await humanAction(env, routeSnapshot, state, 0);
  state = await service.submitAction({ ...command, nowMs: 21 });
  command = await humanAction(env, routeSnapshot, state, 1);
  state = await service.submitAction({ ...command, nowMs: 22 });
  assert.equal(state.currentChapterId, "N2");

  const participation = env.settlement.inputs[0]!.seatParticipation
    .find((seat) => seat.seatId === ACTOR);
  assert.deepEqual(participation, {
    seatId: ACTOR,
    requirement: "REQUIRED",
    completion: "SEALED_ACTIONS",
    defaultCodes: [],
  });
  assert.equal(
    env.settlement.inputs[0]!.settlementInput.sealedDecisionActionIds
      .filter((id) => id.startsWith("default_")).length,
    0,
  );
});

test("mid-chapter crash resumes from pinned RESOLVING_BEAT revision and rejects the expired old action", async () => {
  const env = environment({ ...POINT_COUNTS, N1: 2 });
  let crashOnce = true;
  const flaky: DecisionBeatResolutionPort = {
    resolve: async (input) => {
      if (crashOnce) {
        crashOnce = false;
        throw new Error("SIMULATED_PROCESS_CRASH");
      }
      return env.w5.beatPort.resolve(input);
    },
  };
  const routeSnapshot = route();
  const service = env.create(flaky);
  const initial = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 10,
  });
  const stale = await humanAction(env, routeSnapshot, initial, 0);
  await assert.rejects(() => service.submitAction({ ...stale, nowMs: 11 }), /SIMULATED_PROCESS_CRASH/);
  const stuck = await env.states.read(routeSnapshot.runId);
  assert.equal(stuck?.phase, "RESOLVING_BEAT");

  const recovered = await env.create().resume(routeSnapshot, 12);
  assert.equal(recovered.phase, "ACTIVE");
  assert.equal(recovered.currentChapterId, "N1");
  assert.notEqual(recovered.activeDecision?.decisionPointId, stale.action.decisionPointId);
  assert.equal(recovered.authorityBase.baseWorldSequence, 0, "Beat must not advance worldSequence");
  await assert.rejects(
    () => env.create().submitAction({ ...stale, nowMs: 13 }),
    (error: unknown) => error instanceof ChapterOrchestratorError
      && error.code === "CHAPTER_ORCHESTRATOR_STALE_ACTION",
  );
});

test("ACTIVE recovery reconciles a W5-sealed action after a crash before orchestrator CAS", async () => {
  const env = environment({ ...POINT_COUNTS, N1: 2 });
  let crashOnce = true;
  const crashAfterSeal: FormalActionSubmissionPort = {
    submit: async (command) => {
      const accepted = await env.w5.formalPort.submit(command);
      if (crashOnce) {
        crashOnce = false;
        throw new Error("SIMULATED_CRASH_AFTER_W5_SEAL");
      }
      return accepted;
    },
  };
  const routeSnapshot = route();
  const service = env.create(undefined, crashAfterSeal);
  const initial = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 14,
  });
  const command = await humanAction(env, routeSnapshot, initial, 0);
  await assert.rejects(
    () => service.submitAction({ ...command, nowMs: 15 }),
    /SIMULATED_CRASH_AFTER_W5_SEAL/,
  );
  const beforeResume = await env.states.read(routeSnapshot.runId);
  assert.equal(beforeResume?.phase, "ACTIVE");
  assert.equal(beforeResume?.activeDecision?.seats.find((seat) => seat.seatId === ACTOR)?.actionCount, 0);

  const recovered = await env.create().resume(routeSnapshot, 16);
  assert.equal(recovered.phase, "ACTIVE");
  assert.notEqual(recovered.activeDecision?.decisionPointId, initial.activeDecision?.decisionPointId);
  assert.equal(recovered.authorityBase.baseWorldSequence, 0);
  assert.equal(env.states.compareAndSwapCalls, 3, "recovery folds W5 reconciliation and Beat claim into one CAS");
});

test("REQUIRED seats block together while NOT_REQUIRED seats never block a multi-seat point", async () => {
  const counts = Object.fromEntries(CHAPTER_IDS_V1.map((chapterId) => [chapterId, 1])) as Record<ChapterIdV1, number>;
  const env = environment(counts);
  const descriptor = structuredClone(env.content.descriptors.get("N1")!);
  const decision = descriptor.decisions[0]!;
  decision.execution.mode = "TARGETED_INTERACTION";
  decision.execution.requiredSeatIds = [ACTOR, "jiangnan_merchant"];
  decision.execution.perSeatActionBudget = { [ACTOR]: 1, jiangnan_merchant: 1 };
  decision.seatRequirements.jiangnan_merchant = "REQUIRED";
  const { descriptorHash: _oldHash, ...descriptorBody } = descriptor;
  descriptor.descriptorHash = sha256Canonical(descriptorBody);
  env.content.descriptors.set("N1", descriptor);

  const multiSeatBeat: DecisionBeatResolutionPort = {
    resolve: async (input) => {
      const single = await env.w5.beatPort.resolve({ ...input, actionIds: [input.actionIds[0]!] });
      const projection = await env.w5.projectionPort.load({
        runId: input.routeSnapshot.runId,
        chapterRuntimeId: input.chapterRuntimeId,
      });
      const actions = input.actionIds.map((actionId) => projection.acceptedActions.get(actionId)!.action);
      const { resolutionHash: _hash, ...singleBody } = single.resolution;
      const body = {
        ...singleBody,
        sealedActionIds: [...input.actionIds].sort(),
        sealedActionsHash: computeSealedActionsHash(actions),
      };
      return {
        status: single.status,
        resolution: { ...body, resolutionHash: sha256Canonical(body) },
        projection,
      };
    },
  };
  const routeSnapshot = route();
  const service = env.create(multiSeatBeat);
  let state = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 20,
  });
  const actorAction = await humanAction(env, routeSnapshot, state, 0, ACTOR);
  state = await service.submitAction({ ...actorAction, nowMs: 21 });
  assert.equal(state.currentChapterId, "N1");
  assert.equal(state.phase, "ACTIVE");
  assert.equal(env.settlement.commitCount, 0);

  const targetAction = await humanAction(env, routeSnapshot, state, 0, "jiangnan_merchant");
  state = await service.submitAction({ ...targetAction, nowMs: 22 });
  assert.equal(state.currentChapterId, "N2");
  assert.equal(env.settlement.commitCount, 1);
  const participation = env.settlement.inputs[0]!.seatParticipation;
  assert.equal(participation.find((seat) => seat.seatId === ACTOR)?.requirement, "REQUIRED");
  assert.equal(participation.find((seat) => seat.seatId === "jiangnan_merchant")?.requirement, "REQUIRED");
  assert.equal(participation.find((seat) => seat.seatId === "qingliu_law")?.completion, "NOT_REQUIRED");
});

test("concurrent close replays one authoritative ChapterSettlement and one Finale request", async () => {
  const counts = Object.fromEntries(CHAPTER_IDS_V1.map((chapterId) => [chapterId, 1])) as Record<ChapterIdV1, number>;
  const env = environment(counts);
  const routeSnapshot = route();
  const service = env.create();
  let state = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 100,
  });
  const command = await humanAction(env, routeSnapshot, state, 0);
  const [left, right] = await Promise.all([
    service.submitAction({ ...command, nowMs: 101 }),
    service.submitAction({ ...command, nowMs: 101 }),
  ]);
  state = left.revision > right.revision ? left : right;
  assert.equal(env.settlement.commitCount, 1);
  assert.equal(state.currentChapterId, "N2");

  while (state.phase !== "FINALE_REQUESTED") {
    if (state.activeDecision?.deadlineAtMs !== null) {
      state = await service.advanceDeadline(routeSnapshot, state.activeDecision!.deadlineAtMs!);
    } else {
      const next = await humanAction(env, routeSnapshot, state, 0);
      state = await service.submitAction({ ...next, nowMs: state.revision + 200 });
    }
  }
  await Promise.all([service.resume(routeSnapshot, 999), service.resume(routeSnapshot, 999)]);
  assert.equal(env.settlement.commitCount, 7);
  assert.equal(env.finale.requests.size, 1);
});

test("undefined OPTIONAL participation and forbidden module dependencies fail closed", async () => {
  const env = environment();
  const bad = structuredClone(env.content.descriptors.get("N1")!);
  const decision = bad.decisions[0]!;
  (decision.seatRequirements as unknown as Record<string, string>)[ACTOR] = "OPTIONAL";
  const { descriptorHash: _hash, ...body } = bad;
  bad.descriptorHash = sha256Canonical(body);
  env.content.descriptors.set("N1", bad);
  await assert.rejects(
    () => env.create().start({
      routeSnapshot: route(),
      genesisWorldStateHash: digest("genesis-world"),
      genesisHash: digest("genesis"),
      nowMs: 0,
    }),
    (error: unknown) => error instanceof ChapterOrchestratorError
      && error.code === "CHAPTER_ORCHESTRATOR_OPTIONAL_UNDEFINED",
  );

  const source = readFileSync(join(__dirname, "chapter-orchestrator.service.ts"), "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  assert.equal(imports.some((specifier) => (
    specifier.includes("prisma")
    || specifier.includes("openovel")
    || specifier.includes("narrative")
    || specifier.includes("terminal-commit")
    || specifier.includes("/finale/")
  )), false);
});

test("expired actions are rejected and FAIL_CLOSED deadlines never invent a default", async () => {
  const env = environment();
  const descriptor = structuredClone(env.content.descriptors.get("N1")!);
  descriptor.decisions[0]!.execution.deadlinePolicy = {
    durationMs: 1,
    clock: "SERVER_MONOTONIC",
    expiryAction: "FAIL_CLOSED",
  };
  const { descriptorHash: _oldHash, ...body } = descriptor;
  descriptor.descriptorHash = sha256Canonical(body);
  env.content.descriptors.set("N1", descriptor);
  const routeSnapshot = route();
  const service = env.create();
  const state = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 0,
  });
  const command = await humanAction(env, routeSnapshot, state, 0);
  await assert.rejects(
    () => service.submitAction({ ...command, nowMs: 1 }),
    (error: unknown) => error instanceof ChapterOrchestratorError
      && error.code === "CHAPTER_ORCHESTRATOR_ACTION_EXPIRED",
  );
  await assert.rejects(
    () => service.advanceDeadline(routeSnapshot, 1),
    (error: unknown) => error instanceof ChapterOrchestratorError
      && error.code === "CHAPTER_ORCHESTRATOR_DEADLINE_FAIL_CLOSED",
  );
  const unchanged = await env.states.read(routeSnapshot.runId);
  assert.equal(unchanged?.activeDecision?.seats.find((seat) => seat.seatId === ACTOR)?.actionCount, 0);
  const projection = await env.w5.projectionPort.load({
    runId: routeSnapshot.runId,
    chapterRuntimeId: state.chapterRuntimeId,
  });
  assert.equal(projection.acceptedActions.size, 0);
});

test("committed settlement authority skips the duplicate N1 state, content and projection reads", async () => {
  const env = environment();
  const service = env.create();
  const routeSnapshot = route();
  const active = await service.start({
    routeSnapshot,
    genesisWorldStateHash: digest("genesis-world"),
    genesisHash: digest("genesis"),
    nowMs: 0,
  });
  const command = await humanAction(env, routeSnapshot, active, 0);
  await env.w5.formalPort.submit(command);
  const descriptor = structuredClone(env.content.descriptors.get("N1")!);
  const decision = descriptor.decisions.find(
    (candidate) => candidate.decisionPointId === active.activeDecision!.decisionPointId,
  )!;
  const resolving = planRecordedActionsV1(active, [{
    seatId: command.action.seatId,
    actionId: command.action.actionId,
    defaultCode: null,
    actionBudget: decision.execution.perSeatActionBudget[command.action.seatId]!,
  }], true);
  assert.equal((await env.states.compareAndSwap({
    runId: active.runId,
    expectedRevision: active.revision,
    next: resolving,
  })).status, "COMMITTED");
  const beat = await env.w5.beatPort.resolve({
    routeSnapshot,
    chapterRuntimeId: resolving.chapterRuntimeId,
    chapterDefinition: descriptor.definition,
    actionIds: [command.action.actionId],
    resolverVersion: "pressure_orchestrated_beat_v1",
  });
  const progression = planBeatProgressionV1({
    state: resolving,
    descriptor,
    projection: beat.projection,
    resolution: beat.resolution,
    nowMs: 1,
  });
  assert.ok(progression.settlementInput);
  assert.equal((await env.states.compareAndSwap({
    runId: resolving.runId,
    expectedRevision: resolving.revision,
    next: progression.nextState,
  })).status, "COMMITTED");
  const n1LoadsBefore = env.content.loads.filter((chapterId) => chapterId === "N1").length;
  const projectionLoadsBefore = env.w5.projectionLoads;

  await assert.rejects(
    () => service.resumeFromCommittedSettlementAuthority(routeSnapshot, {
      state: progression.nextState,
      chapterDescriptor: descriptor,
      workingProjection: { ...beat.projection, routeHash: digest("wrong-route") },
      settlementInput: progression.settlementInput!,
    }, 2),
    (error: unknown) => error instanceof ChapterOrchestratorError
      && error.code === "CHAPTER_ORCHESTRATOR_STATE_CORRUPT",
  );
  assert.equal(env.settlement.commitCount, 0, "mismatched request authority fails before W6");

  const resumed = await service.resumeFromCommittedSettlementAuthority(routeSnapshot, {
    state: progression.nextState,
    chapterDescriptor: descriptor,
    workingProjection: beat.projection,
    settlementInput: progression.settlementInput,
  }, 2);

  assert.equal(resumed.phase, "ACTIVE");
  assert.equal(resumed.currentChapterId, "N2");
  assert.equal(env.content.loads.filter((chapterId) => chapterId === "N1").length, n1LoadsBefore);
  assert.equal(env.w5.projectionLoads, projectionLoadsBefore);
  assert.equal(env.settlement.commitCount, 1);
});

async function humanAction(
  env: ReturnType<typeof environment>,
  routeSnapshot: RunRouteSnapshotV1,
  state: ChapterOrchestratorStateV1,
  ordinal: number,
  seatId: SeatIdV1 = ACTOR,
) {
  const projection = await env.w5.projectionPort.load({
    runId: state.runId,
    chapterRuntimeId: state.chapterRuntimeId,
  });
  const pointId = state.activeDecision!.decisionPointId;
  const descriptor = env.content.descriptors.get(state.currentChapterId)!;
  const optionId = descriptor.definition.decisionPoints
    .find((point) => point.decisionPointId === pointId)!.options[0]!.optionId;
  const payload = { optionId };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action_${state.currentChapterId}_${pointId}_${seatId}_${ordinal}`,
    runId: state.runId,
    chapterRuntimeId: state.chapterRuntimeId,
    chapterId: state.currentChapterId,
    decisionPointId: pointId,
    seatId,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: projection.state.revision,
    status: "SEALED" as const,
    actionType: "DECIDE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: `idem_${state.currentChapterId}_${pointId}_${seatId}_${ordinal}`,
  };
  const withRequest = { ...body, requestFingerprint: computeDecisionActionRequestFingerprint(body) };
  const action: DecisionActionV1 = { ...withRequest, sealedHash: sha256Canonical(withRequest) };
  const intent = emptyIntent();
  const formalBase = { routeSnapshot, action, intent };
  return {
    routeSnapshot,
    subjectId: "human-player",
    action,
    intent,
    inputFingerprint: computeFormalInteractionInputFingerprint(formalBase),
  };
}

function authoredChapter(chapterId: ChapterIdV1, count: number): AuthoredChapterRuntimeV1 {
  const points: PressureChapterDefinition["decisionPoints"] = [];
  const decisions: AuthoredChapterRuntimeV1["decisions"] = [];
  for (let index = 0; index < count; index += 1) {
    const decisionPointId = `${chapterId.toLowerCase()}-point-${index + 1}`;
    const optionId = `${decisionPointId}-option`;
    const requirementId = `${decisionPointId}-complete`;
    points.push({
      decisionPointId,
      kernelId: `${decisionPointId}-kernel`,
      chapterId,
      sourceOrder: index + 1,
      prompt: `Decision ${index + 1}`,
      requirementIds: [requirementId],
      ...(index > 0
        ? { activation: { allSatisfiedRequirementIds: [`${chapterId.toLowerCase()}-point-${index}-complete`] } }
        : {}),
      priority: { duePressureCount: count - index },
      options: [{
        optionId,
        sourceOrder: 1,
        label: "Proceed",
        workingDelta: {
          setFacts: { [`fact.${decisionPointId}`]: true },
          satisfyRequirementIds: [requirementId],
        },
      }],
    });
    const absence = defaultPolicy(`${decisionPointId}-absence`, optionId);
    const aiFailure = defaultPolicy(`${decisionPointId}-ai-failure`, optionId);
    const requiredSeats = [ACTOR];
    decisions.push({
      decisionPointId,
      execution: {
        decisionPointKey: decisionPointId,
        chapterId,
        ordinal: index + 1,
        mode: "SOLO_BEAT",
        purpose: `Resolve ${decisionPointId}`,
        requiredSeatIds: requiredSeats,
        allowedActionTypes: ["DECIDE", "DEFAULT"],
        perSeatActionBudget: { [ACTOR]: 1 },
        closeCondition: { op: "COMPARE", factRef: "seat.ready", comparator: "EQ", value: true },
        deadlinePolicy: chapterId === "N2" && index === 0
          ? { durationMs: 10, clock: "SERVER_MONOTONIC", expiryAction: "APPLY_DEFAULT" }
          : null,
        absenceDefaultPolicy: absence,
        aiFailureDefaultPolicy: aiFailure,
        beatResolutionPolicy: "pressure-working-beat-v1",
        allowedWorkingDeltaTypes: ["FACT"],
        feedbackVisibilityPolicy: "AUDIENCE_PROJECTED",
        reactionPolicy: { enabled: false, eligibleSeatIds: [], trigger: null, maxDepth: 0 },
      },
      seatRequirements: Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
        seatId,
        seatId === ACTOR ? "REQUIRED" : "NOT_REQUIRED",
      ])) as AuthoredChapterRuntimeV1["decisions"][number]["seatRequirements"],
    });
  }
  const definition: PressureChapterDefinition = {
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId,
    sequence: CHAPTER_IDS_V1.indexOf(chapterId) + 1,
    decisionPoints: points,
    requirementDependencies: [],
  };
  const body = {
    schemaVersion: "pressure_authored_chapter_runtime_v1" as const,
    chapterId,
    definition,
    decisions,
    chapterClosePolicy: {
      kind: "ALL_AUTHORED_DECISION_POINTS_COMPLETED" as const,
      decisionPointIds: points.map((point) => point.decisionPointId),
    },
    contentPolicyVersion: `sangtian-${chapterId.toLowerCase()}-policy-v1`,
    contentPolicyHash: digest(`content-policy-${chapterId}`),
    settlementContractVersion: "sangtian-settlement-v1",
    settlementContractHash: digest("settlement-contract"),
  };
  return { ...body, descriptorHash: sha256Canonical(body) };
}

function defaultPolicy(policyRef: string, optionId: string) {
  const body = { policyRef, actionType: "DEFAULT", payload: { optionId } };
  return { ...body, policyHash: sha256Canonical(body) };
}

function emptyIntent(): WorkingActionIntentV1 {
  return {
    visibility: "PRIVATE",
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
}

function route(): RunRouteSnapshotV1 {
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: "run-orchestrator-v1",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: "sangtian-content-v1",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "sangtian-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-tests-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "seed-orchestrator",
    narrativeProfileVersion: "openovel-pressure-v1",
    featureSetVersion: "pressure-feature-v1",
    resultContractRegistryVersion: "pressure-result-registry-v1",
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [ACTOR],
    controlTopologyVersion: "pressure-control-v1",
    initialRoleControlSnapshotHash: digest("control"),
  });
}

function frozenBundle(input: Parameters<ChapterSettlementPort["settle"]>[0]): FrozenChapterBundleV1 {
  const settlement = input.settlementInput;
  const sequence = settlement.baseWorldSequence + 1;
  const world = worldState(settlement.runId, sequence);
  const carryBody = {
    nextChapterId: nextChapterId(settlement.chapterId),
    unlockedContentRefs: [],
    unresolvedCommitmentRefs: [],
    pendingConsequenceRefs: [],
  };
  const carryForward = { ...carryBody, carryForwardHash: sha256Canonical(carryBody) };
  const body = {
    schemaVersion: "sangtian_frozen_chapter_bundle_v1" as const,
    runId: settlement.runId,
    chapterId: settlement.chapterId,
    chapterSequence: sequence as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    baseWorldSequence: settlement.baseWorldSequence,
    committedWorldSequence: sequence,
    previousFrozenHash: settlement.previousFrozenHash,
    decisionLedgerHash: settlement.decisionLedgerHash,
    finalWorkingStateHash: settlement.finalWorkingStateHash,
    settlementPolicyVersion: settlement.contentPolicyVersion,
    worldDelta: { factMutations: [], resourceMutations: [] },
    committedWorldStateHash: world.stateHash,
    frozenWorldState: world,
    causalEdges: [],
    carryForward,
  };
  return { ...body, bundleHash: sha256Canonical(body) };
}

function worldState(runId: string, sequence: number): WorldStateV1 {
  const tracksBody = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(TRACK_IDS_V1.map((trackId) => [trackId, sequence])) as Record<TrackIdV1, number>,
  };
  const tracks = { ...tracksBody, stateHash: sha256Canonical(tracksBody) };
  const knowledgeBySeat = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<WorldStateV1["knowledgeBySeat"]>((all, seatId) => {
    const body = { seatId, knownFactRefs: [], secretRefs: [], disclosedToSeatIds: [] as SeatIdV1[] };
    all[seatId] = { ...body, stateHash: sha256Canonical(body) };
    return all;
  }, {} as WorldStateV1["knowledgeBySeat"]);
  const seatArcs = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<WorldStateV1["seatArcs"]>((all, seatId) => {
    const body = {
      seatId,
      arcStage: `stage-${sequence}`,
      publicGoalProgress: sequence,
      privateGoalProgress: sequence,
      gainRefs: [],
      lossRefs: [],
      costRefs: [],
    };
    all[seatId] = { ...body, stateHash: sha256Canonical(body) };
    return all;
  }, {} as WorldStateV1["seatArcs"]);
  const body = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: sequence,
    factValues: { [`run.${runId}.sequence`]: sequence },
    resources: { grain: Math.max(0, 10 - sequence) },
    tracks,
    objects: [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  return { ...body, stateHash: sha256Canonical(body) };
}

function digest(label: string): string {
  return sha256Canonical({ label });
}

function keyOf(key: WorkingLedgerKeyV1): string {
  return `${key.runId}:${key.chapterRuntimeId}`;
}
