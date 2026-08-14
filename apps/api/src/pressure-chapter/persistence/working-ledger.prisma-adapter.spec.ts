import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type DecisionActionV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  type PressureChapterDefinition,
} from "@ai-story/templates";
import { sealAEmotionAuthorityOutboxJobV1 } from "../a-emotion-production/compiler";
import { buildGenesisAtomicRecord, buildGenesisCommitReceipt } from "../genesis";
import { computePressureFormalCommitmentFingerprintV1 } from "../a-emotion-promise";
import type {
  SangtianAEmotionContentSourceCompilerV1,
} from "../a-emotion-production/content-source";
import {
  FormalPressureInteractionService,
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import type {
  PressureChatMessageV1,
  PressureInteractionAccessPort,
  PressureInteractionAccessV1,
  PressureSystemDefaultAccessContextV1,
} from "../interaction/contracts";
import type { SeatControlSnapshotV1, SeatDefaultDirectiveV1 } from "../seat-control/types";
import { emptySeatEnvelope } from "../seat-control-persistence/envelope";
import { buildPressureMvpDecisionStateV1 } from "./mvp-decision-state";
import type {
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
} from "../narrative-authority/contracts";
import { WorkingBeatApplicationService } from "../working-ledger/beat-application.service";
import type { WorkingActionIntentV1 } from "../working-ledger/contracts";
import { buildWorkingLedgerEvents, projectWorkingLedger } from "../working-ledger/working-ledger";
import { WorkingLedgerService } from "../working-ledger/working-ledger.service";
import {
  PrismaPressureChatRepository,
  PrismaPressureInteractionAccessRepository,
  PrismaWorkingLedgerRepository,
  type InteractionAccessPrismaClient,
  type WorkingLedgerPrismaClient,
} from "./working-ledger.prisma-adapter";

const ACTOR: SeatIdV1 = "cabinet_finance";
const TARGET: SeatIdV1 = "jiangnan_merchant";

test("OPEN and ACTION do not advance working revision; BEAT CAS alone advances it", async () => {
  const route = routeFixture();
  const chapter = chapterFixture();
  const narrativeAuthorities: unknown[] = [];
  const initial = createChapterWorkingState({ runId: route.runId, chapterId: "N1" });
  const fake = new WorkingLedgerFake({
    id: "runtime-n1",
    runId: route.runId,
    chapterId: "N1",
    routeHash: route.routeHash,
    workingRevision: 0,
    workingStateJson: initial,
    workingStateHash: sha256Canonical(initial),
    lockVersion: 0,
  }, route);
  const repository = new PrismaWorkingLedgerRepository(
    fake.client,
    narrativeCompilerStub((rawAuthority) => narrativeAuthorities.push(rawAuthority)),
    aEmotionBeatCompilerStub(),
  );

  await new WorkingLedgerService(repository).open({
    routeSnapshot: route,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: chapter,
    initialState: initial,
  });
  assert.equal(fake.runtime.workingRevision, 0);
  assert.equal(fake.runtime.workingStateHash, sha256Canonical(initial));

  const projection = projectWorkingLedger(await repository.read({
    runId: route.runId,
    chapterRuntimeId: "runtime-n1",
  }));
  const action = actionFixture(route, projection.state.revision);
  const intent = intentFixture();
  const base = { routeSnapshot: route, action, intent };
  const formal = new FormalPressureInteractionService(
    new StaticAccess({
      routeHash: route.routeHash,
      runId: route.runId,
      chapterRuntimeId: "runtime-n1",
      chapterId: "N1",
      workingRevision: projection.state.revision,
      workingStateHash: projection.stateHash,
      activeDecisionPointId: "dp-investigate",
      controlledSeatIds: [ACTOR],
      controlEpochBySeat: { [ACTOR]: 4 },
      allowedActionTypes: ["DECIDE"],
      interactableSeatIds: [TARGET],
      visibleEvidenceRefs: ["evidence-ledger"],
      resourceAvailability: [{ resourceId: "grain", availableAmount: 10 }],
    }),
    repository,
  );
  await formal.submit({
    ...base,
    subjectId: "user-a",
    inputFingerprint: computeFormalInteractionInputFingerprint(base),
  });
  assert.equal(fake.runtime.workingRevision, 0, "ACTION must not advance working revision");
  assert.equal(fake.worldWriteCalls, 0, "W5 capability has no StoryRun/world writer");

  await new WorkingBeatApplicationService(repository).apply({
    routeSnapshot: route,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: chapter,
    actionId: action.actionId,
    actionInputFingerprint: computeFormalInteractionInputFingerprint(base),
    resolverVersion: "pressure-beat-resolver-v1",
  });
  assert.equal(fake.runtime.workingRevision, 1, "BEAT CAS advances working revision exactly once");
  assert.equal(fake.worldWriteCalls, 0, "BEAT must not advance worldSequence");
  assert.equal(fake.reservations.length, 0, "reservations remain in the ledger projection JSON");
  assert.equal(fake.beatResolutions.length, 0, "beat authority remains in StoryEvent");
  assert.equal(fake.projections.length, 2);
  assert.equal(fake.outbox.filter((row) => row.taskType === "PROJECT_BEAT_NARRATIVE").length, 2);
  assert.equal(narrativeAuthorities.length, 2);
  const narrativeAuthority = narrativeAuthorities[0] as Record<string, unknown>;
  assert.deepEqual(narrativeAuthority.sealedActionAudiences, [{
    actionId: action.actionId,
    audienceSeatIds: [ACTOR, TARGET],
  }]);
  assert.ok(narrativeAuthority.stateAfter);
  assert.equal(
    narrativeAuthority.stateAfterHash,
    sha256Canonical(narrativeAuthority.stateAfter),
  );
  assert.ok(Object.hasOwn(narrativeAuthority, "nextDecisionPin"));
  assert.equal(
    fake.outbox.filter((row) => row.taskType === "INTERACTION_COMPILE_REQUESTED").length,
    1,
  );
  assert(fake.calls.lastIndexOf("event.create:PRESSURE_WORKING_LEDGER_EVENT") < fake.calls.lastIndexOf("runtime.cas"));
  assert(fake.calls.lastIndexOf("runtime.cas") < fake.calls.lastIndexOf("tx.commit"));
  assert(fake.storyEvents.every((row) => row.sequence === null));
});

test("first OPEN atomically creates the missing ChapterRuntime from frozen authority", async () => {
  const route = routeFixture();
  const initial = createChapterWorkingState({ runId: route.runId, chapterId: "N1" });
  const world = worldFixture(route.runId);
  const fake = new MissingRuntimeOpeningFake(route, world, initial);
  const repository = new PrismaWorkingLedgerRepository(fake.client);

  const opened = await new WorkingLedgerService(repository).open({
    routeSnapshot: route,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: chapterFixture(),
    initialState: initial,
  });
  assert.equal(opened.status, "OPENED");
  assert.equal(opened.projection.headHash, opened.event.eventHash);
  assert.equal(opened.projection.stateHash, sha256Canonical(initial));
  assert.equal(fake.runtime?.state, "CHAPTER_ACTIVE");
  assert.equal(fake.runtime?.baseWorldSequence, 0);
  assert.equal(fake.runtime?.baseWorldStateHash, world.stateHash);
  assert.equal(fake.runtime?.routeHash, route.routeHash);
  assert.equal(fake.storyEvents.length, 1);
  assert(fake.calls.indexOf("runtime.create") < fake.calls.indexOf("event.create"));
  assert.equal(fake.transactionCommits, 1, "OPEN returns its projection from the atomic append transaction");
  assert.equal(fake.worldWriteCalls, 0);
});

test("same WorkingLedger head race returns HEAD_MISMATCH without partial writes", async () => {
  const route = routeFixture();
  const initial = createChapterWorkingState({ runId: route.runId, chapterId: "N1" });
  const fake = new WorkingLedgerFake({
    id: "runtime-n1",
    runId: route.runId,
    chapterId: "N1",
    routeHash: route.routeHash,
    workingRevision: 0,
    workingStateJson: initial,
    workingStateHash: sha256Canonical(initial),
    lockVersion: 0,
  });
  const repository = new PrismaWorkingLedgerRepository(fake.client);
  const opened = await new WorkingLedgerService(repository).open({
    routeSnapshot: route,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: chapterFixture(),
    initialState: initial,
  });
  const result = await repository.append({
    key: { runId: route.runId, chapterRuntimeId: "runtime-n1" },
    expectedHeadHash: "0".repeat(64),
    events: [opened.event],
  });
  assert.equal(result.status, "HEAD_MISMATCH");
  assert.equal(fake.storyEvents.length, 1);
});

test("formal commitment appends to StoryEvent and emits A-Emotion work in the same transaction", async () => {
  const route = routeFixture();
  const initial = createChapterWorkingState({ runId: route.runId, chapterId: "N1" });
  const fake = new WorkingLedgerFake({
    id: "runtime-n1",
    runId: route.runId,
    chapterId: "N1",
    routeHash: route.routeHash,
    workingRevision: 0,
    workingStateJson: initial,
    workingStateHash: sha256Canonical(initial),
    lockVersion: 0,
  }, route);
  let compileCalls = 0;
  const compiler = {
    ...aEmotionBeatCompilerStub(),
    compileFormalCommitment: () => {
      compileCalls += 1;
      return [];
    },
  };
  const repository = new PrismaWorkingLedgerRepository(fake.client, undefined, compiler);
  await new WorkingLedgerService(repository).open({
    routeSnapshot: route,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: chapterFixture(),
    initialState: initial,
  });
  const prior = await repository.read({ runId: route.runId, chapterRuntimeId: "runtime-n1" });
  const projection = projectWorkingLedger(prior);
  const action = actionFixture(route, 0);
  const mutation = {
    commitmentId: "promise-1",
    operation: "CREATE" as const,
    seatIds: [ACTOR, TARGET],
    sourceActionId: action.actionId,
  };
  const audienceSeatIds = [ACTOR, TARGET];
  const [event] = buildWorkingLedgerEvents({
    key: projection.key,
    chapterId: "N1",
    previousEvents: prior,
    payloads: [{
      eventType: "FORMAL_COMMITMENT_APPLIED",
      routeHash: route.routeHash,
      inputFingerprint: computePressureFormalCommitmentFingerprintV1({
        routeHash: route.routeHash,
        action,
        mutation,
        audienceSeatIds,
      }),
      action,
      mutation,
      audienceSeatIds,
    }],
  });
  const result = await repository.append({
    key: projection.key,
    expectedHeadHash: projection.headHash,
    events: [event!],
  });
  assert.equal(result.status, "APPENDED");
  assert.equal(compileCalls, 1);
  assert.equal(fake.actions.length, 0, "commitments do not create a DecisionAction row");
  assert.equal(projectWorkingLedger(await repository.read(projection.key)).state.revision, 0);
});

test("chat idempotency replays only the same request fingerprint and message hash", async () => {
  const route = routeFixture();
  const initial = createChapterWorkingState({ runId: route.runId, chapterId: "N1" });
  const fake = new WorkingLedgerFake({
    id: "runtime-n1",
    runId: route.runId,
    chapterId: "N1",
    routeHash: route.routeHash,
    workingRevision: 0,
    workingStateJson: initial,
    workingStateHash: sha256Canonical(initial),
    lockVersion: 0,
  });
  const repository = new PrismaPressureChatRepository(fake.client);
  const message = chatFixture(route);
  assert.equal((await repository.appendIfAbsent(message)).status, "APPENDED");
  assert.equal((await repository.appendIfAbsent(message)).status, "EXISTING");

  const changedWithoutHash = {
    ...message,
    text: "Different content under the same idempotency key",
    requestFingerprint: sha256Canonical("different-chat-request"),
  };
  const { messageHash: _oldHash, ...changedBody } = changedWithoutHash;
  const changed = {
    ...changedWithoutHash,
    messageHash: sha256Canonical(changedBody),
  };
  await assert.rejects(
    repository.appendIfAbsent(changed),
    /idempotency key was reused/,
  );
  assert.equal(fake.storyEvents.length, 1);
});

test("interaction access keeps human actions on committed SeatControl and ordinary chat needs no default authority", async () => {
  const fake = new InteractionAccessFake({
    subjectId: "user-human",
    mode: "HUMAN",
  });
  const repository = new PrismaPressureInteractionAccessRepository(fake.client);
  const human = await repository.load({
    subjectId: "user-human",
    runId: fake.runtime.runId,
    chapterRuntimeId: fake.runtime.id,
    actionContext: {
      decisionPointId: "dp-investigate",
      seatId: ACTOR,
      controlEpoch: 4,
      actionType: "DECIDE",
      payloadHash: digest("human-payload"),
      idempotencyKey: "human-action-1",
    },
  });
  assert.deepEqual(human.controlledSeatIds, [ACTOR]);
  assert.deepEqual(
    human.interactableSeatIds,
    PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => seatId !== ACTOR),
  );

  const chat = await repository.load({
    subjectId: "user-human",
    runId: fake.runtime.runId,
    chapterRuntimeId: fake.runtime.id,
  });
  assert.deepEqual(chat.controlledSeatIds, [ACTOR]);
  assert.equal(chat.visibleEvidenceRefs.includes("evidence-ledger"), true);
});

