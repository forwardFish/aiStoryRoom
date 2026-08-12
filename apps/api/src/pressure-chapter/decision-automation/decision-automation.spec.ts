import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  withRunRouteHash,
  type ParticipantModeV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import { SangtianAuthoredChapterContentAdapterV1 } from "../integration/content.adapters";
import { EmptyServerDecisionWorkingIntentCompilerV1 } from "../integration/decision-command.compiler";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
  SubmitOrchestratedActionCommandV1,
} from "../orchestrator/contracts";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
} from "../seat-control/types";
import type {
  AcceptedFormalActionV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import { workingStateHash } from "../working-ledger/working-ledger";
import {
  PressureAiDecisionCommandCompilerV1,
  buildDecisionAutomationIdempotencyKeyV1,
} from "./compiler";
import {
  PrismaActivePressureDecisionScannerV1,
  type DecisionAutomationScannerPrismaClientV1,
} from "./prisma-scanner";
import type {
  ActivePressureDecisionScannerPortV1,
  AiDecisionPolicyInputV1,
  AiDecisionPolicySelectionV1,
  DecisionAutomationTaskV1,
} from "./contracts";
import {
  PressureDecisionAutomationServiceV1,
  buildAiDecisionPolicyInputV1,
  withAiDecisionPolicySelectionHashV1,
  withDecisionAutomationTaskHashV1,
} from "./service";
import { PressureDecisionAutomationWorkerLaneV1 } from "./worker-lane";
import { PublishedSangtianAiDecisionPolicyAdapterV1 } from "./content-policy.adapter";
import { createPressureDecisionAutomationProductionV1 } from "./factory";

const NOW = 1_900_000_000_000;
const loaded = loadSangtianPressureChapterPackageV1();

test("Solo executes exactly the five AI_ACTIVE seats and never the human seat", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  const drained = await harness.service.drain("worker-solo", 8);

  assert.equal(drained.stoppedBecause, "IDLE");
  assert.equal(harness.runtime.uniqueSubmissions.size, 5);
  assert.deepEqual(
    [...harness.runtime.uniqueSubmissions.values()]
      .map((command) => command.action.seatId)
      .sort(),
    PRESSURE_CHAPTER_SEAT_IDS_V1.slice(1).sort(),
  );
  assert.ok(
    [...harness.runtime.uniqueSubmissions.values()].every(
      (command) => command.action.actionType !== "DEFAULT_PASS",
    ),
  );
  assertNoForbiddenDecisionCapabilityAccess(harness);
});

test("Multiplayer fills only the four AI seats and preserves both humans", async () => {
  const harness = await Harness.create("MULTIPLAYER", [
    "cabinet_finance",
    "qingliu_law",
  ]);
  await harness.service.drain("worker-mp", 8);

  assert.deepEqual(
    [...harness.runtime.uniqueSubmissions.values()]
      .map((command) => command.action.seatId)
      .sort(),
    [
      "jiangnan_merchant",
      "sili_weaving",
      "zhejiang_administration",
      "zhejiang_governor",
    ].sort(),
  );
  assertNoForbiddenDecisionCapabilityAccess(harness);
});

test("Multiplayer 2-6 human occupancy always fills exactly the unclaimed seats without a model capability", async () => {
  for (let humanCount = 2; humanCount <= 6; humanCount += 1) {
    const humanSeatIds = PRESSURE_CHAPTER_SEAT_IDS_V1.slice(0, humanCount);
    const harness = await Harness.create("MULTIPLAYER", humanSeatIds);

    await harness.service.drain(`worker-mp-${humanCount}`, 8);

    assert.deepEqual(
      [...harness.runtime.uniqueSubmissions.values()]
        .map((command) => command.action.seatId)
        .sort(),
      PRESSURE_CHAPTER_SEAT_IDS_V1
        .filter((seatId) => !humanSeatIds.includes(seatId))
        .sort(),
    );
    assertNoForbiddenDecisionCapabilityAccess(harness);
  }
});

test("new active decisions are scanned independently instead of reusing an old action", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  await harness.service.tick("worker-multi-decision");
  const first = [...harness.runtime.uniqueSubmissions.values()][0]!;

  await harness.activate("N2", "N2.memorial_draft");
  await harness.service.tick("worker-multi-decision");
  const commands = [...harness.runtime.uniqueSubmissions.values()];

  assert.equal(commands.length, 2);
  assert.notEqual(commands[1]!.action.idempotencyKey, first.action.idempotencyKey);
  assert.equal(commands[1]!.action.decisionPointId, "N2.memorial_draft");
});

test("concurrent duplicate claims converge on one deterministic formal action", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  harness.scanner.allowDuplicateConcurrentScan = true;
  harness.runtime.delayMs = 15;

  const [left, right] = await Promise.all([
    harness.service.tick("worker-a"),
    harness.service.tick("worker-b"),
  ]);

  assert.equal(left.kind, "ACKNOWLEDGED");
  assert.equal(right.kind, "ACKNOWLEDGED");
  assert.equal(harness.runtime.uniqueSubmissions.size, 1);
  assert.equal(harness.runtime.submitInvocations, 2);
  assert.equal(harness.state.revision, 1);
  assert.equal(
    [...harness.runtime.uniqueSubmissions.values()][0]!.action.seatId,
    "jiangnan_merchant",
  );
  assertNoForbiddenDecisionCapabilityAccess(harness);
});

