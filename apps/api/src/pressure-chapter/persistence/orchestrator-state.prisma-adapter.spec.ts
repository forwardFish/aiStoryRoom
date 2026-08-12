import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type { ChapterOrchestratorStateV1 } from "../orchestrator/contracts";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import {
  PrismaChapterOrchestratorStateRepository,
  type OrchestratorStatePrismaClient,
} from "./orchestrator-state.prisma-adapter";

test("orchestrator state appends contiguous revisions and fences runtime lifecycle", async () => {
  const fake = new OrchestratorFake({
    id: "chapter-n1",
    runId: "run-orchestrator",
    state: "CHAPTER_ACTIVE",
    workingRevision: 0,
    decisionStateJson: decisionStateFixture("decision-n1", 0),
    lockVersion: 0,
  });
  const repository = new PrismaChapterOrchestratorStateRepository(fake.client);
  const active = stateFixture(0, "ACTIVE");
  const opened = await repository.compareAndSwap({
    runId: active.runId,
    expectedRevision: null,
    next: active,
  });
  assert.equal(opened.status, "COMMITTED");
  assert.equal(fake.runtime.state, "DECISION_POINT_OPEN");
  assert.equal(fake.runtime.lockVersion, 1);
  assert.deepEqual(
    fake.runtime.decisionStateJson.requiredSeatIds,
    PRESSURE_CHAPTER_SEAT_IDS_V1.slice(0, 2),
  );
  assert.deepEqual(fake.runtime.decisionStateJson.allowedActionTypes, ["option-a", "option-b"]);
  assert.equal(fake.runtime.decisionStateJson.pin.decisionPointId, "decision-n1");
  assert.equal(fake.runtime.decisionStateJson.workingRevision, 0);
  assert.equal(fake.runtime.decisionStateJson.policyHash, active.activeDecision?.policyHash);
  assert.equal(fake.runtime.decisionStateJson.orchestratorHash, active.orchestratorHash);
  assert.deepEqual(await repository.read(active.runId), active);

  const stale = await repository.compareAndSwap({
    runId: active.runId,
    expectedRevision: null,
    next: active,
  });
  assert.equal(stale.status, "CONFLICT");
  assert.equal(stale.current?.revision, 0);

  const resolving = stateFixture(1, "RESOLVING_BEAT");
  const claimed = await repository.compareAndSwap({
    runId: active.runId,
    expectedRevision: 0,
    next: resolving,
  });
  assert.equal(claimed.status, "COMMITTED");
  assert.equal(fake.runtime.state, "BEAT_RESOLVING");
  assert.equal(fake.events.length, 2);
  assert.equal(fake.authorityWorldWrites, 0);
});

test("SETTLING state and runtime close fence commit in the same transaction", async () => {
  const fake = new OrchestratorFake({
    id: "chapter-n1",
    runId: "run-orchestrator",
    state: "CHAPTER_ACTIVE",
    workingRevision: 0,
    decisionStateJson: decisionStateFixture("decision-n1", 0),
    lockVersion: 0,
  });
  const repository = new PrismaChapterOrchestratorStateRepository(fake.client);
  await repository.compareAndSwap({
    runId: "run-orchestrator",
    expectedRevision: null,
    next: stateFixture(0, "ACTIVE"),
  });
  fake.runtime.state = "BEAT_RESOLVED";
  fake.runtime.workingRevision = 1;
  fake.runtime.decisionStateJson = decisionStateFixture(null, 1);
  const settling = stateFixture(1, "SETTLING");
  const result = await repository.compareAndSwap({
    runId: settling.runId,
    expectedRevision: 0,
    next: settling,
  });
  assert.equal(result.status, "COMMITTED");
  assert.equal(fake.runtime.state, "CHAPTER_SETTLING");
  assert.equal(fake.runtime.lockVersion, 2);
  assert.equal(fake.transactionCommits, 2);
});