test("interaction access authorizes only the exact committed deterministic default action", async () => {
  const systemDefault = systemDefaultContext("default-action-1");
  const fake = new InteractionAccessFake({
    subjectId: "pressure-ai:seat",
    mode: "SYSTEM_DEFAULT",
    systemDefault,
  });
  const repository = new PrismaPressureInteractionAccessRepository(fake.client);
  const access = await repository.load({
    subjectId: "pressure-ai:seat",
    runId: fake.runtime.runId,
    chapterRuntimeId: fake.runtime.id,
    actionContext: {
      decisionPointId: "dp-investigate",
      seatId: ACTOR,
      controlEpoch: 7,
      actionType: "DEFAULT_PASS",
      payloadHash: systemDefault.canonicalActionPayloadHash,
      idempotencyKey: "default-action-1",
    },
    systemDefault,
  });
  assert.deepEqual(access.controlledSeatIds, [ACTOR]);
  assert.deepEqual(access.allowedActionTypes, ["DEFAULT_PASS"]);
  assert.deepEqual(access.interactableSeatIds, []);
  assert.deepEqual(access.visibleEvidenceRefs, []);
  assert.deepEqual(access.resourceAvailability, []);
  assert.equal(fake.calls.includes("seatControl.findUnique"), true);
});

test("interaction access rejects spoofed default subject, payload, route, decision, and epoch mismatches", async () => {
  const expected = systemDefaultContext("default-action-1");
  for (const [label, setup] of [
    [
      "spoofed-system-subject",
      () => new InteractionAccessFake({
        subjectId: "intruder-system",
        mode: "SYSTEM_DEFAULT",
        systemDefault: expected,
        snapshotControllerId: "pressure-ai:seat",
      }),
    ],
    [
      "payload-mismatch",
      () => new InteractionAccessFake({
        subjectId: "pressure-ai:seat",
        mode: "SYSTEM_DEFAULT",
        systemDefault: expected,
        directivePayloadHash: digest("other-payload"),
      }),
    ],
    [
      "route-mismatch",
      () => new InteractionAccessFake({
        subjectId: "pressure-ai:seat",
        mode: "SYSTEM_DEFAULT",
        systemDefault: expected,
        snapshotRouteHash: digest("other-route"),
      }),
    ],
    [
      "decision-mismatch",
      () => new InteractionAccessFake({
        subjectId: "pressure-ai:seat",
        mode: "SYSTEM_DEFAULT",
        systemDefault: expected,
        directiveDecisionPointId: "dp-other",
      }),
    ],
    [
      "epoch-mismatch",
      () => new InteractionAccessFake({
        subjectId: "pressure-ai:seat",
        mode: "SYSTEM_DEFAULT",
        systemDefault: expected,
        snapshotControlEpoch: 6,
      }),
    ],
  ] as const) {
    const fake = setup();
    const repository = new PrismaPressureInteractionAccessRepository(fake.client);
    await assert.rejects(
      () => repository.load({
        subjectId: fake.subjectId,
        runId: fake.runtime.runId,
        chapterRuntimeId: fake.runtime.id,
        actionContext: {
          decisionPointId: "dp-investigate",
          seatId: ACTOR,
          controlEpoch: 7,
          actionType: "DEFAULT_PASS",
          payloadHash: expected.canonicalActionPayloadHash,
          idempotencyKey: "default-action-1",
        },
        systemDefault: expected,
      }),
      /deterministic default/i,
      label,
    );
  }

  const humanReplay = new InteractionAccessFake({
    subjectId: "user-human",
    mode: "HUMAN",
    systemDefault: expected,
  });
  const repository = new PrismaPressureInteractionAccessRepository(humanReplay.client);
  await assert.rejects(
    () => repository.load({
      subjectId: "user-human",
      runId: humanReplay.runtime.runId,
      chapterRuntimeId: humanReplay.runtime.id,
      actionContext: {
        decisionPointId: "dp-investigate",
        seatId: ACTOR,
        controlEpoch: 7,
        actionType: "DEFAULT_PASS",
        payloadHash: expected.canonicalActionPayloadHash,
        idempotencyKey: "default-action-1",
      },
    }),
    /requires system authorization context/i,
  );
});