test("crash after W5 append replays through runtime.resume without a second action", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  harness.runtime.crashAfterAcceptOnce = true;

  const failed = await harness.service.tick("worker-crash");
  const replayed = await harness.service.tick("worker-crash");

  assert.equal(failed.kind, "RETRY_SCHEDULED");
  assert.equal(replayed.kind, "ACKNOWLEDGED");
  if (replayed.kind === "ACKNOWLEDGED") {
    assert.equal(replayed.outcome, "ACTION_RECONCILED");
  }
  assert.equal(harness.runtime.uniqueSubmissions.size, 1);
  assert.equal(harness.runtime.resumeCalls, 1);
  assertNoForbiddenDecisionCapabilityAccess(harness);
});

test("stale orchestrator revision and stale control epoch are acknowledged without action", async () => {
  const revision = await Harness.create("SOLO", ["cabinet_finance"]);
  revision.scanner.taskTransform = (task) => rehashTask({
    ...task,
    expectedOrchestratorRevision: task.expectedOrchestratorRevision + 1,
  });
  const staleRevision = await revision.service.tick("worker-stale-revision");

  const epoch = await Harness.create("SOLO", ["cabinet_finance"]);
  epoch.scanner.taskTransform = (task) => rehashTask({
    ...task,
    expectedControlEpoch: task.expectedControlEpoch + 1,
  });
  const staleEpoch = await epoch.service.tick("worker-stale-epoch");

  assert.deepEqual(
    [staleRevision, staleEpoch].map((result) =>
      result.kind === "ACKNOWLEDGED" ? result.outcome : result.kind),
    ["STALE_SKIPPED", "STALE_SKIPPED"],
  );
  assert.equal(revision.runtime.submitInvocations, 0);
  assert.equal(epoch.runtime.submitInvocations, 0);
  assertNoForbiddenDecisionCapabilityAccess(revision);
  assertNoForbiddenDecisionCapabilityAccess(epoch);
});

test("expired decisions invoke the authority-first deadline/default coordinator", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  harness.setDeadline(NOW);

  const result = await harness.service.tick("worker-deadline");

  assert.equal(result.kind, "ACKNOWLEDGED");
  if (result.kind === "ACKNOWLEDGED") assert.equal(result.outcome, "DEADLINE_ADVANCED");
  assert.equal(harness.runtime.deadlineCalls, 1);
  assert.equal(harness.runtime.submitInvocations, 0);
  assert.equal(harness.policy.calls, 0);
  assertNoForbiddenDecisionCapabilityAccess(harness);
});

test("illegal or DEFAULT_PASS policy output becomes an authority-first AI failure default", async () => {
  const unknown = await Harness.create("SOLO", ["cabinet_finance"]);
  unknown.policy.overrideActionType = "UNAUTHORED_PROVIDER_GUESS";
  const unknownResult = await unknown.service.tick("worker-illegal");

  const defaulted = await Harness.create("SOLO", ["cabinet_finance"]);
  defaulted.policy.overrideActionType = "DEFAULT_PASS";
  const defaultResult = await defaulted.service.tick("worker-default");

  assert.equal(unknownResult.kind, "ACKNOWLEDGED");
  assert.equal(defaultResult.kind, "ACKNOWLEDGED");
  if (unknownResult.kind === "ACKNOWLEDGED") {
    assert.equal(unknownResult.outcome, "AI_FAILURE_DEFAULTED");
  }
  if (defaultResult.kind === "ACKNOWLEDGED") {
    assert.equal(defaultResult.outcome, "AI_FAILURE_DEFAULTED");
  }
  assert.equal(unknown.runtime.submitInvocations, 0);
  assert.equal(defaulted.runtime.submitInvocations, 0);
  assert.equal(unknown.runtime.aiFailureCalls, 1);
  assert.equal(defaulted.runtime.aiFailureCalls, 1);
});

test("DEFAULT_PASS is allowed only when authored content exposes no non-default", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  harness.makeCurrentDecisionDefaultOnly();
  harness.policy.overrideActionType = "DEFAULT_PASS";

  const result = await harness.service.tick("worker-only-default");

  assert.equal(result.kind, "ACKNOWLEDGED");
  assert.equal(
    [...harness.runtime.uniqueSubmissions.values()][0]!.action.actionType,
    "DEFAULT_PASS",
  );
});

test("route and authority pins are fail-closed and the dependency surface has no Provider or world/finale/narrative writer", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  harness.scanner.taskTransform = (task) => rehashTask({
    ...task,
    routeHash: digest("spoofed-route"),
  });

  const result = await harness.service.tick("worker-route-pin");

  assert.equal(result.kind, "RETRY_SCHEDULED");
  assert.equal(harness.runtime.submitInvocations, 0);
  assert.deepEqual(
    Object.keys(harness.dependencies).sort(),
    ["clock", "compiler", "content", "deadlineDefaults", "orchestrators", "policy", "routes", "runtime", "scanner", "seats", "working"].sort(),
  );
  assert.equal("provider" in harness.dependencies, false);
  assert.equal("world" in harness.dependencies, false);
  assert.equal("finale" in harness.dependencies, false);
  assert.equal("narrative" in harness.dependencies, false);
});