test("ACTIVE-to-ACTIVE decision transition enriches the new pin without overwriting ledger fields", async () => {
  const fake = new OrchestratorFake({
    id: "chapter-n1",
    runId: "run-orchestrator",
    state: "DECISION_POINT_OPEN",
    workingRevision: 0,
    decisionStateJson: decisionStateFixture("decision-n1", 0),
    lockVersion: 0,
  });
  const repository = new PrismaChapterOrchestratorStateRepository(fake.client);
  await repository.compareAndSwap({
    runId: "run-orchestrator",
    expectedRevision: null,
    next: stateFixture(0, "ACTIVE"),
  });

  // Simulate the Working Ledger winning the preceding CAS and installing the
  // next pin. It intentionally cannot author requiredSeatIds.
  fake.runtime.workingRevision = 1;
  fake.runtime.decisionStateJson = decisionStateFixture("decision-n1-2", 1);
  const lockBefore = fake.runtime.lockVersion;
  const next = stateFixture(
    1,
    "ACTIVE",
    "decision-n1-2",
    [PRESSURE_CHAPTER_SEAT_IDS_V1[2]!],
  );
  const result = await repository.compareAndSwap({
    runId: next.runId,
    expectedRevision: 0,
    next,
  });

  assert.equal(result.status, "COMMITTED");
  assert.equal(fake.runtime.lockVersion, lockBefore + 1, "same lifecycle state still CAS-updates");
  assert.equal(fake.runtime.state, "DECISION_POINT_OPEN");
  assert.equal(fake.runtime.decisionStateJson.activeDecisionPointId, "decision-n1-2");
  assert.equal(fake.runtime.decisionStateJson.workingRevision, 1);
  assert.deepEqual(fake.runtime.decisionStateJson.allowedActionTypes, ["option-a", "option-b"]);
  assert.equal(fake.runtime.decisionStateJson.pin.decisionPointId, "decision-n1-2");
  assert.deepEqual(fake.runtime.decisionStateJson.requiredSeatIds, [PRESSURE_CHAPTER_SEAT_IDS_V1[2]]);
});

test("missing or mismatched Working Ledger decision state fails closed", async () => {
  const missing = new OrchestratorFake({
    id: "chapter-n1",
    runId: "run-orchestrator",
    state: "CHAPTER_ACTIVE",
    workingRevision: 0,
    decisionStateJson: null,
    lockVersion: 0,
  });
  const missingRepository = new PrismaChapterOrchestratorStateRepository(missing.client);
  await assert.rejects(
    missingRepository.compareAndSwap({
      runId: "run-orchestrator",
      expectedRevision: null,
      next: stateFixture(0, "ACTIVE"),
    }),
    /decisionStateJson is invalid/,
  );
  assert.equal(missing.events.length, 0);
  assert.equal(missing.runtime.lockVersion, 0);

  const mismatched = new OrchestratorFake({
    id: "chapter-n1",
    runId: "run-orchestrator",
    state: "CHAPTER_ACTIVE",
    workingRevision: 0,
    decisionStateJson: decisionStateFixture("some-other-decision", 0),
    lockVersion: 0,
  });
  const mismatchedRepository = new PrismaChapterOrchestratorStateRepository(mismatched.client);
  await assert.rejects(
    mismatchedRepository.compareAndSwap({
      runId: "run-orchestrator",
      expectedRevision: null,
      next: stateFixture(0, "ACTIVE"),
    }),
    /decision pins disagree/,
  );
  assert.equal(mismatched.events.length, 0);
  assert.equal(mismatched.runtime.lockVersion, 0);

  const incomplete = new OrchestratorFake({
    id: "chapter-n1",
    runId: "run-orchestrator",
    state: "CHAPTER_ACTIVE",
    workingRevision: 0,
    decisionStateJson: decisionStateFixture("decision-n1", 0),
    lockVersion: 0,
  });
  const incompleteRepository = new PrismaChapterOrchestratorStateRepository(incomplete.client);
  const completeState = stateFixture(0, "ACTIVE");
  const { orchestratorHash: _hash, ...body } = completeState;
  const incompleteState = withOrchestratorHashV1({
    ...body,
    activeDecision: {
      ...completeState.activeDecision!,
      seats: completeState.activeDecision!.seats.slice(0, -1),
    },
  });
  await assert.rejects(
    incompleteRepository.compareAndSwap({
      runId: "run-orchestrator",
      expectedRevision: null,
      next: incompleteState,
    }),
    /seat authority is incomplete/,
  );
  assert.equal(incomplete.events.length, 0);
  assert.equal(incomplete.runtime.lockVersion, 0);
});

class OrchestratorFake {
  readonly events: Array<Record<string, any>> = [];
  transactionCommits = 0;
  authorityWorldWrites = 0;
  constructor(readonly runtime: Record<string, any>) {}