class StaticAccess implements PressureInteractionAccessPort {
  constructor(private readonly value: PressureInteractionAccessV1) {}
  async load(): Promise<PressureInteractionAccessV1> {
    return structuredClone(this.value);
  }
}

class WorkingLedgerFake {
  readonly calls: string[] = [];
  readonly storyEvents: Array<Record<string, any>> = [];
  readonly actions: Array<Record<string, any>> = [];
  readonly reservations: Array<Record<string, any>> = [];
  readonly beatResolutions: Array<Record<string, any>> = [];
  readonly projections: Array<Record<string, any>> = [];
  readonly outbox: Array<Record<string, any>> = [];
  worldWriteCalls = 0;
  readonly point = {
    id: "point-db-id",
    decisionPointKey: "dp-investigate",
    allowedActionTypesJson: ["DECIDE"],
    state: "OPEN",
  };

  constructor(
    readonly runtime: Record<string, any>,
    private readonly route: RunRouteSnapshotV1 | null = null,
  ) {}

  readonly tx = {
    storyEvent: {
      findMany: async (_input: any): Promise<any[]> => [],
      findUnique: async (_input: any): Promise<any> => null,
      create: async (_input: any): Promise<any> => ({}),
    },
    pressureChapterRuntime: {
      findUnique: async (_input: any): Promise<any> => null,
      create: async (_input: any): Promise<any> => ({}),
      updateMany: async (_input: any): Promise<{ count: number }> => ({ count: 0 }),
    },
    pressureDecisionPointInstance: {
      findFirst: async (_input: any): Promise<any> => null,
      updateMany: async (_input: any): Promise<{ count: number }> => ({ count: 0 }),
    },
    pressureDecisionAction: { create: async (_input: any): Promise<any> => ({}) },
    pressureDecisionActionRevision: { create: async (_input: any): Promise<any> => ({}) },
    pressureChapterWorkingLedgerEntry: { create: async (_input: any): Promise<any> => ({ id: "" }) },
    pressureBeatResolution: { create: async (_input: any): Promise<any> => ({}) },
    pressureNarrativeProjection: { create: async (_input: any): Promise<any> => ({ id: "" }) },
    pressureOutboxTask: { create: async (_input: any): Promise<any> => ({}) },
    pressureResourceReservation: {
      create: async (_input: any): Promise<any> => ({}),
      updateMany: async (_input: any): Promise<{ count: number }> => ({ count: 0 }),
    },
    pressureRunRouteSnapshot: { findUnique: async (_input: any): Promise<any> => null },
    pressureGenesisSnapshot: { findUnique: async (_input: any): Promise<any> => null },
    pressureFrozenChapterBundle: { findFirst: async (_input: any): Promise<any> => null },
    storyRun: { findUnique: async (_input: any): Promise<any> => null },
  };