test("Prisma scanner is read-only, prioritizes AI seats, and retains HUMAN deadline watchers", async () => {
  const solo = await Harness.create("SOLO", ["cabinet_finance"]);
  const multiplayer = await Harness.create("MULTIPLAYER", [
    "cabinet_finance",
    "qingliu_law",
  ]);
  solo.setDeadline(NOW + 10_000);
  multiplayer.setDeadline(NOW + 1_000);
  const harnesses = new Map([
    [solo.route.runId, solo],
    [multiplayer.route.runId, multiplayer],
  ]);
  let embeddedDecisionPointOverride: string | null = null;
  const prisma: DecisionAutomationScannerPrismaClientV1 = {
    pressureChapterRuntime: {
      findMany: async () => [multiplayer, solo].map((harness) => ({
        id: harness.state.chapterRuntimeId,
        runId: harness.route.runId,
        chapterId: harness.state.currentChapterId,
        chapterSequence: 1,
        routeHash: harness.route.routeHash,
        state: "DECISION_POINT_OPEN",
        workingRevision: harness.projection.state.revision,
        decisionStateJson: {
          schemaVersion: "pressure_mvp_decision_state_v1",
          workingRevision: harness.projection.state.revision,
          state: "OPEN",
          activeDecisionPointId: embeddedDecisionPointOverride
            ?? harness.state.activeDecision!.decisionPointId,
          allowedActionTypes: [],
          pin: null,
        },
      })),
    },
    pressureRunRouteSnapshot: {
      findUnique: async (input) => {
        const runId = readWhereRunId(input);
        const harness = harnesses.get(runId)!;
        return {
          runId,
          routeHash: harness.route.routeHash,
          routeJson: makeStoredRouteRecord(harness.route),
        };
      },
    },
    storyEvent: {
      findMany: async (input) => {
        const runId = readWhereRunId(input);
        return [{
          runId,
          type: "PRESSURE_CHAPTER_ORCHESTRATOR_STATE",
          payloadJson: harnesses.get(runId)!.state,
        }];
      },
    },
    pressureSeatControlSnapshot: {
      findFirst: async (input) => {
        const runId = readWhereRunId(input);
        const snapshot = harnesses.get(runId)!.seatSnapshot;
        return {
          runId,
          stateRevision: snapshot.stateRevision,
          stateHash: snapshot.stateHash,
          snapshotJson: snapshot,
        };
      },
    },
  };
  const scanner = new PrismaActivePressureDecisionScannerV1(prisma);

  const tasks = await scanner.scanActive();

  const expected = [...tasks].sort((left, right) =>
    Number(left.expectedControllerMode === "HUMAN_ACTIVE")
      - Number(right.expectedControllerMode === "HUMAN_ACTIVE")
      || (left.expectedDeadlineAtMs ?? Number.MAX_SAFE_INTEGER)
        - (right.expectedDeadlineAtMs ?? Number.MAX_SAFE_INTEGER)
      || left.runId.localeCompare(right.runId)
      || left.seatId.localeCompare(right.seatId),
  );
  assert.deepEqual(tasks.map((task) => task.taskHash), expected.map((task) => task.taskHash));
  assert.equal(tasks.length, 12);
  assert.equal(tasks.filter((task) => task.expectedControllerMode === "AI_ACTIVE").length, 9);
  assert.equal(
    tasks.find((task) => task.expectedControllerMode === "HUMAN_ACTIVE")?.runId,
    multiplayer.route.runId,
    "the earliest human deadline watcher must be first after all finite AI work",
  );
  assert.ok(tasks.every((task) => {
    const harness = harnesses.get(task.runId)!;
    return harness.seatSnapshot.seatControls.find(
      (seat) => seat.seatId === task.seatId,
    )?.mode === task.expectedControllerMode;
  }));
  assert.deepEqual(
    Object.keys(prisma).sort(),
    [
      "pressureChapterRuntime",
      "pressureRunRouteSnapshot",
      "pressureSeatControlSnapshot",
      "storyEvent",
    ].sort(),
  );

  embeddedDecisionPointOverride = "N7.foreign-decision";
  await assert.rejects(
    () => scanner.scanActive(),
    (error: unknown) => readPolicyErrorCode(error)
      === "PRESSURE_DECISION_AUTOMATION_PORT_RESULT_INVALID",
  );
});

test("worker lane delegates tick/drain without owning another scheduler", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  const lane = new PressureDecisionAutomationWorkerLaneV1(harness.service);

  const first = await lane.tick("worker-lane");
  const rest = await lane.drain("worker-lane", 8);

  assert.equal(first.kind, "ACKNOWLEDGED");
  assert.equal(rest.stoppedBecause, "IDLE");
  assert.equal(harness.runtime.uniqueSubmissions.size, 5);
});