  readonly tx = {
    storyEvent: {
      findMany: async (_input: any): Promise<any[]> => [],
      create: async (_input: any): Promise<any> => ({}),
    },
    pressureChapterRuntime: {
      findUnique: async (_input: any): Promise<any> => null,
      updateMany: async (_input: any): Promise<{ count: number }> => ({ count: 0 }),
    },
  };

  readonly client: OrchestratorStatePrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      const eventsBefore = structuredClone(this.events);
      const runtimeBefore = structuredClone(this.runtime);
      this.install();
      try {
        const result = await operation(this.tx);
        this.transactionCommits += 1;
        return result;
      } catch (error) {
        this.events.splice(0, this.events.length, ...eventsBefore);
        Object.assign(this.runtime, runtimeBefore);
        throw error;
      }
    },
  };

  private install(): void {
    this.tx.storyEvent.findMany = async ({ where }: any) => this.events
      .filter((row) => row.runId === where.runId && row.type === where.type)
      .map((row) => structuredClone(row));
    this.tx.storyEvent.create = async ({ data }: any) => {
      if (this.events.some((row) => row.dedupeKey === data.dedupeKey)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const row = structuredClone(data);
      this.events.push(row);
      return structuredClone(row);
    };
    this.tx.pressureChapterRuntime.findUnique = async ({ where }: any) => (
      where.id === this.runtime.id ? structuredClone(this.runtime) : null
    );
    this.tx.pressureChapterRuntime.updateMany = async ({ where, data }: any) => {
      if (
        where.id !== this.runtime.id
        || where.runId !== this.runtime.runId
        || where.state !== this.runtime.state
        || where.lockVersion !== this.runtime.lockVersion
      ) return { count: 0 };
      Object.assign(this.runtime, structuredClone(data), {
        lockVersion: this.runtime.lockVersion + 1,
      });
      return { count: 1 };
    };
  }
}

function stateFixture(
  revision: number,
  phase: ChapterOrchestratorStateV1["phase"],
  decisionPointId = "decision-n1",
  requiredSeatIds: readonly SeatIdV1[] = PRESSURE_CHAPTER_SEAT_IDS_V1.slice(0, 2),
): ChapterOrchestratorStateV1 {
  return withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: "run-orchestrator",
    routeHash: digest("route"),
    revision,
    phase,
    currentChapterId: "N1",
    chapterRuntimeId: "chapter-n1",
    descriptorHash: digest("descriptor"),
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: digest("world"),
      previousFrozenHash: digest("genesis"),
    },
    activeDecision: phase === "ACTIVE" || phase === "RESOLVING_BEAT"
      ? {
          decisionPointId,
          policyHash: digest("decision-policy"),
          openedAtMs: 1,
          deadlineAtMs: null,
          seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
            const required = requiredSeatIds.includes(seatId);
            return {
              seatId,
              requirement: required ? "REQUIRED" as const : "NOT_REQUIRED" as const,
              completion: required ? "PENDING" as const : "NOT_REQUIRED" as const,
              actionIds: [],
              actionCount: 0,
              defaultCode: null,
            };
          }),
        }
      : null,
    chapterSeatSummaries: [],
    settlementInputHash: phase === "SETTLING" ? digest("settlement-input") : null,
    frozenBundleHash: null,
  });
}

function decisionStateFixture(
  decisionPointId: string | null,
  workingRevision: number,
): Record<string, unknown> {
  const pin = decisionPointId
    ? {
        schemaVersion: "pressure_decision_pin_v1",
        chapterId: "N1",
        stateRevision: workingRevision,
        stateFingerprint: digest(`working-${workingRevision}`),
        decisionPointId,
        kernelId: `kernel-${decisionPointId}`,
        optionIds: ["option-a", "option-b"],
      }
    : null;
  const body = {
    schemaVersion: "pressure_mvp_decision_state_v1",
    workingRevision,
    state: decisionPointId ? "OPEN" : "NONE",
    activeDecisionPointId: decisionPointId,
    allowedActionTypes: decisionPointId ? ["option-a", "option-b"] : [],
    requiredSeatIds: [],
    pin,
    policyHash: null,
    orchestratorHash: null,
  };
  return { ...body, decisionStateHash: sha256Canonical(body) };
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