  readonly client: WorkingLedgerPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.installDelegates();
      this.calls.push("tx.begin");
      const result = await operation(this.tx);
      this.calls.push("tx.commit");
      return result;
    },
  };

  private installDelegates(): void {
    this.tx.storyEvent.findMany = async () => structuredClone(this.storyEvents);
    this.tx.storyEvent.findUnique = async (input: any) => structuredClone(
      this.storyEvents.find((row) => row.dedupeKey === input.where.dedupeKey) ?? null,
    );
    this.tx.storyEvent.create = async ({ data }: any) => {
      this.calls.push(`event.create:${String(data.type)}`);
      const row = { ...structuredClone(data), createdAt: new Date() };
      this.storyEvents.push(row);
      return structuredClone(row);
    };
    this.tx.pressureChapterRuntime.findUnique = async () => structuredClone(this.runtime);
    this.tx.pressureChapterRuntime.create = async ({ data }: any) => structuredClone(data);
    this.tx.pressureChapterRuntime.updateMany = async ({ where, data }: any) => {
      this.calls.push("runtime.cas");
      if (
        where.id !== this.runtime.id
        || where.lockVersion !== this.runtime.lockVersion
        || (where.workingRevision !== undefined
          && where.workingRevision !== this.runtime.workingRevision)
        || (where.workingStateHash !== undefined
          && where.workingStateHash !== this.runtime.workingStateHash)
      ) return { count: 0 };
      if (data.lockVersion?.increment) this.runtime.lockVersion += data.lockVersion.increment;
      for (const key of ["workingRevision", "workingStateJson", "workingStateHash", "state"]) {
        if (key in data) this.runtime[key] = structuredClone(data[key]);
      }
      return { count: 1 };
    };
    this.tx.pressureDecisionPointInstance.findFirst = async () => structuredClone(this.point);
    this.tx.pressureDecisionPointInstance.updateMany = async () => {
      this.calls.push("point.resolve");
      this.point.state = "RESOLVED";
      return { count: 1 };
    };
    this.tx.pressureDecisionAction.create = async ({ data }: any) => {
      this.calls.push("action.create");
      this.actions.push(structuredClone(data));
      return data;
    };
    this.tx.pressureDecisionActionRevision.create = async () => {
      this.calls.push("action.revision.create");
      return {};
    };
    this.tx.pressureChapterWorkingLedgerEntry.create = async () => {
      this.calls.push("ledger.materialize");
      return { id: "ledger-entry-1" };
    };
    this.tx.pressureBeatResolution.create = async ({ data }: any) => {
      this.calls.push("beat.create");
      this.beatResolutions.push(structuredClone(data));
      return data;
    };
    this.tx.pressureNarrativeProjection.create = async ({ data }: any) => {
      this.calls.push("projection.create");
      const row = { id: `projection-${this.projections.length + 1}`, ...structuredClone(data) };
      this.projections.push(row);
      return { id: row.id };
    };
    this.tx.pressureOutboxTask.create = async ({ data }: any) => {
      this.calls.push("outbox.create");
      this.outbox.push(structuredClone(data));
      return data;
    };
    this.tx.pressureRunRouteSnapshot.findUnique = async () => this.route
      ? {
          runId: this.route.runId,
          routeHash: this.route.routeHash,
          contentPackageVersion: this.route.contentPackageVersion,
          contentPackageSha256: this.route.contentPackageSha256,
          orchestrationPackageVersion: this.route.orchestrationPackageVersion,
          orchestrationPackageSha256: this.route.orchestrationPackageSha256,
          runtimeContractVersion: this.route.runtimeContractVersion,
          runtimeContractSha256: this.route.runtimeContractSha256,
          humanSeatIdsAtStartJson: [...this.route.humanSeatIdsAtStart],
        }
      : null;
    this.tx.pressureResourceReservation.create = async ({ data }: any) => {
      this.calls.push("reservation.create");
      this.reservations.push(structuredClone(data));
      return data;
    };
    this.tx.pressureResourceReservation.updateMany = async () => ({ count: 1 });
  }
}