test("published policy adapter forwards selection and preserves the release-owned selection hash", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  const adapter = new PublishedSangtianAiDecisionPolicyAdapterV1();
  const input = publishedPolicyInput(harness, "jiangnan_merchant");

  const selection = adapter.select(input);
  const { selectionHash, ...body } = selection;

  assert.equal(selectionHash, sha256Canonical(body));
  assert.notEqual(selection.actionType, "DEFAULT_PASS");
  assert.ok(input.eligibleActionTypes.includes(selection.actionType));
  assert.equal(selection.policyHash, adapter.artifactSha256);
});

test("published policy adapter fails closed for a non-required seat", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  await harness.activate("N2", "N2.memorial_draft");
  const adapter = new PublishedSangtianAiDecisionPolicyAdapterV1();
  const input = publishedPolicyInput(harness, "jiangnan_merchant");

  assert.throws(
    () => adapter.select(input),
    (error: unknown) => readPolicyErrorCode(error) === "SANGTIAN_AI_DECISION_BINDING_NOT_FOUND",
  );
});

test("published policy adapter fails closed when eligible actions drift from the release", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  const adapter = new PublishedSangtianAiDecisionPolicyAdapterV1();
  const valid = publishedPolicyInput(harness, "jiangnan_merchant");
  const drifted = buildAiDecisionPolicyInputV1({
    ...withoutInputHash(valid),
    eligibleActionTypes: valid.eligibleActionTypes.filter(
      (actionType) => actionType !== "SUPPORT_WEIR",
    ),
  });

  assert.throws(
    () => adapter.select(drifted),
    (error: unknown) => readPolicyErrorCode(error) === "SANGTIAN_AI_DECISION_ELIGIBLE_SET_MISMATCH",
  );
});