class MissingRuntimeOpeningFake {
  readonly calls: string[] = [];
  readonly storyEvents: Array<Record<string, any>> = [];
  runtime: Record<string, any> | null = null;
  transactionCommits = 0;
  worldWriteCalls = 0;

  constructor(
    private readonly route: RunRouteSnapshotV1,
    private readonly world: ReturnType<typeof worldFixture>,
    private readonly seed: ReturnType<typeof createChapterWorkingState>,
  ) {}

  readonly client: WorkingLedgerPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      const runtimeBefore = structuredClone(this.runtime);
      const eventsBefore = structuredClone(this.storyEvents);
      try {
        const result = await operation(this.tx());
        this.transactionCommits += 1;
        return result;
      } catch (error) {
        this.runtime = runtimeBefore;
        this.storyEvents.splice(0, this.storyEvents.length, ...eventsBefore);
        throw error;
      }
    },
  };

  private tx(): any {
    return {
      storyEvent: {
        findMany: async () => structuredClone(this.storyEvents),
        findUnique: async ({ where }: any) => structuredClone(
          this.storyEvents.find((row) => row.dedupeKey === where.dedupeKey) ?? null,
        ),
        create: async ({ data }: any) => {
          this.calls.push("event.create");
          const row = { ...structuredClone(data), createdAt: new Date() };
          this.storyEvents.push(row);
          return structuredClone(row);
        },
      },
      pressureChapterRuntime: {
        findUnique: async () => structuredClone(this.runtime),
        create: async ({ data }: any) => {
          this.calls.push("runtime.create");
          this.runtime = structuredClone(data);
          return structuredClone(this.runtime);
        },
        updateMany: async ({ where, data }: any) => {
          if (!this.runtime || where.id !== this.runtime.id) return { count: 0 };
          if (data.lockVersion?.increment) this.runtime.lockVersion += data.lockVersion.increment;
          return { count: 1 };
        },
      },
      pressureRunRouteSnapshot: {
        findUnique: async () => ({
          runId: this.route.runId,
          routeHash: this.route.routeHash,
          contentPackageVersion: this.route.contentPackageVersion,
          contentPackageSha256: this.route.contentPackageSha256,
          orchestrationPackageVersion: this.route.orchestrationPackageVersion,
          orchestrationPackageSha256: this.route.orchestrationPackageSha256,
          runtimeContractVersion: this.route.runtimeContractVersion,
          runtimeContractSha256: this.route.runtimeContractSha256,
          humanSeatIdsAtStartJson: [...this.route.humanSeatIdsAtStart],
        }),
      },
      pressureGenesisCommit: {
        findUnique: async () => ({
          runId: this.route.runId,
          commitManifestJson: genesisManifest(this.route, this.world),
        }),
      },
      pressureChapterSettlement: { findUnique: async () => null },
      storyRun: {
        findUnique: async () => ({
          id: this.route.runId,
          worldSequence: 0,
          stateJson: structuredClone(this.world),
        }),
      },
      pressureDecisionPointInstance: {
        findFirst: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
      pressureDecisionAction: { create: async () => ({}) },
      pressureDecisionActionRevision: { create: async () => ({}) },
      pressureChapterWorkingLedgerEntry: { create: async () => ({ id: "" }) },
      pressureBeatResolution: { create: async () => ({}) },
      pressureNarrativeProjection: { create: async () => ({ id: "" }) },
      pressureOutboxTask: { create: async () => ({}) },
      pressureResourceReservation: {
        create: async () => ({}),
        updateMany: async () => ({ count: 0 }),
      },
    };
  }
}

function narrativeCompilerStub(
  onCompile?: (rawAuthority: unknown) => void,
): ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1 {
  return {
    compile: (_job, rawAuthority) => {
      onCompile?.(structuredClone(rawAuthority));
      return {};
    },
    deriveAudienceAllowlist: (job) => ({
      audience: structuredClone(job.audience),
      allowedFactIds: [],
      allowedObjectVersionIds: [],
      allowedKnowledgeIds: [],
    }),
  };
}

function aEmotionBeatCompilerStub(): Pick<
  SangtianAEmotionContentSourceCompilerV1,
  "compileBeat"
> {
  return {
    compileBeat(input: any) {
      const job = sealAEmotionAuthorityOutboxJobV1({
        schemaVersion: "a_emotion_authority_outbox_job_v1",
        sourceKind: "BEAT_COMMITTED",
        runId: input.ledgerEvents[0]?.runId ?? "missing-run",
        sourceId: input.beatEventHash,
        sourceCommitHash: input.beatEventHash,
        signalId: `beat:${input.beatEventHash}`,
      });
      return [{
        dedupeKey: `aemotion:${job.jobHash}`,
        job,
        source: {} as never,
      }];
    },
  };
}

class InteractionAccessFake {
  readonly calls: string[] = [];
  readonly runtime = {
    id: "runtime-n1",
    runId: "run-access",
    chapterId: "N1",
    routeHash: digest("route-access"),
    workingRevision: 3,
    workingStateJson: {
      schemaVersion: "pressure_chapter_working_state_v1",
      revision: 3,
      facts: { "clue.ledger": true },
    },
    workingStateHash: digest("working-state-access"),
    lockVersion: 0,
    decisionStateJson: buildPressureMvpDecisionStateV1({
      workingRevision: 3,
      pin: {
        schemaVersion: "pressure_decision_pin_v1",
        chapterId: "N1",
        stateRevision: 3,
        stateFingerprint: digest("state-access"),
        decisionPointId: "dp-investigate",
        kernelId: "kernel-access",
        optionIds: ["DECIDE", "DEFAULT_PASS"],
      },
    }),
  };
  readonly activePoint = {
    id: "point-access",
    decisionPointKey: "dp-investigate",
    allowedActionTypesJson: ["DECIDE", "DEFAULT_PASS"],
  };
  readonly subjectId: string;
  readonly client: InteractionAccessPrismaClient;
  private readonly directive: SeatDefaultDirectiveV1 | null;
  private readonly seatControlSnapshot: SeatControlSnapshotV1 | null;
  private readonly controlRows: Array<{
    mode: string;
    epoch: number;
    role: { roleKey: string; knownInfoJson: unknown };
    humanPlayer: { userId: string | null } | null;
  }>;

  constructor(input: {
    subjectId: string;
    mode: "HUMAN" | "SYSTEM_DEFAULT";
    systemDefault?: PressureSystemDefaultAccessContextV1;
    directivePayloadHash?: string;
    directiveDecisionPointId?: string;
    snapshotControlEpoch?: number;
    snapshotControllerId?: string;
    snapshotRouteHash?: string;
  }) {
    this.subjectId = input.subjectId;
    this.controlRows = input.mode === "HUMAN"
      ? [{
          mode: "HUMAN_ACTIVE",
          epoch: 4,
          role: {
            roleKey: ACTOR,
            knownInfoJson: { evidenceRefs: ["evidence-ledger"] },
          },
          humanPlayer: { userId: input.subjectId },
        }]
      : [];
    this.directive = input.systemDefault
      ? seatDefaultDirectiveFixture({
          idempotencyKey: "default-action-1",
          defaultPolicyRef: input.systemDefault.defaultPolicyRef,
          defaultPolicyHash: input.systemDefault.defaultPolicyHash,
          canonicalActionPayloadHash: input.directivePayloadHash
            ?? input.systemDefault.canonicalActionPayloadHash,
          decisionPointId: input.directiveDecisionPointId ?? "dp-investigate",
          controlEpoch: input.snapshotControlEpoch ?? 7,
        })
      : null;
    this.seatControlSnapshot = input.systemDefault || input.mode === "HUMAN"
      ? seatControlSnapshotFixture({
          routeHash: input.snapshotRouteHash ?? this.runtime.routeHash,
          controllerId: input.snapshotControllerId ?? input.subjectId,
          controlEpoch: input.snapshotControlEpoch ?? 7,
          stateHash: this.directive?.authorityStateHash ?? digest("seat-control-access"),
          mode: input.mode === "HUMAN" ? "HUMAN_ACTIVE" : "AI_ACTIVE",
        })
      : null;
    this.client = {
      $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => operation({
        pressureChapterRuntime: {
          findUnique: async () => structuredClone(this.runtime),
        },
        storyPlayer: {
          findUnique: async () => input.mode === "HUMAN"
            ? {
                id: "player-access",
                runId: this.runtime.runId,
                userId: input.subjectId,
                playerType: "human",
                status: "active",
                role: {
                  roleKey: ACTOR,
                  knownInfoJson: { evidenceRefs: ["evidence-ledger"] },
                },
              }
            : null,
        },
        storyRun: {
          findUnique: async () => ({
            id: this.runtime.runId,
            stateJson: {
              resources: { grain: 9 },
              evidence: [{
                evidenceId: "evidence-ledger",
                authorizedSeatIds: [ACTOR],
              }],
              knowledgeBySeat: {
                [ACTOR]: { evidenceRefs: ["evidence-ledger"] },
              },
            },
          }),
        },
        pressureSeatControlSnapshot: {
          findUnique: async () => {
            this.calls.push("seatControl.findUnique");
            if (!this.seatControlSnapshot) return null;
            const envelope = emptySeatEnvelope(this.seatControlSnapshot);
            if (this.directive) envelope.directives[this.directive.idempotencyKey] = this.directive;
            return {
              runId: this.seatControlSnapshot.runId,
              stateRevision: this.seatControlSnapshot.stateRevision,
              snapshotJson: structuredClone(envelope),
              stateHash: this.seatControlSnapshot.stateHash,
              version: 1,
            };
          },
        },
      }),
    };
  }
}