test("published policy adapter rejects a tampered release during construction", () => {
  const sourceRoot = resolve(
    __dirname,
    "../../../../../packages/templates/config/sangtian/pressure-chapter-v1/release",
  );
  const temporaryRoot = mkdtempSync(join(tmpdir(), "pressure-ai-policy-"));
  const releaseRoot = join(temporaryRoot, "release");
  try {
    cpSync(sourceRoot, releaseRoot, { recursive: true });
    const policyPath = join(releaseRoot, "ai-decision-policy.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8")) as Record<string, unknown>;
    policy.selectorVersion = "tampered-selector";
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    assert.throws(
      () => new PublishedSangtianAiDecisionPolicyAdapterV1({ releaseRoot }),
      (error: unknown) => readPolicyErrorCode(error) === "SANGTIAN_AI_DECISION_ARTIFACT_HASH_MISMATCH",
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("production factory owns the verified policy and exposes the exact worker lane", async () => {
  const harness = await Harness.create("SOLO", ["cabinet_finance"]);
  const bundle = createPressureDecisionAutomationProductionV1({
    prisma: {},
    routes: harness.dependencies.routes,
    orchestrators: harness.dependencies.orchestrators,
    working: harness.dependencies.working,
    seats: harness.dependencies.seats,
    content: harness.dependencies.content,
    runtime: harness.dependencies.runtime,
    deadlineDefaults: harness.dependencies.deadlineDefaults,
    clock: harness.dependencies.clock,
  });

  assert.ok(bundle.policy.artifactSha256.match(/^[a-f0-9]{64}$/));
  assert.ok(bundle.workerLane instanceof PressureDecisionAutomationWorkerLaneV1);
  assert.deepEqual(
    Object.keys(bundle).sort(),
    ["compiler", "policy", "scanner", "service", "workerLane"].sort(),
  );
});

class Harness {
  readonly contentBase = new SangtianAuthoredChapterContentAdapterV1();
  readonly policy = new DeterministicPolicy();
  readonly clock = { nowMs: () => NOW };
  readonly scanner: DynamicScanner;
  readonly runtime: RuntimeHarness;
  readonly dependencies: ConstructorParameters<typeof PressureDecisionAutomationServiceV1>[0];
  readonly service: PressureDecisionAutomationServiceV1;
  readonly forbiddenCapabilityAccesses: string[] = [];
  route: RunRouteSnapshotV1;
  descriptor: AuthoredChapterRuntimeV1;
  state: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1;
  seatSnapshot: SeatControlSnapshotV1;

  private constructor(input: {
    route: RunRouteSnapshotV1;
    descriptor: AuthoredChapterRuntimeV1;
    state: ChapterOrchestratorStateV1;
    projection: WorkingLedgerProjectionV1;
    seatSnapshot: SeatControlSnapshotV1;
  }) {
    this.route = input.route;
    this.descriptor = input.descriptor;
    this.state = input.state;
    this.projection = input.projection;
    this.seatSnapshot = input.seatSnapshot;
    this.scanner = new DynamicScanner(this);
    this.runtime = new RuntimeHarness(this);
    const dependencies: ConstructorParameters<typeof PressureDecisionAutomationServiceV1>[0] = {
      scanner: this.scanner,
      routes: { readRoute: async () => structuredClone(this.route) },
      orchestrators: { read: async () => structuredClone(this.state) },
      working: { load: async () => structuredClone(this.projection) },
      seats: { readSnapshot: async () => structuredClone(this.seatSnapshot) },
      content: { load: async () => structuredClone(this.descriptor) },
      policy: this.policy,
      compiler: new PressureAiDecisionCommandCompilerV1(
        new EmptyServerDecisionWorkingIntentCompilerV1(),
      ),
      runtime: this.runtime,
      deadlineDefaults: {
        advanceExpiredDecision: async () => ({
          kind: "APPLIED" as const,
          state: await this.runtime.advanceDeadline(),
        }),
        applyAiFailure: async () => ({
          kind: "APPLIED" as const,
          state: await this.runtime.applyAiFailure(),
        }),
      },
      clock: this.clock,
    };
    const allowedCapabilities = new Set(Reflect.ownKeys(dependencies));
    this.dependencies = new Proxy(dependencies, {
      get: (target, property, receiver) => {
        if (!allowedCapabilities.has(property)) {
          const capability = String(property);
          this.forbiddenCapabilityAccesses.push(capability);
          throw new Error(`Decision automation attempted undeclared capability: ${capability}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    this.service = new PressureDecisionAutomationServiceV1(this.dependencies, {
      retryMs: 10,
    });
  }

  static async create(
    participantMode: ParticipantModeV1,
    humanSeatIds: SeatIdV1[],
  ): Promise<Harness> {
    const route = makeRoute(participantMode, humanSeatIds);
    const content = new SangtianAuthoredChapterContentAdapterV1();
    const descriptor = await content.load({ routeSnapshot: route, chapterId: "N1" });
    const state = makeState(route, descriptor, "N1.weir_crisis");
    const projection = makeProjection(route, state, descriptor);
    const seatSnapshot = makeSeatSnapshot(route);
    return new Harness({ route, descriptor, state, projection, seatSnapshot });
  }

  async activate(chapterId: "N1" | "N2", decisionPointId: string): Promise<void> {
    this.descriptor = await this.contentBase.load({
      routeSnapshot: this.route,
      chapterId,
    });
    this.state = makeState(this.route, this.descriptor, decisionPointId);
    this.projection = makeProjection(this.route, this.state, this.descriptor);
  }

  setDeadline(deadlineAtMs: number): void {
    this.state = rehashState({
      ...this.state,
      activeDecision: {
        ...this.state.activeDecision!,
        deadlineAtMs,
      },
    });
  }

  makeCurrentDecisionDefaultOnly(): void {
    const decisions = structuredClone(this.descriptor.decisions);
    const current = decisions.find(
      (decision) => decision.decisionPointId === this.state.activeDecision!.decisionPointId,
    )!;
    current.execution.allowedActionTypes = ["DEFAULT_PASS"];
    const body = {
      ...this.descriptor,
      decisions,
    };
    delete (body as Partial<AuthoredChapterRuntimeV1>).descriptorHash;
    this.descriptor = {
      ...(body as Omit<AuthoredChapterRuntimeV1, "descriptorHash">),
      descriptorHash: sha256Canonical(body),
    };
    this.state = rehashState({
      ...this.state,
      descriptorHash: this.descriptor.descriptorHash,
    });
  }
}

function assertNoForbiddenDecisionCapabilityAccess(harness: Harness): void {
  assert.deepEqual(
    harness.forbiddenCapabilityAccesses,
    [],
    "AI decision execution must not reach any undeclared Provider/OpenAI/OpenNovel/Narrative capability",
  );
}

class DeterministicPolicy {
  calls = 0;
  overrideActionType: string | null = null;

  select(input: Readonly<AiDecisionPolicyInputV1>): AiDecisionPolicySelectionV1 {
    this.calls += 1;
    const nonDefault = input.eligibleActionTypes.filter(
      (actionType) => actionType !== "DEFAULT_PASS",
    );
    const actionType = this.overrideActionType
      ?? nonDefault[Number.parseInt(digest({
        runSeed: input.runSeed,
        chapterId: input.chapterId,
        decisionPointId: input.decisionPointId,
        seatId: input.seatId,
      }).slice(0, 8), 16) % Math.max(nonDefault.length, 1)]
      ?? "DEFAULT_PASS";
    return withAiDecisionPolicySelectionHashV1({
      policyRef: "sangtian.ai.decision.v1",
      policyVersion: "sangtian_ai_decision_v1",
      policyHash: digest("sangtian-ai-policy"),
      resolvedContentPackageVersion: input.contentPackageVersion,
      resolvedContentPackageSha256: input.contentPackageSha256,
      inputHash: input.inputHash,
      actionType,
    });
  }
}

class DynamicScanner implements ActivePressureDecisionScannerPortV1 {
  allowDuplicateConcurrentScan = false;
  taskTransform: ((task: DecisionAutomationTaskV1) => DecisionAutomationTaskV1) | null = null;

  constructor(private readonly harness: Harness) {}

  async scanActive(): Promise<DecisionAutomationTaskV1[]> {
    const active = this.harness.state.activeDecision;
    if (this.harness.state.phase !== "ACTIVE" || !active) return [];
    const seat = active.seats.find((candidate) => {
      const authority = this.harness.seatSnapshot.seatControls.find(
        (control) => control.seatId === candidate.seatId,
      );
      return candidate.requirement === "REQUIRED"
        && candidate.completion === "PENDING"
        && authority?.mode === "AI_ACTIVE";
    });
    if (!seat) return [];
    const authority = this.harness.seatSnapshot.seatControls.find(
      (control) => control.seatId === seat.seatId,
    )!;
    const task = rehashTask({
      schemaVersion: "pressure_decision_automation_task_v1",
      runId: this.harness.route.runId,
      routeHash: this.harness.route.routeHash,
      chapterRuntimeId: this.harness.state.chapterRuntimeId,
      chapterId: this.harness.state.currentChapterId,
      decisionPointId: active.decisionPointId,
      seatId: seat.seatId,
      expectedOrchestratorRevision: this.harness.state.revision,
      expectedWorkingRevision: this.harness.projection.state.revision,
      expectedControlEpoch: authority.controlEpoch,
      expectedControllerMode: authority.mode,
      expectedDeadlineAtMs: active.deadlineAtMs,
      expectedSeatAuthorityStateHash: this.harness.seatSnapshot.stateHash,
      taskHash: digest("placeholder"),
    });
    const transformed = this.taskTransform?.(task) ?? task;
    return [transformed];
  }
}

class RuntimeHarness {
  uniqueSubmissions = new Map<string, SubmitOrchestratedActionCommandV1>();
  submitInvocations = 0;
  resumeCalls = 0;
  deadlineCalls = 0;
  aiFailureCalls = 0;
  delayMs = 0;
  crashAfterAcceptOnce = false;
  private crashed = false;
  private inFlight = new Map<string, Promise<ChapterOrchestratorStateV1>>();

  constructor(private readonly harness: Harness) {}

  async submitAction(
    command: SubmitOrchestratedActionCommandV1,
  ): Promise<ChapterOrchestratorStateV1> {
    this.submitInvocations += 1;
    const prior = this.inFlight.get(command.action.idempotencyKey);
    if (prior) return prior;
    const run = this.commit(command);
    this.inFlight.set(command.action.idempotencyKey, run);
    try {
      return await run;
    } finally {
      this.inFlight.delete(command.action.idempotencyKey);
    }
  }

  async resume(): Promise<ChapterOrchestratorStateV1> {
    this.resumeCalls += 1;
    const active = this.harness.state.activeDecision;
    if (!active) return structuredClone(this.harness.state);
    for (const accepted of this.harness.projection.acceptedActions.values()) {
      const seat = active.seats.find(
        (candidate) => candidate.seatId === accepted.action.seatId,
      );
      if (seat?.completion === "PENDING") this.record(accepted.action.actionId, seat.seatId);
    }
    return structuredClone(this.harness.state);
  }

  async advanceDeadline(): Promise<ChapterOrchestratorStateV1> {
    this.deadlineCalls += 1;
    this.harness.state = rehashState({
      ...this.harness.state,
      revision: this.harness.state.revision + 1,
    });
    return structuredClone(this.harness.state);
  }

  async applyAiFailure(): Promise<ChapterOrchestratorStateV1> {
    this.aiFailureCalls += 1;
    this.harness.state = rehashState({
      ...this.harness.state,
      revision: this.harness.state.revision + 1,
    });
    return structuredClone(this.harness.state);
  }

  private async commit(
    command: SubmitOrchestratedActionCommandV1,
  ): Promise<ChapterOrchestratorStateV1> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const existing = this.uniqueSubmissions.get(command.action.idempotencyKey);
    if (!existing) {
      this.uniqueSubmissions.set(command.action.idempotencyKey, structuredClone(command));
      this.accept(command);
    } else {
      assert.equal(existing.action.sealedHash, command.action.sealedHash);
      assert.equal(existing.inputFingerprint, command.inputFingerprint);
    }
    if (this.crashAfterAcceptOnce && !this.crashed) {
      this.crashed = true;
      throw Object.assign(new Error("simulated crash after ledger append"), {
        code: "SIMULATED_CRASH_AFTER_ACCEPT",
      });
    }
    this.record(command.action.actionId, command.action.seatId);
    return structuredClone(this.harness.state);
  }

  private accept(command: SubmitOrchestratedActionCommandV1): void {
    const accepted: AcceptedFormalActionV1 = {
      action: structuredClone(command.action),
      routeHash: command.routeSnapshot.routeHash,
      inputFingerprint: command.inputFingerprint,
      intent: structuredClone(command.intent),
      audienceSeatIds: [command.action.seatId],
      eventHash: digest(`accepted:${command.action.actionId}`),
    };
    this.harness.projection.acceptedActions.set(command.action.actionId, accepted);
    this.harness.projection.actionsByIdempotencyKey.set(
      command.action.idempotencyKey,
      accepted,
    );
  }

  private record(actionId: string, seatId: SeatIdV1): void {
    const active = structuredClone(this.harness.state.activeDecision!);
    const seat = active.seats.find((candidate) => candidate.seatId === seatId)!;
    if (seat.actionIds.includes(actionId)) return;
    seat.actionIds = [actionId];
    seat.actionCount = 1;
    seat.completion = "SEALED_ACTIONS";
    const summaries = structuredClone(this.harness.state.chapterSeatSummaries);
    const summary = summaries.find((candidate) => candidate.seatId === seatId)!;
    summary.requirement = "REQUIRED";
    summary.sealedActionIds = [actionId];
    this.harness.state = rehashState({
      ...this.harness.state,
      revision: this.harness.state.revision + 1,
      activeDecision: active,
      chapterSeatSummaries: summaries,
    });
  }
}

function makeRoute(
  participantMode: ParticipantModeV1,
  humanSeatIdsAtStart: SeatIdV1[],
): RunRouteSnapshotV1 {
  const orderedHumans = [...humanSeatIdsAtStart].sort(
    (left, right) => PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(left)
      - PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(right),
  );
  const topology = makeControlTopology(participantMode, orderedHumans);
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: `run-${participantMode.toLowerCase()}-${humanSeatIdsAtStart.join("-")}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure_orchestration_v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure_runtime_contract_v1",
    runtimeContractSha256: digest("runtime-contract"),
    testMatrixVersion: "pressure_test_matrix_v1",
    testMatrixSha256: digest("test-matrix"),
    runSeed: `seed-${participantMode}-${humanSeatIdsAtStart.join("-")}`,
    narrativeProfileVersion: "pressure_narrative_v1",
    featureSetVersion: "pressure_feature_set_v1",
    resultContractRegistryVersion: "pressure_result_registry_v1",
    participantMode,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: orderedHumans,
    controlTopologyVersion: "pressure_control_topology_v1",
    initialRoleControlSnapshotHash: topology.topologyHash,
  });
}

function makeControlTopology(
  participantMode: ParticipantModeV1,
  humanSeatIds: readonly SeatIdV1[],
) {
  const humans = new Set(humanSeatIds);
  const body = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure_control_topology_v1",
    participantMode,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humans.has(seatId) ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  return { ...body, topologyHash: sha256Canonical(body) };
}

function makeStoredRouteRecord(route: RunRouteSnapshotV1) {
  const controlTopology = makeControlTopology(
    route.participantMode,
    route.humanSeatIdsAtStart as SeatIdV1[],
  );
  const body = {
    schemaVersion: "pressure_stored_run_route_v1" as const,
    runId: route.runId,
    routeKey: "sangtian-pressure-v1",
    registryVersion: "pressure_registry_v1",
    registryHash: digest("registry"),
    handlerKey: "pressure_chapter_v1" as const,
    resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    createRequestFingerprint: digest(`create:${route.runId}`),
    snapshot: structuredClone(route),
    controlTopology,
  };
  return { ...body, recordHash: sha256Canonical(body) };
}

function readWhereRunId(input: Record<string, unknown>): string {
  return (input.where as { runId: string }).runId;
}

function publishedPolicyInput(
  harness: Harness,
  seatId: SeatIdV1,
): AiDecisionPolicyInputV1 {
  const decision = harness.descriptor.decisions.find(
    (candidate) => candidate.decisionPointId === harness.state.activeDecision!.decisionPointId,
  )!;
  return buildAiDecisionPolicyInputV1({
    runId: harness.route.runId,
    routeHash: harness.route.routeHash,
    runSeed: harness.route.runSeed,
    contentPackageVersion: harness.route.contentPackageVersion,
    contentPackageSha256: harness.route.contentPackageSha256,
    chapterRuntimeId: harness.state.chapterRuntimeId,
    chapterId: harness.state.currentChapterId,
    decisionPointId: decision.decisionPointId,
    seatId,
    eligibleActionTypes: [...decision.execution.allowedActionTypes],
  });
}

function withoutInputHash(
  input: AiDecisionPolicyInputV1,
): Omit<AiDecisionPolicyInputV1, "schemaVersion" | "inputHash"> {
  const {
    schemaVersion: _schemaVersion,
    inputHash: _inputHash,
    ...body
  } = input;
  return body;
}

function readPolicyErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return String((error as { code?: unknown }).code ?? "");
}

function makeState(
  route: RunRouteSnapshotV1,
  descriptor: AuthoredChapterRuntimeV1,
  decisionPointId: string,
): ChapterOrchestratorStateV1 {
  const decision = descriptor.decisions.find(
    (candidate) => candidate.decisionPointId === decisionPointId,
  )!;
  const active = {
    decisionPointId,
    policyHash: sha256Canonical(decision.execution),
    openedAtMs: NOW - 1_000,
    deadlineAtMs: NOW + (decision.execution.deadlinePolicy?.durationMs ?? 300_000),
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const requirement = decision.seatRequirements[seatId];
      return {
        seatId,
        requirement,
        completion: requirement === "REQUIRED" ? "PENDING" as const : "NOT_REQUIRED" as const,
        actionIds: [],
        actionCount: 0,
        defaultCode: null,
      };
    }),
  };
  return withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: 0,
    phase: "ACTIVE",
    currentChapterId: descriptor.chapterId,
    chapterRuntimeId: `chapter-runtime-${descriptor.chapterId.toLowerCase()}-${digest(route.runId).slice(0, 8)}`,
    descriptorHash: descriptor.descriptorHash,
    authorityBase: {
      baseWorldSequence: Number(descriptor.chapterId.slice(1)) - 1,
      baseWorldStateHash: digest(`world:${descriptor.chapterId}`),
      previousFrozenHash: digest(`frozen:${descriptor.chapterId}`),
    },
    activeDecision: active,
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: decision.seatRequirements[seatId],
      sealedActionIds: [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: null,
    frozenBundleHash: null,
  });
}

function makeProjection(
  route: RunRouteSnapshotV1,
  state: ChapterOrchestratorStateV1,
  descriptor: AuthoredChapterRuntimeV1,
): WorkingLedgerProjectionV1 {
  const working = createChapterWorkingState({
    runId: route.runId,
    chapterId: state.currentChapterId,
  });
  const point = descriptor.definition.decisionPoints.find(
    (candidate) => candidate.decisionPointId === state.activeDecision!.decisionPointId,
  )!;
  const stateHash = workingStateHash(working);
  return {
    key: { runId: route.runId, chapterRuntimeId: state.chapterRuntimeId },
    chapterId: state.currentChapterId,
    routeHash: route.routeHash,
    chapterDefinitionHash: descriptor.descriptorHash,
    headHash: digest("ledger-head"),
    headSequence: 0,
    state: working,
    stateHash,
    nextDecisionPin: {
      schemaVersion: "pressure_decision_pin_v1",
      chapterId: state.currentChapterId,
      stateRevision: working.revision,
      stateFingerprint: stateHash,
      decisionPointId: point.decisionPointId,
      kernelId: point.kernelId,
      optionIds: point.options.map((option) => option.optionId),
    },
    acceptedActions: new Map(),
    actionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
}

function makeSeatSnapshot(route: RunRouteSnapshotV1): SeatControlSnapshotV1 {
  const frozenPolicyBase = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "pressure_seat_control_v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline.takeover.v1",
    takeoverDeadlinePolicyHash: digest("deadline-policy"),
    deterministicDefaultPolicyRef: "default.v1",
    deterministicDefaultPolicyHash: digest("default-policy"),
    humanReclaimAllowed: true,
  };
  const frozenPolicy = {
    ...frozenPolicyBase,
    policyHash: sha256Canonical(frozenPolicyBase),
  };
  const humans = new Set(route.humanSeatIdsAtStart);
  const seatControls: SeatAuthorityRecordV1[] = PRESSURE_CHAPTER_SEAT_IDS_V1.map(
    (seatId) => {
      const human = humans.has(seatId);
      const designatedAiControllerId = `pressure-ai:${seatId}:${digest(route.runId).slice(0, 12)}`;
      const originalHumanControllerId = human ? `human:${seatId}` : null;
      const activeControllerId = originalHumanControllerId ?? designatedAiControllerId;
      return {
        seatId,
        mode: human ? "HUMAN_ACTIVE" : "AI_ACTIVE",
        originalHumanControllerId,
        designatedAiControllerId,
        activeControllerId,
        controlEpoch: 1,
        submissionFenceToken: digest(`submission:${route.runId}:${seatId}`),
        reclaimFenceToken: human ? digest(`reclaim:${route.runId}:${seatId}`) : null,
        lastAuthorityEventHash: digest(`event:${route.runId}:${seatId}`),
      };
    },
  );
  const body = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId: route.runId,
    participantMode: route.participantMode,
    routeHash: route.routeHash,
    genesisHash: digest(`genesis:${route.runId}`),
    genesisAtomicRecordHash: digest(`genesis-atomic:${route.runId}`),
    initialTopologyHash: route.initialRoleControlSnapshotHash,
    controlTopologyVersion: route.controlTopologyVersion,
    frozenPolicy,
    stateRevision: 1,
    timelineLength: 6,
    timelineHeadHash: digest(`timeline:${route.runId}`),
    seatControls,
    initializationInputHash: digest(`init:${route.runId}`),
  };
  return { ...body, stateHash: sha256Canonical(body) };
}

function rehashTask(
  input: Omit<DecisionAutomationTaskV1, "taskHash"> & { taskHash?: string },
): DecisionAutomationTaskV1 {
  const { taskHash: _ignored, ...body } = input;
  return withDecisionAutomationTaskHashV1(body);
}

function rehashState(
  input: Omit<ChapterOrchestratorStateV1, "orchestratorHash"> & { orchestratorHash?: string },
): ChapterOrchestratorStateV1 {
  const { orchestratorHash: _ignored, ...body } = input;
  return withOrchestratorHashV1(body);
}

function digest(value: unknown): string {
  return sha256Canonical(value);
}

// Compile-time proof that production idempotency excludes clock/retry attempt.
assert.equal(
  buildDecisionAutomationIdempotencyKeyV1({
    runId: "r",
    chapterRuntimeId: "c",
    decisionPointId: "d",
    seatId: "s",
    controlEpoch: 1,
  }),
  "pressure-ai-action-v1:r:c:d:s:1",
);