function routeFixture(): RunRouteSnapshotV1 {
  const digest = (label: string) => sha256Canonical({ label });
  const topology = controlTopology("MULTIPLAYER", [ACTOR, TARGET]);
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: "run-w5-persistence",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: "sangtian-content-v1",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "sangtian-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-tests-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "seed-w5",
    narrativeProfileVersion: "openovel-pressure-v1",
    featureSetVersion: "pressure-feature-v1",
    resultContractRegistryVersion: "pressure-result-registry-v1",
    participantMode: "MULTIPLAYER",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [ACTOR, TARGET],
    controlTopologyVersion: "pressure-control-v1",
    initialRoleControlSnapshotHash: topology.topologyHash,
  });
}

function controlTopology(
  participantMode: "SOLO" | "MULTIPLAYER",
  humanSeats: readonly string[],
) {
  const base = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure-control-v1",
    participantMode,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humanSeats.includes(seatId) ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  return { ...base, topologyHash: sha256Canonical(base) };
}

function genesisManifest(route: RunRouteSnapshotV1, world: any) {
  const topology = controlTopology(route.participantMode, route.humanSeatIdsAtStart);
  const base = {
    schemaVersion: "pressure_stored_run_route_v1" as const,
    runId: route.runId,
    routeKey: "sangtian",
    registryVersion: "test-registry-v1",
    registryHash: digest("registry"),
    handlerKey: "pressure_chapter_v1" as const,
    resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    createRequestFingerprint: digest("create-request"),
    snapshot: route,
    controlTopology: topology,
  };
  const stored = { ...base, recordHash: sha256Canonical(base) };
  const record = buildGenesisAtomicRecord(stored, world, {
    runId: route.runId,
    idempotencyKey: `genesis:${route.runId}`,
    requestFingerprint: digest("genesis-request"),
  });
  return { record, receipt: buildGenesisCommitReceipt(record) };
}

function worldFixture(runId: string) {
  void runId;
  const trackBase = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(TRACK_IDS_V1.map((trackId) => [trackId, 0])),
  };
  const tracks = { ...trackBase, stateHash: sha256Canonical(trackBase) };
  const knowledgeBySeat = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const value = {
        seatId,
        knownFactRefs: [],
        secretRefs: [],
        disclosedToSeatIds: [] as SeatIdV1[],
      };
      return [seatId, { ...value, stateHash: sha256Canonical(value) }];
    }),
  );
  const seatArcs = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const value = {
      seatId,
      arcStage: "P0_FROZEN",
      publicGoalProgress: 0,
      privateGoalProgress: 0,
      gainRefs: [] as string[],
      lossRefs: [] as string[],
      costRefs: [] as string[],
    };
    return [seatId, { ...value, stateHash: sha256Canonical(value) }];
  }));
  const body = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: 0,
    factValues: { "frozen.P0.LOCKED": true },
    resources: { grain: 10 },
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

function chapterFixture(): PressureChapterDefinition {
  return {
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N1",
    sequence: 1,
    requirementDependencies: [],
    decisionPoints: [{
      decisionPointId: "dp-investigate",
      kernelId: "kernel-investigate",
      chapterId: "N1",
      sourceOrder: 1,
      prompt: "Investigate the ledger",
      requirementIds: ["req-clue"],
      options: [{
        optionId: "inspect-ledger",
        sourceOrder: 1,
        label: "Inspect",
        workingDelta: {
          setFacts: { "clue.ledger": true },
          incrementCounters: { investigation: 1 },
          satisfyRequirementIds: ["req-clue"],
        },
      }],
    }],
  };
}

function actionFixture(route: RunRouteSnapshotV1, revision: number): DecisionActionV1 {
  const payload = { optionId: "inspect-ledger" };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: "action-investigate-1",
    runId: route.runId,
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1" as const,
    decisionPointId: "dp-investigate",
    seatId: ACTOR,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 4,
    expectedWorkingRevision: revision,
    status: "SEALED" as const,
    actionType: "DECIDE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: "idem-action-1",
  };
  const withRequest = {
    ...body,
    requestFingerprint: computeDecisionActionRequestFingerprint(body),
  };
  return { ...withRequest, sealedHash: sha256Canonical(withRequest) };
}

function intentFixture(): WorkingActionIntentV1 {
  return {
    visibility: "PARTICIPANTS",
    targetSeatIds: [TARGET],
    evidenceRefs: ["evidence-ledger"],
    resourceReservations: [{
      reservationKey: "reserve-grain-1",
      resourceId: "grain",
      amount: 4,
    }],
    commitmentMutations: [{
      commitmentId: "promise-protect",
      operation: "CREATE",
      seatIds: [ACTOR, TARGET],
    }],
    knowledgeGrants: [{ seatId: TARGET, factRefs: ["clue.ledger"] }],
    seatArcProgress: [{ seatId: ACTOR, progressDelta: 1 }],
  };
}

function chatFixture(route: RunRouteSnapshotV1): PressureChatMessageV1 {
  const withoutHash = {
    schemaVersion: "pressure_chapter_chat_message_v1" as const,
    messageId: "chat-message-1",
    runId: route.runId,
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1" as const,
    senderSeatId: ACTOR,
    visibility: "PRIVATE" as const,
    audienceSeatIds: [ACTOR, TARGET],
    text: "Coordinate the grain transfer.",
    idempotencyKey: "chat-idempotency-1",
    requestFingerprint: sha256Canonical("chat-request-1"),
  };
  return { ...withoutHash, messageHash: sha256Canonical(withoutHash) };
}

function systemDefaultContext(idempotencyKey: string): PressureSystemDefaultAccessContextV1 {
  void idempotencyKey;
  return {
    reason: "DEADLINE",
    defaultPolicyRef: "default-policy",
    defaultPolicyHash: digest("default-policy"),
    canonicalActionPayloadHash: digest("default-payload"),
  };
}

function seatDefaultDirectiveFixture(input: {
  idempotencyKey: string;
  defaultPolicyRef: string;
  defaultPolicyHash: string;
  canonicalActionPayloadHash: string;
  decisionPointId: string;
  controlEpoch: number;
}): SeatDefaultDirectiveV1 {
  const base = {
    schemaVersion: "pressure_seat_default_directive_v1" as const,
    runId: "run-access",
    decisionPointId: input.decisionPointId,
    seatId: ACTOR,
    controlEpoch: input.controlEpoch,
    trigger: "HUMAN_DEADLINE" as const,
    defaultPolicyRef: input.defaultPolicyRef,
    defaultPolicyHash: input.defaultPolicyHash,
    canonicalActionPayloadHash: input.canonicalActionPayloadHash,
    sourceProofHash: digest("default-proof"),
    authorityStateHash: digest("seat-control-access"),
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: digest("default-request"),
  };
  return { ...base, directiveHash: sha256Canonical(base) };
}

function seatControlSnapshotFixture(input: {
  routeHash: string;
  controllerId: string;
  controlEpoch: number;
  stateHash: string;
  mode?: "HUMAN_ACTIVE" | "AI_ACTIVE";
}): SeatControlSnapshotV1 {
  const controls = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => {
    const isActor = seatId === ACTOR;
    const controllerId = isActor ? input.controllerId : `human-${index + 1}`;
    return {
      seatId,
      mode: isActor ? input.mode ?? "AI_ACTIVE" as const : "HUMAN_ACTIVE" as const,
      originalHumanControllerId: isActor && input.mode === "HUMAN_ACTIVE"
        ? input.controllerId
        : `human-${index}`,
      designatedAiControllerId: isActor && input.mode !== "HUMAN_ACTIVE"
        ? input.controllerId
        : `ai-${index}`,
      activeControllerId: controllerId,
      controlEpoch: isActor ? input.controlEpoch : 1,
      submissionFenceToken: digest(`${seatId}:submit:${controllerId}`),
      reclaimFenceToken: digest(`${seatId}:reclaim:${controllerId}`),
      lastAuthorityEventHash: digest(`${seatId}:event:${controllerId}`),
    };
  });
  const base = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId: "run-access",
    participantMode: "MULTIPLAYER" as const,
    routeHash: input.routeHash,
    genesisHash: digest("seat-genesis"),
    genesisAtomicRecordHash: digest("seat-genesis-atomic"),
    initialTopologyHash: digest("seat-topology"),
    controlTopologyVersion: "pressure-control-v1",
    frozenPolicy: {
      schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
      policyVersion: "seat-policy-v1",
      disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
      takeoverDeadlinePolicyRef: "deadline-policy",
      takeoverDeadlinePolicyHash: digest("deadline-policy"),
      deterministicDefaultPolicyRef: "default-policy",
      deterministicDefaultPolicyHash: digest("default-policy"),
      humanReclaimAllowed: true,
      policyHash: digest("seat-policy-hash"),
    },
    stateRevision: 2,
    timelineLength: 7,
    timelineHeadHash: digest("seat-timeline"),
    seatControls: controls,
    initializationInputHash: digest("seat-init"),
  };
  return { ...base, stateHash: input.stateHash };
}
